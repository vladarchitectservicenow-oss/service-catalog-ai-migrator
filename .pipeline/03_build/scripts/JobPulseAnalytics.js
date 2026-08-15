// JobPulse — Scheduled Job Health Auditor — JobPulseAnalytics
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Analytics engine: composite health scoring, run history, overlap map,
// ownership report, delta detection, remediation suggestions, and summary.

var JobPulseAnalytics = Class.create();
JobPulseAnalytics.prototype = {
    initialize: function() {
        this.WEIGHTS = { exec: 0.40, ref: 0.30, schedule: 0.20, ownership: 0.10 };
    },

    /**
     * Compute the composite 0-100 health score for a job.
     * @param {string} jobSysId - sys_trigger sys_id
     * @param {array} findings - findings produced by the scanner (optional)
     * @returns {object} {health_score, exec_health, ref_integrity, schedule_sanity, ownership}
     */
    computeHealthScore: function(jobSysId, findings) {
        if (!findings) {
            findings = this._loadFindings(jobSysId);
        }

        var execHealth = this._execHealthScore(findings);
        var refIntegrity = this._refIntegrityScore(findings);
        var scheduleSanity = this._scheduleSanityScore(findings);
        var ownershipScore = this._ownershipScore(findings);

        var score = Math.round(
            (execHealth * this.WEIGHTS.exec) +
            (refIntegrity * this.WEIGHTS.ref) +
            (scheduleSanity * this.WEIGHTS.schedule) +
            (ownershipScore * this.WEIGHTS.ownership)
        );

        score = Math.min(100, Math.max(0, score));

        return {
            health_score: score,
            exec_health: execHealth,
            ref_integrity: refIntegrity,
            schedule_sanity: scheduleSanity,
            ownership: ownershipScore
        };
    },

    /**
     * Get run history stats for a job from syslog.
     * @param {string} jobName
     * @param {number} daysBack
     * @returns {object} {success_count, error_count, last_error, last_run}
     */
    getRunHistory: function(jobName, daysBack) {
        daysBack = daysBack || 7;
        var since = new GlideDateTime();
        since.addDaysUTC(-daysBack);

        var stats = { success_count: 0, error_count: 0, last_error: '', last_run: '' };

        var logGr = new GlideRecord('syslog');
        logGr.addQuery('source', jobName);
        logGr.addQuery('sys_created_on', '>=', since.toString());
        logGr.orderByDesc('sys_created_on');
        logGr.setLimit(200);
        logGr.query();

        while (logGr.next()) {
            var level = parseInt(logGr.getValue('level'), 10);
            if (level >= 3) {
                stats.error_count++;
                if (!stats.last_error) {
                    stats.last_error = logGr.getValue('message') || '';
                }
            } else {
                stats.success_count++;
            }
            if (!stats.last_run) {
                stats.last_run = logGr.getValue('sys_created_on') || '';
            }
        }

        return stats;
    },

    /**
     * Build an overlap map: group jobs by time slot and flag collisions.
     * @returns {object} {slots: [{run_time, run_day, jobs: [...], collision: bool}]}
     */
    getOverlapMap: function() {
        var slotMap = {};

        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('active', true);
        gr.setLimit(500);
        gr.query();

        while (gr.next()) {
            var runTime = gr.getValue('run_time') || '';
            var runDay = gr.getValue('run_dayofweek') || '';
            var triggerType = gr.getValue('trigger_type') || '';
            if (!runTime || (triggerType !== '2' && triggerType !== '3')) {
                continue;
            }
            var key = runTime + '::' + runDay;
            if (!slotMap[key]) {
                slotMap[key] = { run_time: runTime, run_day: runDay, jobs: [] };
            }
            slotMap[key].jobs.push(gr.getValue('name') || gr.getUniqueValue());
        }

        var slots = [];
        for (var k in slotMap) {
            if (!slotMap.hasOwnProperty(k)) { continue; }
            var slot = slotMap[k];
            slot.collision = slot.jobs.length > 1;
            slots.push(slot);
        }

        // Sort by collision count descending, then run_time.
        slots.sort(function(a, b) {
            if (a.collision !== b.collision) { return a.collision ? -1 : 1; }
            return a.run_time < b.run_time ? -1 : 1;
        });

        return { slots: slots, total_slots: slots.length };
    },

    /**
     * Build an ownership report: aggregate unowned/deactivated-owner jobs.
     * @returns {object} {unowned: [...], deactivated_owner: [...], total}
     */
    getOwnershipReport: function() {
        var unowned = [];
        var deactivated = [];

        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('active', true);
        gr.setLimit(500);
        gr.query();

        while (gr.next()) {
            var jobName = gr.getValue('name') || gr.getUniqueValue();
            // sys_trigger has no assigned_to/assignment_group; owner = creator.
            var assignedTo = gr.getValue('sys_created_by') || '';

            if (!assignedTo) {
                unowned.push(jobName);
                continue;
            }

            if (assignedTo) {
                var userGr = new GlideRecord('sys_user');
                if (userGr.get(assignedTo)) {
                    var active = userGr.getValue('active');
                    if (active !== 'true' && active !== '1') {
                        deactivated.push({
                            job: jobName,
                            owner: userGr.getValue('name') || assignedTo
                        });
                    }
                }
            }
        }

        return {
            unowned: unowned,
            deactivated_owner: deactivated,
            total_unowned: unowned.length,
            total_deactivated: deactivated.length
        };
    },

    /**
     * Compute delta: new findings since a given scan, plus resolved findings.
     * @param {string} sinceScanId - sys_id of a prior scan (optional; uses last_seen window)
     * @returns {object} {new_findings: [...], resolved_findings: [...], new_count, resolved_count}
     */
    getDelta: function(sinceScanId) {
        var newFindings = [];
        var resolvedFindings = [];

        // New findings: open findings created since the given scan (or 24h).
        var since = this._resolveSince(sinceScanId);

        var gr = new GlideRecord('x_jobpulse_finding');
        gr.addQuery('resolved', false);
        gr.addQuery('first_seen', '>=', since.toString());
        gr.orderByDesc('first_seen');
        gr.setLimit(100);
        gr.query();
        while (gr.next()) {
            newFindings.push(this._findingToObject(gr));
        }

        // Resolved findings: resolved in the last 24h.
        var resGr = new GlideRecord('x_jobpulse_finding');
        resGr.addQuery('resolved', true);
        resGr.addQuery('resolved_at', '>=', since.toString());
        resGr.orderByDesc('resolved_at');
        resGr.setLimit(100);
        resGr.query();
        while (resGr.next()) {
            resolvedFindings.push(this._findingToObject(resGr));
        }

        return {
            new_findings: newFindings,
            resolved_findings: resolvedFindings,
            new_count: newFindings.length,
            resolved_count: resolvedFindings.length
        };
    },

    /**
     * Resolve the "since" cutoff for delta detection.
     * Accepts a finding sys_id (uses its first_seen) or a GlideDateTime string;
     * falls back to a 24-hour window.
     */
    _resolveSince: function(sinceScanId) {
        if (sinceScanId) {
            if (/^[0-9a-f]{32}$/i.test(sinceScanId)) {
                var fg = new GlideRecord('x_jobpulse_finding');
                if (fg.get(sinceScanId)) {
                    var ts = fg.getValue('first_seen') || fg.getValue('last_seen');
                    if (ts) {
                        return new GlideDateTime(ts);
                    }
                }
            }
            var gdt = new GlideDateTime(sinceScanId);
            if (gdt.isValid()) {
                return gdt;
            }
        }
        var d = new GlideDateTime();
        d.addDaysUTC(-1);
        return d;
    },

    /**
     * Generate a remediation suggestion for a finding.
     * Deterministic template; optionally expands via GenAI Controller.
     * @param {string} findingSysId
     * @returns {string} remediation text
     */
    getRemediation: function(findingSysId) {
        var gr = new GlideRecord('x_jobpulse_finding');
        if (!gr.get(findingSysId)) {
            return 'Finding not found.';
        }

        var deterministic = gr.getValue('remediation') || '';
        var cfg = this._getConfig();

        if (!cfg.ai_recommendations) {
            return deterministic;
        }

        // Optional GenAI expansion.
        var aiText = '';
        try {
            var prompt = 'You are a ServiceNow platform reliability engineer. ' +
                'Given the following scheduled-job health finding, produce a concise, ' +
                'actionable remediation plan (2-3 sentences).\n\n' +
                'Job: ' + gr.getValue('job_name') + '\n' +
                'Finding type: ' + gr.getValue('finding_type') + '\n' +
                'Severity: ' + gr.getValue('severity') + '\n' +
                'Details: ' + (gr.getValue('detail_json') || '') + '\n' +
                'Deterministic suggestion: ' + deterministic;

            var genAI = new sn_generative_ai.GlideGenerativeAI();
            aiText = genAI.generate(prompt, { max_tokens: 300, temperature: 0.3 }) || '';
        } catch (e) {
            gs.warn('JobPulseAnalytics.getRemediation: GenAI call failed, using deterministic: ' + e);
        }

        if (aiText) {
            // Persist the AI remediation so the field is not dead storage.
            gr.setValue('ai_remediation', aiText);
            gr.setWorkflow(false);
            gr.update();
            return aiText;
        }

        return deterministic;
    },

    /**
     * Build a summary report across the whole estate.
     * @returns {object} summary
     */
    getSummary: function() {
        var summary = {
            total_jobs: 0,
            healthy: 0,
            at_risk: 0,
            critical: 0,
            orphaned: 0,
            overlapping: 0,
            stale: 0,
            unowned: 0,
            deactivated_owner: 0,
            failures: 0,
            avg_health: 0,
            worst_offenders: []
        };

        var healthSum = 0;
        var healthCount = 0;

        var gr = new GlideRecord('x_jobpulse_health');
        gr.orderBy('health_score');
        gr.setLimit(500);
        gr.query();

        while (gr.next()) {
            var score = parseInt(gr.getValue('health_score'), 10) || 0;
            healthSum += score;
            healthCount++;

            if (score >= 80) { summary.healthy++; }
            else if (score >= 50) { summary.at_risk++; }
            else { summary.critical++; }

            if (score < 50 && summary.worst_offenders.length < 10) {
                summary.worst_offenders.push({
                    job: gr.getValue('job_name') || gr.getUniqueValue(),
                    score: score,
                    critical_findings: parseInt(gr.getValue('critical_findings'), 10) || 0
                });
            }
        }

        // Count finding types.
        var fGr = new GlideRecord('x_jobpulse_finding');
        fGr.addQuery('resolved', false);
        fGr.setLimit(1000);
        fGr.query();
        while (fGr.next()) {
            var type = fGr.getValue('finding_type');
            var sev = fGr.getValue('severity');
            if (type === 'orphan') { summary.orphaned++; }
            else if (type === 'overlap' || type === 'peak_hour') { summary.overlapping++; }
            else if (type === 'stale') { summary.stale++; }
            else if (type === 'ownership') {
                if (sev === 'critical') { summary.deactivated_owner++; }
                else { summary.unowned++; }
            }
            else if (type === 'failure') { summary.failures++; }
        }

        summary.total_jobs = healthCount;
        summary.avg_health = healthCount > 0 ? Math.round(healthSum / healthCount) : 0;

        return summary;
    },

    /**
     * Load open findings for a job.
     */
    _loadFindings: function(jobSysId) {
        var findings = [];
        var gr = new GlideRecord('x_jobpulse_finding');
        gr.addQuery('job_id', jobSysId);
        gr.addQuery('resolved', false);
        gr.query();
        while (gr.next()) {
            findings.push({
                finding_type: gr.getValue('finding_type'),
                severity: gr.getValue('severity')
            });
        }
        return findings;
    },

    /**
     * Execution health subscore: 100 if no failure findings, else scaled down.
     */
    _execHealthScore: function(findings) {
        var failures = 0;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].finding_type === 'failure') {
                failures++;
            }
        }
        if (failures === 0) { return 100; }
        if (failures === 1) { return 50; }
        return 0;
    },

    /**
     * Reference integrity subscore: binary — 100 if no orphan, else 0.
     */
    _refIntegrityScore: function(findings) {
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].finding_type === 'orphan') {
                return 0;
            }
        }
        return 100;
    },

    /**
     * Schedule sanity subscore: penalize overlap, peak-hour, and stale findings.
     */
    _scheduleSanityScore: function(findings) {
        var score = 100;
        for (var i = 0; i < findings.length; i++) {
            var t = findings[i].finding_type;
            if (t === 'overlap') { score -= 30; }
            else if (t === 'peak_hour') { score -= 20; }
            else if (t === 'stale') { score -= 25; }
        }
        return Math.max(0, score);
    },

    /**
     * Ownership subscore: 100 if no ownership findings, 50 if warning, 0 if critical.
     */
    _ownershipScore: function(findings) {
        var hasCritical = false;
        var hasWarning = false;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].finding_type === 'ownership') {
                if (findings[i].severity === 'critical') { hasCritical = true; }
                else { hasWarning = true; }
            }
        }
        if (hasCritical) { return 0; }
        if (hasWarning) { return 50; }
        return 100;
    },

    /**
     * Convert a finding GlideRecord to a plain object.
     */
    _findingToObject: function(gr) {
        return {
            sys_id: gr.getUniqueValue(),
            job_id: gr.getValue('job_id') || '',
            job_name: gr.getValue('job_name') || '',
            finding_type: gr.getValue('finding_type') || '',
            severity: gr.getValue('severity') || '',
            remediation: gr.getValue('remediation') || '',
            first_seen: gr.getValue('first_seen') || '',
            last_seen: gr.getValue('last_seen') || ''
        };
    },

    /**
     * Load the JSON config from the x_jobpulse.config system property.
     */
    _getConfig: function() {
        var defaults = { ai_recommendations: false };
        try {
            var raw = gs.getProperty('x_jobpulse.config', '');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed.ai_recommendations !== undefined) {
                    defaults.ai_recommendations = parsed.ai_recommendations;
                }
            }
        } catch (e) {
            gs.warn('JobPulseAnalytics._getConfig: invalid config JSON: ' + e);
        }
        return defaults;
    },

    type: 'JobPulseAnalytics'
};
