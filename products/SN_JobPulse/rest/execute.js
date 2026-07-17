// JobPulse — Scheduled Job Health & Overlap Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST API: POST /api/x_jbpls/execute
// Action-dispatch endpoint: scan, scan_single, disable, reschedule, export.

(function process(request, response) {

    try {
        var body = request.body.data;
        var action = body.action || '';

        switch (action) {
            case 'scan': _handleScan(request, response); break;
            case 'scan_single': _handleScanSingle(request, response); break;
            case 'disable': _handleDisable(request, response); break;
            case 'reschedule': _handleReschedule(request, response); break;
            case 'export': _handleExport(request, response); break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({error: 'Unknown action: ' + action, valid_actions: ['scan', 'scan_single', 'disable', 'reschedule', 'export']}));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({error: 'Internal error: ' + e.message}));
    }

    function _handleScan(request, response) {
        if (!gs.hasRole('x_jbpls.user')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }
        var staleDays = parseInt(body.stale_days, 10) || 0;
        var scanner = new JobPulseScanner();
        var result = scanner.scanAll(staleDays);
        var engine = new JobPulseEngine();
        var scoreResult = engine.computeAllScores();
        var duplicatesResult = scanner.findDuplicates();
        engine._applyDuplicates(duplicatesResult.duplicates);
        response.setStatus(200);
        response.setBody(JSON.stringify({scan: result, scoring: scoreResult, duplicates: duplicatesResult.duplicates.length, message: 'Scan and scoring complete'}));
    }

    function _handleScanSingle(request, response) {
        if (!gs.hasRole('x_jbpls.user')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }
        var sysId = body.sys_id || '';
        if (!sysId) { response.setStatus(400); response.setBody(JSON.stringify({error: 'Missing required parameter: sys_id'})); return; }
        var staleDays = parseInt(body.stale_days, 10) || 0;
        var scanner = new JobPulseScanner();
        var result = scanner.scanSingle(sysId, staleDays);
        if (result.error) { response.setStatus(404); response.setBody(JSON.stringify(result)); return; }
        var engine = new JobPulseEngine();
        var grHealth = new GlideRecord('x_jbpls_jobpulse_health');
        if (grHealth.get(result.sys_id)) {
            var triggerSysId = grHealth.getValue('trigger_sys_id');
            var baseline = engine.baselineDuration(triggerSysId);
            grHealth.setValue('is_runaway', baseline.is_runaway);
            grHealth.setValue('avg_duration_ms', baseline.avg_duration_ms);
            grHealth.setValue('last_duration_ms', baseline.last_duration_ms);
            var allJobs = [];
            var grAll = new GlideRecord('x_jbpls_jobpulse_health');
            grAll.query();
            while (grAll.next()) allJobs.push({sys_id: grAll.getValue('sys_id'), schedule_window: grAll.getValue('schedule_window') || '', target_table: grAll.getValue('target_table') || ''});
            var overlapResult = engine.detectOverlaps(allJobs);
            var overlapCount = 0;
            for (var o = 0; o < overlapResult.overlaps.length; o++) {
                if (overlapResult.overlaps[o].job1 === result.sys_id || overlapResult.overlaps[o].job2 === result.sys_id) overlapCount++;
            }
            grHealth.setValue('overlap_count', overlapCount);
            var duplicates = scanner.findDuplicates();
            var duplicateOf = '';
            for (var d = 0; d < duplicates.duplicates.length; d++) {
                var dup = duplicates.duplicates[d];
                if (dup.job2_sys_id === sysId) { duplicateOf = dup.job1_sys_id; break; }
                if (dup.job1_sys_id === sysId) { duplicateOf = dup.job2_sys_id; break; }
            }
            if (duplicateOf) grHealth.setValue('duplicate_of', duplicateOf);
            var score = engine.computeHealthScore(grHealth);
            grHealth.setValue('health_score', score);
            grHealth.setValue('recommendations_json', engine.generateRemediation(grHealth));
            grHealth.setValue('findings_json', JSON.stringify(engine._buildFindings(grHealth)));
            grHealth.update();
            result.health_score = score;
            result.is_runaway = baseline.is_runaway;
            result.is_stale = grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true;
            result.is_abandoned = grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true;
            result.overlap_count = overlapCount;
            result.findings = engine._buildFindings(grHealth);
            result.recommendations = JSON.parse(engine.generateRemediation(grHealth));
            if (duplicateOf) result.duplicate_of = duplicateOf;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    }

    function _handleDisable(request, response) {
        if (!gs.hasRole('x_jbpls.admin')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }
        var sysIds = body.sys_ids || [];
        if (typeof sysIds === 'string') sysIds = sysIds.split(',').map(function(s) { return s.trim(); });
        if (sysIds.length === 0) { response.setStatus(400); response.setBody(JSON.stringify({error: 'Missing required parameter: sys_ids'})); return; }
        var results = [];
        for (var i = 0; i < sysIds.length; i++) {
            var grTrigger = new GlideRecord('sys_trigger');
            if (grTrigger.get(sysIds[i])) {
                try {
                    grTrigger.setValue('active', false);
                    grTrigger.update();
                    results.push({sys_id: sysIds[i], status: 'disabled', name: grTrigger.getValue('name')});
                    var grHealth = new GlideRecord('x_jbpls_jobpulse_health');
                    grHealth.addQuery('trigger_sys_id', '=', sysIds[i]);
                    grHealth.query();
                    if (grHealth.next()) {
                        grHealth.setValue('scan_status', 'done');
                        grHealth.setValue('is_stale', false);
                        grHealth.setValue('is_abandoned', false);
                        grHealth.setValue('is_runaway', false);
                        grHealth.setValue('health_score', 100);
                        grHealth.setValue('findings_json', JSON.stringify([{type: 'disabled', severity: 'info', detail: 'Job has been disabled'}]));
                        grHealth.update();
                    }
                } catch (e) { results.push({sys_id: sysIds[i], status: 'error', error: e.message}); }
            } else { results.push({sys_id: sysIds[i], status: 'not_found'}); }
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({disabled: results.filter(function(r) { return r.status === 'disabled'; }).length, errors: results.filter(function(r) { return r.status === 'error'; }).length, not_found: results.filter(function(r) { return r.status === 'not_found'; }).length, results: results}));
    }

    function _handleReschedule(request, response) {
        if (!gs.hasRole('x_jbpls.admin')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }
        var sysId = body.sys_id || '';
        var newSchedule = body.schedule || '';
        if (!sysId || !newSchedule) { response.setStatus(400); response.setBody(JSON.stringify({error: 'Missing required parameters: sys_id, schedule'})); return; }
        if (!_validateCron(newSchedule)) { response.setStatus(400); response.setBody(JSON.stringify({error: 'Invalid cron schedule: ' + newSchedule})); return; }
        var grTrigger = new GlideRecord('sys_trigger');
        if (!grTrigger.get(sysId)) { response.setStatus(404); response.setBody(JSON.stringify({error: 'Job not found: ' + sysId})); return; }
        var oldSchedule = grTrigger.getValue('schedule') || '';
        try {
            grTrigger.setValue('schedule', newSchedule);
            grTrigger.update();
            var grHealth = new GlideRecord('x_jbpls_jobpulse_health');
            grHealth.addQuery('trigger_sys_id', '=', sysId);
            grHealth.query();
            if (grHealth.next()) {
                grHealth.setValue('schedule_window', newSchedule);
                grHealth.update();
            }
            response.setStatus(200);
            response.setBody(JSON.stringify({sys_id: sysId, name: grTrigger.getValue('name'), old_schedule: oldSchedule, new_schedule: newSchedule, status: 'rescheduled'}));
        } catch (e) { response.setStatus(500); response.setBody(JSON.stringify({error: 'Failed to update schedule: ' + e.message})); }
    }

    function _handleExport(request, response) {
        if (!gs.hasRole('x_jbpls.user')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }
        var format = body.format || 'json';
        var scopeFilter = body.scope || '';
        var scoreBelow = parseInt(body.score_below, 10) || 0;
        var grHealth = new GlideRecord('x_jbpls_jobpulse_health');
        if (scopeFilter) grHealth.addQuery('owning_scope', '=', scopeFilter);
        if (scoreBelow > 0) grHealth.addQuery('health_score', '<', scoreBelow);
        grHealth.orderBy('health_score');
        grHealth.query();
        var records = [];
        while (grHealth.next()) {
            records.push({sys_id: grHealth.getValue('sys_id'), job_name: grHealth.getValue('job_name'), job_type: grHealth.getValue('job_type'), owning_scope: grHealth.getValue('owning_scope'), target_table: grHealth.getValue('target_table'), health_score: parseInt(grHealth.getValue('health_score'), 10) || 0, failure_rate_7d: parseFloat(grHealth.getValue('failure_rate_7d')) || 0, is_stale: grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true, is_abandoned: grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true, is_runaway: grHealth.getValue('is_runaway') === 'true' || grHealth.getValue('is_runaway') === true, overlap_count: parseInt(grHealth.getValue('overlap_count'), 10) || 0, last_scan: grHealth.getValue('last_scan')});
        }
        if (format === 'csv') {
            var csv = 'sys_id,job_name,job_type,owning_scope,target_table,health_score,failure_rate_7d,is_stale,is_abandoned,is_runaway,overlap_count\n';
            for (var r = 0; r < records.length; r++) {
                var rec = records[r];
                csv += [_csvEscape(rec.sys_id), _csvEscape(rec.job_name), _csvEscape(rec.job_type), _csvEscape(rec.owning_scope), _csvEscape(rec.target_table), rec.health_score, rec.failure_rate_7d, rec.is_stale, rec.is_abandoned, rec.is_runaway, rec.overlap_count].join(',') + '\n';
            }
            response.setContentType('text/csv');
            response.setStatus(200);
            response.setBody(csv);
        } else {
            response.setStatus(200);
            response.setBody(JSON.stringify({count: records.length, records: records}));
        }
    }

    function _validateCron(schedule) {
        if (!schedule) return false;
        var parts = schedule.trim().split(/\s+/);
        if (parts.length < 5) return false;
        for (var i = 0; i < 5; i++) {
            var p = parts[i];
            if (p === '*') continue;
            if (/^\d+$/.test(p)) continue;
            if (/^\*\/(\d+)$/.test(p)) continue;
            if (/^(\d+)\/(\d+)$/.test(p)) continue;
            if (/^(\d+)-(\d+)$/.test(p)) continue;
            if (/^(\d+),(\d+)/.test(p)) continue;
            return false;
        }
        return true;
    }

    function _csvEscape(val) {
        if (!val) return '';
        var str = String(val);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) return '"' + str.replace(/"/g, '""') + '"';
        return str;
    }

})(request, response);
