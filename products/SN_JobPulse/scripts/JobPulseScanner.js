// JobPulse — Scheduled Job Health & Overlap Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// JobPulseScanner — inventory, ownership mapping, duplicate detection,
// stale/abandoned job identification. Reads OOTB tables (sys_trigger,
// sys_trigger_job, syslog, sys_db_object, sys_scope) and populates
// the jobpulse_health table.
// @class JobPulseScanner @namespace x_jbpls

var JobPulseScanner = Class.create();
JobPulseScanner.prototype = {

    initialize: function() {
        this.healthTable = 'x_jbpls_jobpulse_health';
        this.configTable = 'x_jbpls_jobpulse_config';
    },

    scanAll: function(staleDays) {
        var startTime = new GlideDateTime();
        var result = {total: 0, scanned: 0, errors: 0, duration_ms: 0};
        if (!staleDays) staleDays = parseInt(this._getConfig('stale_days', '30'), 10);
        var grTrigger = new GlideRecord('sys_trigger');
        grTrigger.addQuery('trigger_type', '=', 0);
        grTrigger.query();
        result.total = grTrigger.getRowCount();
        while (grTrigger.next()) {
            try { this._scanSingleJob(grTrigger, staleDays); result.scanned++; }
            catch (e) { result.errors++; gs.error('JobPulseScanner.scanAll: ' + grTrigger.getValue('sys_id') + ': ' + e.message); }
        }
        var endTime = new GlideDateTime();
        result.duration_ms = GlideDateTime.subtract(endTime, startTime).getNumericValue();
        return result;
    },

    scanSingle: function(sysId, staleDays) {
        if (!staleDays) staleDays = parseInt(this._getConfig('stale_days', '30'), 10);
        var grTrigger = new GlideRecord('sys_trigger');
        if (!grTrigger.get(sysId)) return {error: 'Job not found: ' + sysId};
        return this._scanSingleJob(grTrigger, staleDays);
    },

    mapOwnership: function(grTrigger) {
        var ownership = {scope: grTrigger.getValue('sys_scope') || '', target_table: '', script_name: ''};
        var script = grTrigger.getValue('script') || '';
        var jobContext = grTrigger.getValue('job_context') || '';
        if (jobContext) {
            try { var ctx = JSON.parse(jobContext); ownership.target_table = ctx.table_name || ctx.target_table || ''; }
            catch (e) { var tableMatch = jobContext.match(/table[=:]\s*['"]?(\w+)/i); if (tableMatch) ownership.target_table = tableMatch[1]; }
        }
        if (!ownership.target_table && script) {
            var grMatch = script.match(/GlideRecord\s*\(\s*['"](\w+)['"]/);
            if (grMatch) ownership.target_table = grMatch[1];
        }
        var scriptName = grTrigger.getValue('script_name') || '';
        if (scriptName) ownership.script_name = scriptName;
        else if (script) { var fnMatch = script.match(/function\s+(\w+)/); if (fnMatch) ownership.script_name = fnMatch[1]; }
        return ownership;
    },

    findDuplicates: function() {
        var duplicates = [], jobMap = {};
        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('trigger_type', '=', 0);
        gr.addQuery('active', '=', true);
        gr.query();
        while (gr.next()) {
            var script = gr.getValue('script') || '';
            var schedule = gr.getValue('schedule') || '';
            var key = this._hashKey(script + '|' + schedule);
            if (!jobMap[key]) jobMap[key] = [];
            jobMap[key].push({sys_id: gr.getValue('sys_id'), name: gr.getValue('name')});
        }
        for (var k in jobMap) {
            if (jobMap[k].length > 1) {
                for (var i = 1; i < jobMap[k].length; i++)
                    duplicates.push({job1_sys_id: jobMap[k][0].sys_id, job2_sys_id: jobMap[k][i].sys_id, reason: 'Identical script and schedule'});
            }
        }
        return {duplicates: duplicates};
    },

    findStale: function(days) {
        if (!days) days = parseInt(this._getConfig('stale_days', '30'), 10);
        var stale = [];
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-days * 86400);
        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('trigger_type', '=', 0);
        gr.addQuery('active', '=', true);
        gr.query();
        while (gr.next()) {
            var lastSuccess = this._getLastSuccess(gr.getValue('sys_id'));
            if (!lastSuccess) stale.push({sys_id: gr.getValue('sys_id'), name: gr.getValue('name'), last_success: null, reason: 'Never completed successfully'});
            else { var lastGDT = new GlideDateTime(lastSuccess); if (lastGDT.before(cutoff)) stale.push({sys_id: gr.getValue('sys_id'), name: gr.getValue('name'), last_success: lastSuccess, reason: 'No success in ' + days + ' days'}); }
        }
        return {stale: stale};
    },

    findAbandoned: function() {
        var abandoned = [];
        var gr = new GlideRecord('sys_trigger');
        gr.addQuery('trigger_type', '=', 0);
        gr.addQuery('active', '=', true);
        gr.query();
        while (gr.next()) {
            var scopeId = gr.getValue('sys_scope'), reason = '';
            if (scopeId) {
                var grScope = new GlideRecord('sys_scope');
                if (grScope.get(scopeId)) { var scopeStatus = grScope.getValue('status') || ''; if (scopeStatus === 'retired' || scopeStatus === 'inactive') reason = 'Owning scope is ' + scopeStatus + ': ' + grScope.getValue('scope'); }
                else reason = 'Owning scope no longer exists: ' + scopeId;
            }
            if (!reason) {
                var script = gr.getValue('script') || '';
                var tableMatch = script.match(/GlideRecord\s*\(\s*['"](\w+)['"]/);
                if (tableMatch) { var grTable = new GlideRecord('sys_db_object'); grTable.addQuery('name', '=', tableMatch[1]); grTable.query(); if (!grTable.next()) reason = 'Target table no longer exists: ' + tableMatch[1]; }
            }
            if (reason) abandoned.push({sys_id: gr.getValue('sys_id'), name: gr.getValue('name'), reason: reason});
        }
        return {abandoned: abandoned};
    },

    _scanSingleJob: function(grTrigger, staleDays) {
        var sysId = grTrigger.getValue('sys_id');
        var ownership = this.mapOwnership(grTrigger);
        var grHealth = new GlideRecord(this.healthTable);
        grHealth.addQuery('trigger_sys_id', '=', sysId);
        grHealth.query();
        if (!grHealth.next()) grHealth.initialize();
        grHealth.setValue('trigger_sys_id', sysId);
        grHealth.setValue('job_name', grTrigger.getValue('name') || '');
        grHealth.setValue('job_type', this._classifyJobType(grTrigger));
        grHealth.setValue('owning_scope', ownership.scope);
        grHealth.setValue('target_table', ownership.target_table);
        grHealth.setValue('schedule_window', grTrigger.getValue('schedule') || '');
        grHealth.setValue('last_scan', new GlideDateTime());
        grHealth.setValue('scan_status', 'done');
        var execStats = this._getExecutionStats(sysId);
        grHealth.setValue('last_run', execStats.last_run || '');
        grHealth.setValue('last_duration_ms', execStats.last_duration_ms || 0);
        grHealth.setValue('avg_duration_ms', execStats.avg_duration_ms || 0);
        grHealth.setValue('failure_rate_7d', execStats.failure_rate_7d || 0);
        grHealth.setValue('failure_rate_30d', execStats.failure_rate_30d || 0);
        grHealth.setValue('consecutive_fails', execStats.consecutive_fails || 0);
        var lastSuccess = this._getLastSuccess(sysId);
        if (!lastSuccess) grHealth.setValue('is_stale', true);
        else { var cutoff = new GlideDateTime(); cutoff.addSeconds(-staleDays * 86400); grHealth.setValue('is_stale', new GlideDateTime(lastSuccess).before(cutoff)); }
        grHealth.setValue('is_abandoned', this._isAbandoned(grTrigger, ownership));
        try { grHealth.update(); } catch (e) { gs.error('JobPulseScanner._scanSingleJob: update failed for ' + sysId + ': ' + e.message); }
        return {sys_id: grHealth.getValue('sys_id'), job_name: grHealth.getValue('job_name'), health_score: grHealth.getValue('health_score') || 0};
    },

    _classifyJobType: function(grTrigger) {
        var triggerType = parseInt(grTrigger.getValue('trigger_type'), 10);
        if (triggerType === 0) return 'scheduled';
        if (triggerType === 1) return 'on_demand';
        return 'run_once';
    },

    _getExecutionStats: function(triggerSysId) {
        var stats = {last_run: '', last_duration_ms: 0, avg_duration_ms: 0, failure_rate_7d: 0, failure_rate_30d: 0, consecutive_fails: 0};
        var cutoff7d = new GlideDateTime(); cutoff7d.addSeconds(-7 * 86400);
        var cutoff30d = new GlideDateTime(); cutoff30d.addSeconds(-30 * 86400);
        var total7d = 0, failed7d = 0, total30d = 0, failed30d = 0, durationSum = 0, durationCount = 0, lastRunTime = null, consecutiveFails = 0;
        var grJob = new GlideRecord('sys_trigger_job');
        grJob.addQuery('trigger', '=', triggerSysId);
        grJob.orderByDesc('sys_created_on');
        grJob.setLimit(200);
        grJob.query();
        while (grJob.next()) {
            var createdOn = grJob.getValue('sys_created_on');
            var state = grJob.getValue('state') || '';
            var duration = parseInt(grJob.getValue('duration'), 10) || 0;
            var isFailed = (state === '3' || state === '4');
            if (!lastRunTime) { lastRunTime = createdOn; stats.last_duration_ms = duration; }
            if (state === '2' || state === 'success') { durationSum += duration; durationCount++; }
            var createdGDT = new GlideDateTime(createdOn);
            if (createdGDT.after(cutoff7d)) { total7d++; if (isFailed) failed7d++; }
            if (createdGDT.after(cutoff30d)) { total30d++; if (isFailed) failed30d++; }
            if (isFailed) consecutiveFails++; else break;
        }
        stats.last_run = lastRunTime || '';
        stats.avg_duration_ms = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;
        stats.failure_rate_7d = total7d > 0 ? Math.round((failed7d / total7d) * 1000) / 10 : 0;
        stats.failure_rate_30d = total30d > 0 ? Math.round((failed30d / total30d) * 1000) / 10 : 0;
        stats.consecutive_fails = consecutiveFails;
        return stats;
    },

    _getLastSuccess: function(triggerSysId) {
        var grJob = new GlideRecord('sys_trigger_job');
        grJob.addQuery('trigger', '=', triggerSysId);
        grJob.addQuery('state', 'IN', '2,success');
        grJob.orderByDesc('sys_created_on');
        grJob.setLimit(1);
        grJob.query();
        if (grJob.next()) return grJob.getValue('sys_created_on');
        return null;
    },

    _isAbandoned: function(grTrigger, ownership) {
        var scopeId = grTrigger.getValue('sys_scope');
        if (scopeId) {
            var grScope = new GlideRecord('sys_scope');
            if (grScope.get(scopeId)) { var status = grScope.getValue('status') || ''; if (status === 'retired' || status === 'inactive') return true; }
            else return true;
        }
        if (ownership.target_table) {
            var grTable = new GlideRecord('sys_db_object');
            grTable.addQuery('name', '=', ownership.target_table);
            grTable.query();
            if (!grTable.next()) return true;
        }
        return false;
    },

    _hashKey: function(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) { var char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; }
        return 'k' + Math.abs(hash);
    },

    _getConfig: function(key, defaultValue) {
        var gr = new GlideRecord(this.configTable);
        gr.addQuery('config_key', '=', key);
        gr.query();
        if (gr.next()) return gr.getValue('config_value');
        return defaultValue;
    },

    type: 'JobPulseScanner'
};
