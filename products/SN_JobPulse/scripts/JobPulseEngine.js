// JobPulse — Scheduled Job Health & Overlap Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// JobPulseEngine — health scoring, overlap detection, duration baselining,
// failure-rate computation, runaway detection, and remediation generation.
// Operates on jobpulse_health records populated by JobPulseScanner.
// @class JobPulseEngine @namespace x_jbpls

var JobPulseEngine = Class.create();
JobPulseEngine.prototype = {

    initialize: function() {
        this.healthTable = 'x_jbpls_jobpulse_health';
        this.configTable = 'x_jbpls_jobpulse_config';
    },

    computeHealthScore: function(grHealth) {
        var score = 100;
        var failureRate7d = parseFloat(grHealth.getValue('failure_rate_7d')) || 0;
        var failureRate30d = parseFloat(grHealth.getValue('failure_rate_30d')) || 0;
        var consecutiveFails = parseInt(grHealth.getValue('consecutive_fails'), 10) || 0;
        var failurePenalty = 0;
        if (failureRate7d > 50) failurePenalty += 50;
        else if (failureRate7d > 20) failurePenalty += 25;
        else if (failureRate7d > 5) failurePenalty += 15;
        else if (failureRate7d > 0) failurePenalty += 5;
        if (failureRate7d > failureRate30d && failureRate30d > 0) failurePenalty += 5;
        if (consecutiveFails >= 5) failurePenalty += 10;
        else if (consecutiveFails >= 3) failurePenalty += 5;
        score -= Math.min(failurePenalty, 50);
        var overlapCount = parseInt(grHealth.getValue('overlap_count'), 10) || 0;
        if (overlapCount >= 5) score -= 20;
        else if (overlapCount >= 3) score -= 15;
        else if (overlapCount >= 1) score -= 10;
        if (grHealth.getValue('is_runaway') === 'true' || grHealth.getValue('is_runaway') === true) score -= 15;
        if (grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true) score -= 15;
        if (grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true) score -= 10;
        var duplicateOf = grHealth.getValue('duplicate_of') || '';
        if (duplicateOf) score -= 5;
        return Math.max(0, Math.min(100, score));
    },

    detectOverlaps: function(jobs) {
        var overlaps = [];
        var overlapWindowMin = parseInt(this._getConfig('overlap_window_min', '5'), 10);
        for (var i = 0; i < jobs.length; i++) {
            for (var j = i + 1; j < jobs.length; j++) {
                var jobA = jobs[i], jobB = jobs[j];
                if (!jobA.schedule_window || !jobB.schedule_window) continue;
                var overlap = this._checkOverlap(jobA, jobB, overlapWindowMin);
                if (overlap) overlaps.push(overlap);
            }
        }
        return {overlaps: overlaps};
    },

    baselineDuration: function(triggerSysId) {
        var result = {avg_duration_ms: 0, last_duration_ms: 0, is_runaway: false, sigma: 0};
        var durations = [], lastDuration = 0;
        var sigmaThreshold = parseFloat(this._getConfig('runaway_sigma', '3.0'));
        var grJob = new GlideRecord('sys_trigger_job');
        grJob.addQuery('trigger', '=', triggerSysId);
        grJob.addQuery('state', 'IN', '2,success');
        grJob.orderByDesc('sys_created_on');
        grJob.setLimit(100);
        grJob.query();
        var first = true;
        while (grJob.next()) {
            var duration = parseInt(grJob.getValue('duration'), 10) || 0;
            if (first) { lastDuration = duration; first = false; }
            durations.push(duration);
        }
        if (durations.length === 0) return result;
        var sum = 0;
        for (var d = 0; d < durations.length; d++) sum += durations[d];
        var mean = sum / durations.length;
        var varianceSum = 0;
        for (var v = 0; v < durations.length; v++) varianceSum += Math.pow(durations[v] - mean, 2);
        var stdDev = Math.sqrt(varianceSum / durations.length);
        result.avg_duration_ms = Math.round(mean);
        result.last_duration_ms = lastDuration;
        if (stdDev > 0 && lastDuration > mean) { result.sigma = (lastDuration - mean) / stdDev; result.is_runaway = result.sigma > sigmaThreshold; }
        return result;
    },

    computeFailureRate: function(triggerSysId) {
        var result = {failure_rate_7d: 0, failure_rate_30d: 0, consecutive_fails: 0, trend: 'stable'};
        var cutoff7d = new GlideDateTime(); cutoff7d.addSeconds(-7 * 86400);
        var cutoff30d = new GlideDateTime(); cutoff30d.addSeconds(-30 * 86400);
        var total7d = 0, failed7d = 0, total30d = 0, failed30d = 0, consecutiveFails = 0;
        var grJob = new GlideRecord('sys_trigger_job');
        grJob.addQuery('trigger', '=', triggerSysId);
        grJob.orderByDesc('sys_created_on');
        grJob.setLimit(200);
        grJob.query();
        while (grJob.next()) {
            var createdOn = grJob.getValue('sys_created_on');
            var state = grJob.getValue('state') || '';
            var isFailed = (state === '3' || state === '4');
            var createdGDT = new GlideDateTime(createdOn);
            if (createdGDT.after(cutoff7d)) { total7d++; if (isFailed) failed7d++; }
            if (createdGDT.after(cutoff30d)) { total30d++; if (isFailed) failed30d++; }
            if (isFailed) consecutiveFails++; else break;
        }
        result.failure_rate_7d = total7d > 0 ? Math.round((failed7d / total7d) * 1000) / 10 : 0;
        result.failure_rate_30d = total30d > 0 ? Math.round((failed30d / total30d) * 1000) / 10 : 0;
        result.consecutive_fails = consecutiveFails;
        if (result.failure_rate_7d > result.failure_rate_30d && result.failure_rate_30d > 0) result.trend = 'rising';
        else if (result.failure_rate_7d < result.failure_rate_30d && result.failure_rate_7d >= 0) result.trend = 'improving';
        return result;
    },

    findRunaways: function(sigmaThreshold) {
        if (!sigmaThreshold) sigmaThreshold = parseFloat(this._getConfig('runaway_sigma', '3.0'));
        var runaways = [];
        var grHealth = new GlideRecord(this.healthTable);
        grHealth.query();
        while (grHealth.next()) {
            var triggerSysId = grHealth.getValue('trigger_sys_id');
            var baseline = this.baselineDuration(triggerSysId);
            if (baseline.is_runaway) runaways.push({sys_id: grHealth.getValue('sys_id'), name: grHealth.getValue('job_name'), last_duration_ms: baseline.last_duration_ms, avg_duration_ms: baseline.avg_duration_ms, sigma: Math.round(baseline.sigma * 100) / 100});
        }
        return {runaways: runaways};
    },

    generateRemediation: function(grHealth) {
        var recommendations = [];
        var healthScore = parseInt(grHealth.getValue('health_score'), 10) || 0;
        if (grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true)
            recommendations.push({action: 'disable', confidence: 85, reason: 'No successful execution in threshold period', impact: 'low', detail: 'This job has not completed successfully within the configured stale window. Disabling it will stop unnecessary execution attempts.'});
        if (grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true)
            recommendations.push({action: 'disable', confidence: 95, reason: 'Owning scope retired or target table deleted', impact: 'none', detail: 'The application or table this job depends on no longer exists. The job will fail indefinitely. Safe to disable.'});
        if (grHealth.getValue('is_runaway') === 'true' || grHealth.getValue('is_runaway') === true)
            recommendations.push({action: 'investigate', confidence: 70, reason: 'Duration exceeds ' + this._getConfig('runaway_sigma', '3.0') + 'σ of baseline', impact: 'high', detail: 'This job is taking significantly longer than its historical average. Investigate for data growth, query plan changes, or resource contention.'});
        var failureRate = parseFloat(grHealth.getValue('failure_rate_7d')) || 0;
        if (failureRate > 20)
            recommendations.push({action: 'investigate', confidence: 80, reason: 'Failure rate is ' + failureRate + '% in the last 7 days', impact: 'high', detail: 'Check syslog for error patterns, verify target table integrity, and review recent changes to the job script or schedule.'});
        var duplicateOf = grHealth.getValue('duplicate_of') || '';
        if (duplicateOf)
            recommendations.push({action: 'merge', confidence: 90, reason: 'Duplicate of job ' + duplicateOf, impact: 'low', detail: 'This job has an identical script and schedule as another job. Consolidate into a single job to reduce load.'});
        var overlapCount = parseInt(grHealth.getValue('overlap_count'), 10) || 0;
        if (overlapCount > 0)
            recommendations.push({action: 'reschedule', confidence: 75, reason: overlapCount + ' schedule overlap(s) detected', impact: 'medium', detail: 'This job runs within ' + this._getConfig('overlap_window_min', '5') + ' minutes of other jobs targeting the same table. Stagger the schedule to avoid contention.'});
        if (recommendations.length === 0 && healthScore >= 80)
            recommendations.push({action: 'none', confidence: 100, reason: 'Job is healthy', impact: 'none', detail: 'No issues detected. Health score: ' + healthScore + '/100.'});
        return JSON.stringify(recommendations);
    },

    computeAllScores: function() {
        var result = {updated: 0, errors: 0};
        var allJobs = [];
        var triggerMap = {};
        var grHealth = new GlideRecord(this.healthTable);
        grHealth.query();
        while (grHealth.next()) {
            var sid = grHealth.getValue('sys_id');
            var tid = grHealth.getValue('trigger_sys_id');
            allJobs.push({sys_id: sid, trigger_sys_id: tid, schedule_window: grHealth.getValue('schedule_window') || '', target_table: grHealth.getValue('target_table') || ''});
            triggerMap[sid] = tid;
        }
        var overlapResult = this.detectOverlaps(allJobs);
        var overlapMap = {};
        for (var o = 0; o < overlapResult.overlaps.length; o++) { var ov = overlapResult.overlaps[o]; overlapMap[ov.job1] = (overlapMap[ov.job1] || 0) + 1; overlapMap[ov.job2] = (overlapMap[ov.job2] || 0) + 1; }
        var baselineMap = this._batchBaseline(allJobs);
        var grUpdate = new GlideRecord(this.healthTable);
        grUpdate.query();
        while (grUpdate.next()) {
            try {
                var triggerSysId = grUpdate.getValue('trigger_sys_id');
                var baseline = baselineMap[triggerSysId] || {avg_duration_ms: 0, last_duration_ms: 0, is_runaway: false, sigma: 0};
                grUpdate.setValue('is_runaway', baseline.is_runaway);
                grUpdate.setValue('avg_duration_ms', baseline.avg_duration_ms);
                grUpdate.setValue('last_duration_ms', baseline.last_duration_ms);
                var sysId = grUpdate.getValue('sys_id');
                grUpdate.setValue('overlap_count', overlapMap[sysId] || 0);
                var score = this.computeHealthScore(grUpdate);
                grUpdate.setValue('health_score', score);
                grUpdate.setValue('recommendations_json', this.generateRemediation(grUpdate));
                grUpdate.setValue('findings_json', JSON.stringify(this._buildFindings(grUpdate)));
                grUpdate.update();
                result.updated++;
            } catch (e) { result.errors++; gs.error('JobPulseEngine.computeAllScores: ' + grUpdate.getValue('sys_id') + ': ' + e.message); }
        }
        return result;
    },

    _batchBaseline: function(jobs) {
        var map = {};
        var triggerIds = [];
        for (var i = 0; i < jobs.length; i++) {
            var tid = jobs[i].trigger_sys_id;
            if (tid && triggerIds.indexOf(tid) === -1) triggerIds.push(tid);
        }
        if (triggerIds.length === 0) return map;
        var grJob = new GlideRecord('sys_trigger_job');
        grJob.addQuery('trigger', 'IN', triggerIds.join(','));
        grJob.addQuery('state', 'IN', '2,success');
        grJob.orderByDesc('sys_created_on');
        grJob.query();
        var durationsByTrigger = {};
        while (grJob.next()) {
            var tid = grJob.getValue('trigger');
            var duration = parseInt(grJob.getValue('duration'), 10) || 0;
            if (!durationsByTrigger[tid]) durationsByTrigger[tid] = [];
            durationsByTrigger[tid].push(duration);
        }
        var sigmaThreshold = parseFloat(this._getConfig('runaway_sigma', '3.0'));
        for (var tid in durationsByTrigger) {
            var durations = durationsByTrigger[tid];
            if (!map[tid]) map[tid] = {avg_duration_ms: 0, last_duration_ms: 0, is_runaway: false, sigma: 0};
            if (durations.length === 0) continue;
            var sum = 0;
            for (var d = 0; d < durations.length; d++) sum += durations[d];
            var mean = sum / durations.length;
            var varianceSum = 0;
            for (var v = 0; v < durations.length; v++) varianceSum += Math.pow(durations[v] - mean, 2);
            var stdDev = Math.sqrt(varianceSum / durations.length);
            var lastDuration = durations[0];
            var isRunaway = false, sigma = 0;
            if (stdDev > 0 && lastDuration > mean) { sigma = (lastDuration - mean) / stdDev; isRunaway = sigma > sigmaThreshold; }
            map[tid] = {avg_duration_ms: Math.round(mean), last_duration_ms: lastDuration, is_runaway: isRunaway, sigma: sigma};
        }
        return map;
    },

    _applyDuplicates: function(duplicates) {
        if (!duplicates || duplicates.length === 0) return;
        var pairMap = {};
        for (var i = 0; i < duplicates.length; i++) {
            var dup = duplicates[i];
            if (!pairMap[dup.job2_sys_id]) pairMap[dup.job2_sys_id] = dup.job1_sys_id;
        }
        var gr = new GlideRecord(this.healthTable);
        gr.query();
        while (gr.next()) {
            var sid = gr.getValue('sys_id');
            var triggerSysId = gr.getValue('trigger_sys_id');
            var duplicateOf = pairMap[triggerSysId] || '';
            if (duplicateOf) {
                gr.setValue('duplicate_of', duplicateOf);
                var score = this.computeHealthScore(gr);
                gr.setValue('health_score', score);
                gr.setValue('recommendations_json', this.generateRemediation(gr));
                gr.update();
            }
        }
    },

    _checkOverlap: function(jobA, jobB, windowMin) {
        if (jobA.target_table && jobB.target_table && jobA.target_table === jobB.target_table)
            return {job1: jobA.sys_id, job2: jobB.sys_id, overlap_type: 'same_table', severity: 'high', detail: 'Both jobs target table ' + jobA.target_table};
        var schedA = this._parseScheduleMinute(jobA.schedule_window);
        var schedB = this._parseScheduleMinute(jobB.schedule_window);
        if (schedA !== null && schedB !== null) {
            var diff = Math.abs(schedA - schedB);
            if (diff <= windowMin) return {job1: jobA.sys_id, job2: jobB.sys_id, overlap_type: 'schedule_window', severity: diff === 0 ? 'high' : 'medium', detail: 'Schedules within ' + diff + ' minutes'};
        }
        return null;
    },

    _parseScheduleMinute: function(schedule) {
        if (!schedule) return null;
        schedule = schedule.trim();
        var parts = schedule.split(/\s+/);
        if (parts.length >= 1) {
            var minutePart = parts[0];
            if (minutePart === '*') return 0;
            var slashMatch = minutePart.match(/^\*\/(\d+)$/);
            if (slashMatch) return parseInt(slashMatch[1], 10);
            var rangeMatch = minutePart.match(/^(\d+)\/(\d+)$/);
            if (rangeMatch) return parseInt(rangeMatch[2], 10);
            var minute = parseInt(minutePart, 10);
            if (!isNaN(minute)) return minute;
        }
        var intervalMatch = schedule.match(/interval[=:]\s*(\d+)/i);
        if (intervalMatch) return Math.round(parseInt(intervalMatch[1], 10) / 60);
        return null;
    },

    _buildFindings: function(grHealth) {
        var findings = [];
        if (grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true) findings.push({type: 'stale', severity: 'warning', detail: 'No successful execution in threshold period'});
        if (grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true) findings.push({type: 'abandoned', severity: 'critical', detail: 'Owning scope or target table no longer exists'});
        if (grHealth.getValue('is_runaway') === 'true' || grHealth.getValue('is_runaway') === true) findings.push({type: 'runaway', severity: 'warning', detail: 'Duration exceeds baseline threshold'});
        var failureRate = parseFloat(grHealth.getValue('failure_rate_7d')) || 0;
        if (failureRate > 50) findings.push({type: 'failure_rate', severity: 'critical', detail: 'Failure rate ' + failureRate + '% (7d)'});
        else if (failureRate > 20) findings.push({type: 'failure_rate', severity: 'warning', detail: 'Failure rate ' + failureRate + '% (7d)'});
        var consecutiveFails = parseInt(grHealth.getValue('consecutive_fails'), 10) || 0;
        if (consecutiveFails >= 3) findings.push({type: 'consecutive_fails', severity: 'critical', detail: consecutiveFails + ' consecutive failures'});
        var overlapCount = parseInt(grHealth.getValue('overlap_count'), 10) || 0;
        if (overlapCount > 0) findings.push({type: 'overlap', severity: overlapCount >= 3 ? 'warning' : 'info', detail: overlapCount + ' schedule overlap(s)'});
        if (grHealth.getValue('duplicate_of')) findings.push({type: 'duplicate', severity: 'info', detail: 'Duplicate of another job'});
        return findings;
    },

    _getConfig: function(key, defaultValue) {
        var gr = new GlideRecord(this.configTable);
        gr.addQuery('config_key', '=', key);
        gr.query();
        if (gr.next()) return gr.getValue('config_value');
        return defaultValue;
    },

    type: 'JobPulseEngine'
};
