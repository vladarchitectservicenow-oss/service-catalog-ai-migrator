// JobPulse — Scheduled Job Health Auditor — JobPulseScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core scan engine: walks the sys_trigger estate and runs the full check
// pipeline (execution health, orphaned references, overlap/contention,
// stale/dead jobs, ownership gaps), upserting findings and health records.

var JobPulseScanner = Class.create();
JobPulseScanner.prototype = {
    initialize: function() {
        this.BATCH_SIZE = 200;
        var cfg = this._getConfig();
        this.PEAK_START = cfg.peak_start;
        this.PEAK_END = cfg.peak_end;
        this.STALE_DAYS = cfg.stale_days;
        this.LOOKBACK_DAYS = cfg.lookback_days;
    },

    /**
     * Scan every active scheduled job and upsert findings + health records.
     * @param {boolean} incremental - if true, only scan jobs modified since last run
     * @returns {object} {scanned, findings, critical}
     */
    scanAllJobs: function(incremental) {
        var stats = { scanned: 0, findings: 0, critical: 0 };

        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('active', true);
        if (incremental) {
            var since = new GlideDateTime();
            since.addDaysUTC(-1);
            gr.addQuery('sys_updated_on', '>=', since.toString());
        }
        gr.setLimit(this.BATCH_SIZE);
        gr.query();

        while (gr.next()) {
            try {
                var result = this.scanJob(gr.getUniqueValue());
                stats.scanned++;
                stats.findings += result.total_findings;
                stats.critical += result.critical_findings;
            } catch (e) {
                gs.error('JobPulseScanner.scanAllJobs: failed for job ' +
                         gr.getValue('name') + ': ' + e);
            }
        }

        return stats;
    },

    /**
     * Scan a single job and upsert its findings + health record.
     * @param {string} triggerSysId - sys_trigger sys_id
     * @returns {object} {job_sys_id, total_findings, critical_findings, health_score}
     */
    scanJob: function(triggerSysId) {
        var triggerGr = new GlideRecord('sys_trigger');
        if (!triggerGr.get(triggerSysId)) {
            return { job_sys_id: triggerSysId, total_findings: 0, critical_findings: 0, health_score: 0 };
        }

        var jobName = triggerGr.getValue('name') || triggerSysId;
        var jobType = this._resolveJobType(triggerGr);

        // Run the full check pipeline
        var findings = [];
        findings = findings.concat(this.checkExecutionHealth(triggerGr));
        findings = findings.concat(this.checkOrphanedRef(triggerGr));
        findings = findings.concat(this.checkOverlap(triggerGr));
        findings = findings.concat(this.checkStale(triggerGr));
        findings = findings.concat(this.checkOwnership(triggerGr));

        // Upsert each finding
        var criticalCount = 0;
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            f.job_id = triggerSysId;
            f.job_name = jobName;
            f.job_type = jobType;
            this._upsertFinding(f);
            if (f.severity === 'critical') {
                criticalCount++;
            }
        }

        // Compute and persist health score
        var analytics = new JobPulseAnalytics();
        var health = analytics.computeHealthScore(triggerSysId, findings);
        this._upsertHealth(triggerGr, health, findings.length, criticalCount);

        return {
            job_sys_id: triggerSysId,
            total_findings: findings.length,
            critical_findings: criticalCount,
            health_score: health.health_score
        };
    },

    /**
     * Detect silent failures: syslog error entries correlated to the job's
     * execution window with no downstream incident/alert.
     * @param {object} triggerGr - GlideRecord on sys_trigger
     * @returns {array} findings
     */
    checkExecutionHealth: function(triggerGr) {
        var findings = [];
        var jobName = triggerGr.getValue('name') || '';
        if (!jobName) {
            return findings;
        }

        var since = new GlideDateTime();
        since.addDaysUTC(-this.LOOKBACK_DAYS);

        var logGr = new GlideRecord('syslog');
        logGr.addQuery('source', jobName);
        logGr.addQuery('level', 3); // error
        logGr.addQuery('sys_created_on', '>=', since.toString());
        logGr.setLimit(50);
        logGr.query();

        var errorCount = 0;
        var lastError = '';
        var lastErrorTime = '';
        while (logGr.next()) {
            errorCount++;
            if (!lastError) {
                lastError = logGr.getValue('message') || '';
                lastErrorTime = logGr.getValue('sys_created_on') || '';
            }
        }

        if (errorCount === 0) {
            return findings;
        }

        // Distinguish "failing loudly" (already alerted) from "failing silently".
        // A job is failing silently if it has errors but no recent incident
        // references it. We approximate "loud" by checking for an open incident
        // whose short description mentions the job name.
        var isSilent = this._isSilentFailure(jobName);

        var severity = (errorCount >= 5) ? 'critical' : 'warning';
        var detail = {
            error_count: errorCount,
            last_error: lastError,
            last_error_time: lastErrorTime,
            lookback_days: this.LOOKBACK_DAYS,
            silent: isSilent
        };

        findings.push({
            finding_type: 'failure',
            severity: severity,
            signature: 'failure::' + jobName,
            detail_json: JSON.stringify(detail),
            remediation: isSilent
                ? 'Job "' + jobName + '" has ' + errorCount + ' error(s) in the last ' +
                  this.LOOKBACK_DAYS + ' days with no downstream alert. Review the latest error: ' +
                  lastError.substring(0, 200)
                : 'Job "' + jobName + '" has ' + errorCount + ' error(s) in the last ' +
                  this.LOOKBACK_DAYS + ' days. An incident may already exist; verify triage.'
        });

        return findings;
    },

    /**
     * Detect orphaned references: job_context pointing at deleted/missing targets.
     * @param {object} triggerGr - GlideRecord on sys_trigger
     * @returns {array} findings
     */
    checkOrphanedRef: function(triggerGr) {
        var findings = [];
        var jobName = triggerGr.getValue('name') || '';
        var jobContext = triggerGr.getValue('job_context') || '';
        var jobType = this._resolveJobType(triggerGr);

        if (jobType === 'script') {
            // Scheduled Script Execution: script body must be non-empty,
            // and if job_context references sysauto_script it must exist.
            var scriptBody = triggerGr.getValue('script') || '';
            if (jobContext) {
                var autoGr = new GlideRecord('sysauto_script');
                if (!autoGr.get(jobContext)) {
                    findings.push(this._orphanFinding(jobName, 'script',
                        'Scheduled Script Execution record ' + jobContext + ' no longer exists'));
                }
            } else if (!scriptBody || scriptBody.trim() === '') {
                findings.push(this._orphanFinding(jobName, 'script',
                    'Script body is empty'));
            }
        } else if (jobType === 'flow') {
            if (!jobContext) {
                findings.push(this._orphanFinding(jobName, 'flow',
                    'No flow reference (job_context is empty)'));
            } else {
                var flowGr = new GlideRecord('sys_hub_flow');
                if (!flowGr.get(jobContext)) {
                    findings.push(this._orphanFinding(jobName, 'flow',
                        'Flow ' + jobContext + ' no longer exists'));
                } else if (flowGr.getValue('active') !== 'true' && flowGr.getValue('active') !== '1') {
                    findings.push(this._orphanFinding(jobName, 'flow',
                        'Flow "' + flowGr.getValue('name') + '" is inactive'));
                }
            }
        } else if (jobType === 'import') {
            if (!jobContext) {
                findings.push(this._orphanFinding(jobName, 'import',
                    'No import reference (job_context is empty)'));
            } else {
                var impGr = new GlideRecord('scheduled_data_import');
                if (!impGr.get(jobContext)) {
                    findings.push(this._orphanFinding(jobName, 'import',
                        'Scheduled import ' + jobContext + ' no longer exists'));
                }
            }
        } else {
            // Generic fallback: if job_context is set, verify the referenced
            // record exists on its table.
            if (jobContext) {
                var refTable = triggerGr.getElement('job_context').getED().getReference();
                if (refTable) {
                    var refGr = new GlideRecord(refTable);
                    if (!refGr.get(jobContext)) {
                        findings.push(this._orphanFinding(jobName, 'other',
                            'Referenced ' + refTable + ' record ' + jobContext + ' no longer exists'));
                    }
                }
            }
        }

        return findings;
    },

    /**
     * Detect schedule collisions and peak-hour offenders.
     * @param {object} triggerGr - GlideRecord on sys_trigger
     * @returns {array} findings
     */
    checkOverlap: function(triggerGr) {
        var findings = [];
        var jobName = triggerGr.getValue('name') || '';
        var runTime = triggerGr.getValue('run_time') || '';
        var runDay = triggerGr.getValue('run_dayofweek') || '';
        var triggerType = triggerGr.getValue('trigger_type') || '';

        // Peak-hour offender: daily/weekly jobs running 09:00-17:00.
        if (runTime && (triggerType === '2' || triggerType === '3')) {
            var hour = this._parseHour(runTime);
            if (hour >= this.PEAK_START && hour < this.PEAK_END) {
                findings.push({
                    finding_type: 'peak_hour',
                    severity: 'warning',
                    signature: 'peak_hour::' + jobName,
                    detail_json: JSON.stringify({ run_time: runTime, hour: hour }),
                    remediation: 'Job "' + jobName + '" runs at ' + runTime +
                        ' (peak hours). Consider rescheduling off-peak (before 09:00 or after 17:00).'
                });
            }
        }

        // Collision: another active job with the same run_time + run_dayofweek.
        if (runTime && (triggerType === '2' || triggerType === '3')) {
            var siblingGr = new GlideRecord('sys_trigger');
            siblingGr.addQuery('active', true);
            siblingGr.addQuery('run_time', runTime);
            if (runDay) {
                siblingGr.addQuery('run_dayofweek', runDay);
            }
            siblingGr.addQuery('sys_id', '!=', triggerGr.getUniqueValue());
            siblingGr.setLimit(20);
            siblingGr.query();

            var colliders = [];
            while (siblingGr.next()) {
                colliders.push(siblingGr.getValue('name') || siblingGr.getUniqueValue());
            }

            if (colliders.length > 0) {
                var cappedColliders = colliders.slice(0, 20);
                var overlapDetail = JSON.stringify({ run_time: runTime, run_day: runDay, colliders: cappedColliders });
                if (overlapDetail.length > 3900) {
                    overlapDetail = overlapDetail.substring(0, 3900);
                }
                findings.push({
                    finding_type: 'overlap',
                    severity: 'warning',
                    signature: 'overlap::' + runTime + '::' + runDay,
                    detail_json: overlapDetail,
                    remediation: 'Job "' + jobName + '" collides with ' + colliders.length +
                        ' other job(s) at ' + runTime + ': ' + colliders.join(', ').substring(0, 300)
                });
            }
        }

        return findings;
    },

    /**
     * Detect dead/stale jobs: never-run, stale, disabled-but-referenced.
     * @param {object} triggerGr - GlideRecord on sys_trigger
     * @returns {array} findings
     */
    checkStale: function(triggerGr) {
        var findings = [];
        var jobName = triggerGr.getValue('name') || '';
        var nextAction = triggerGr.getValue('next_action') || '';
        var triggerType = triggerGr.getValue('trigger_type') || '';

        // Never-run: run-once job with a past next_action and no run history.
        if (triggerType === '0' && nextAction) {
            var na = new GlideDateTime(nextAction);
            var now = new GlideDateTime();
            if (na.before(now)) {
                var ran = this._hasRunHistory(jobName);
                if (!ran) {
                    findings.push({
                        finding_type: 'stale',
                        severity: 'warning',
                        signature: 'stale::never_run::' + jobName,
                        detail_json: JSON.stringify({ next_action: nextAction, trigger_type: triggerType }),
                        remediation: 'Job "' + jobName + '" was scheduled to run at ' + nextAction +
                            ' but has no execution history. It may have never fired.'
                    });
                }
            }
        }

        // Stale: active job with no execution in STALE_DAYS.
        var lastRun = this._getLastRun(jobName);
        if (lastRun) {
            var lr = new GlideDateTime(lastRun);
            var cutoff = new GlideDateTime();
            cutoff.addDaysUTC(-this.STALE_DAYS);
            if (lr.before(cutoff)) {
                findings.push({
                    finding_type: 'stale',
                    severity: 'warning',
                    signature: 'stale::no_exec::' + jobName,
                    detail_json: JSON.stringify({ last_run: lastRun, stale_days: this.STALE_DAYS }),
                    remediation: 'Job "' + jobName + '" has not executed since ' + lastRun +
                        ' (' + this.STALE_DAYS + '+ days). Its schedule may be broken or the job is dead.'
                });
            }
        }

        return findings;
    },

    /**
     * Detect ownership gaps: no owner, deactivated owner.
     * @param {object} triggerGr - GlideRecord on sys_trigger
     * @returns {array} findings
     */
    checkOwnership: function(triggerGr) {
        var findings = [];
        var jobName = triggerGr.getValue('name') || '';
        // sys_trigger has no assigned_to/assignment_group fields; the
        // accountable owner is the user who created the job (sys_created_by).
        var assignedTo = triggerGr.getValue('sys_created_by') || '';

        if (!assignedTo) {
            findings.push({
                finding_type: 'ownership',
                severity: 'warning',
                signature: 'ownership::none::' + jobName,
                detail_json: JSON.stringify({ assigned_to: '', assignment_group: '' }),
                remediation: 'Job "' + jobName + '" has no owner (no sys_created_by). ' +
                    'Assign an accountable owner for this automation.'
            });
            return findings;
        }

        // Deactivated owner.
        if (assignedTo) {
            var userGr = new GlideRecord('sys_user');
            if (userGr.get(assignedTo)) {
                var active = userGr.getValue('active');
                if (active !== 'true' && active !== '1') {
                    findings.push({
                        finding_type: 'ownership',
                        severity: 'critical',
                        signature: 'ownership::deactivated::' + jobName,
                        detail_json: JSON.stringify({ assigned_to: assignedTo, owner_name: userGr.getValue('name') }),
                        remediation: 'Job "' + jobName + '" is owned by deactivated user "' +
                            (userGr.getValue('name') || assignedTo) + '". Reassign to an active owner.'
                    });
                }
            }
        }

        return findings;
    },

    /**
     * Upsert a finding, deduping by (job_id, finding_type, signature).
     * @param {object} f - finding data
     * @returns {string} sys_id of the finding
     */
    _upsertFinding: function(f) {
        var now = new GlideDateTime().toString();

        var gr = new GlideRecord('x_jobpulse_finding');
        gr.addQuery('job_id', f.job_id);
        gr.addQuery('finding_type', f.finding_type);
        gr.addQuery('signature', f.signature);
        gr.addQuery('resolved', false);
        gr.setLimit(1);
        gr.query();

        if (gr.next()) {
            // Existing open finding: refresh last_seen and detail.
            gr.setValue('last_seen', now);
            gr.setValue('detail_json', f.detail_json);
            gr.setValue('remediation', f.remediation);
            gr.setValue('severity', f.severity);
            gr.setWorkflow(false);
            gr.update();
            return gr.getUniqueValue();
        }

        // New finding.
        var newGr = new GlideRecord('x_jobpulse_finding');
        newGr.initialize();
        newGr.setValue('job_id', f.job_id);
        newGr.setValue('job_name', f.job_name);
        newGr.setValue('job_type', f.job_type);
        newGr.setValue('finding_type', f.finding_type);
        newGr.setValue('severity', f.severity);
        newGr.setValue('signature', f.signature);
        newGr.setValue('detail_json', f.detail_json);
        newGr.setValue('remediation', f.remediation);
        newGr.setValue('first_seen', now);
        newGr.setValue('last_seen', now);
        newGr.setValue('resolved', false);
        newGr.setWorkflow(false);
        return newGr.insert();
    },

    /**
     * Upsert the health record for a job.
     */
    _upsertHealth: function(triggerGr, health, totalFindings, criticalFindings) {
        var now = new GlideDateTime().toString();
        var jobSysId = triggerGr.getUniqueValue();
        var jobName = triggerGr.getValue('name') || jobSysId;
        var lastRun = this._getLastRun(jobName);
        var status = this._statusForScore(health.health_score);
        var owner = triggerGr.getValue('sys_created_by') || '';

        var gr = new GlideRecord('x_jobpulse_health');
        gr.addQuery('job_id', jobSysId);
        gr.setLimit(1);
        gr.query();

        if (gr.next()) {
            gr.setValue('health_score', health.health_score);
            gr.setValue('exec_health', health.exec_health);
            gr.setValue('ref_integrity', health.ref_integrity);
            gr.setValue('schedule_sanity', health.schedule_sanity);
            gr.setValue('ownership', health.ownership);
            gr.setValue('total_findings', totalFindings);
            gr.setValue('critical_findings', criticalFindings);
            gr.setValue('last_run', lastRun);
            gr.setValue('next_action', triggerGr.getValue('next_action') || '');
            gr.setValue('owner', owner);
            gr.setValue('status', status);
            gr.setValue('scanned_at', now);
            gr.setWorkflow(false);
            gr.update();
            return gr.getUniqueValue();
        }

        var newGr = new GlideRecord('x_jobpulse_health');
        newGr.initialize();
        newGr.setValue('job_id', jobSysId);
        newGr.setValue('job_name', jobName);
        newGr.setValue('health_score', health.health_score);
        newGr.setValue('exec_health', health.exec_health);
        newGr.setValue('ref_integrity', health.ref_integrity);
        newGr.setValue('schedule_sanity', health.schedule_sanity);
        newGr.setValue('ownership', health.ownership);
        newGr.setValue('total_findings', totalFindings);
        newGr.setValue('critical_findings', criticalFindings);
        newGr.setValue('last_run', lastRun);
        newGr.setValue('next_action', triggerGr.getValue('next_action') || '');
        newGr.setValue('owner', owner);
        newGr.setValue('status', status);
        newGr.setValue('scanned_at', now);
        newGr.setWorkflow(false);
        return newGr.insert();
    },

    /**
     * Map a 0-100 health score to the status choice value.
     */
    _statusForScore: function(score) {
        if (score >= 80) { return 'healthy'; }
        if (score >= 50) { return 'at_risk'; }
        return 'critical';
    },

    /**
     * Resolve the job type from job_context's reference table.
     * @param {object} triggerGr
     * @returns {string} script|flow|import|other
     */
    _resolveJobType: function(triggerGr) {
        var jobContext = triggerGr.getValue('job_context') || '';
        if (jobContext) {
            var ed = triggerGr.getElement('job_context');
            if (ed && ed.getED) {
                var ref = ed.getED().getReference();
                if (ref === 'sysauto_script') { return 'script'; }
                if (ref === 'sys_hub_flow') { return 'flow'; }
                if (ref === 'scheduled_data_import') { return 'import'; }
            }
        }
        // Fallback: scheduled script execution stores script directly on sys_trigger.
        if (triggerGr.getValue('script')) {
            return 'script';
        }
        return 'other';
    },

    /**
     * Build an orphan finding.
     */
    _orphanFinding: function(jobName, jobType, message) {
        return {
            finding_type: 'orphan',
            severity: 'critical',
            signature: 'orphan::' + jobType + '::' + jobName,
            detail_json: JSON.stringify({ dangling_ref: message, job_type: jobType }),
            remediation: 'Job "' + jobName + '" has a dangling reference: ' + message +
                '. Repair or retire the job.'
        };
    },

    /**
     * Approximate whether a failing job is already alerted (failing loudly).
     * Checks for an open incident whose short description mentions the job name.
     */
    _isSilentFailure: function(jobName) {
        var incGr = new GlideRecord('incident');
        incGr.addQuery('active', true);
        incGr.addQuery('short_description', 'CONTAINS', jobName);
        incGr.setLimit(1);
        incGr.query();
        return !incGr.hasNext();
    },

    /**
     * Check whether a job has any run history in syslog.
     */
    _hasRunHistory: function(jobName) {
        var logGr = new GlideRecord('syslog');
        logGr.addQuery('source', jobName);
        logGr.setLimit(1);
        logGr.query();
        return logGr.hasNext();
    },

    /**
     * Get the most recent execution timestamp for a job from syslog.
     */
    _getLastRun: function(jobName) {
        var logGr = new GlideRecord('syslog');
        logGr.addQuery('source', jobName);
        logGr.orderByDesc('sys_created_on');
        logGr.setLimit(1);
        logGr.query();
        if (logGr.next()) {
            return logGr.getValue('sys_created_on') || '';
        }
        return '';
    },

    /**
     * Parse an hour (0-23) from a run_time string like "14:30:00".
     */
    _parseHour: function(runTime) {
        var parts = runTime.split(':');
        if (parts.length > 0) {
            var h = parseInt(parts[0], 10);
            if (!isNaN(h)) {
                return h;
            }
        }
        return -1;
    },

    /**
     * Load the JSON config from the x_jobpulse.config system property.
     */
    _getConfig: function() {
        var defaults = {
            weights: { exec: 0.40, ref: 0.30, schedule: 0.20, ownership: 0.10 },
            stale_days: 30,
            lookback_days: 7,
            peak_start: 9,
            peak_end: 17,
            ai_recommendations: false
        };
        try {
            var raw = gs.getProperty('x_jobpulse.config', '');
            if (raw) {
                var parsed = JSON.parse(raw);
                for (var k in defaults) {
                    if (defaults.hasOwnProperty(k) && parsed[k] !== undefined) {
                        defaults[k] = parsed[k];
                    }
                }
            }
        } catch (e) {
            gs.warn('JobPulseScanner._getConfig: invalid config JSON, using defaults: ' + e);
        }
        return defaults;
    },

    type: 'JobPulseScanner'
};
