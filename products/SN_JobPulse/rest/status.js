// JobPulse — Scheduled Job Health & Overlap Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST API: GET /api/x_jbpls/status
// Query health records with optional filters: scope, table, score_below, type.

(function process(request, response) {

    try {
        if (!gs.hasRole('x_jbpls.user')) { response.setStatus(403); response.setBody(JSON.stringify({error: 'Forbidden'})); return; }

        var queryParams = request.queryParams;
        var scope = queryParams.scope || '';
        var table = queryParams.table || '';
        var scoreBelow = parseInt(queryParams.score_below, 10) || 0;
        var type = queryParams.type || '';
        var limit = parseInt(queryParams.limit, 10) || 100;
        var offset = parseInt(queryParams.offset, 10) || 0;

        var grHealth = new GlideRecord('x_jbpls_jobpulse_health');
        if (scope) grHealth.addQuery('owning_scope', '=', scope);
        if (table) grHealth.addQuery('target_table', '=', table);
        if (scoreBelow > 0) grHealth.addQuery('health_score', '<', scoreBelow);

        switch (type) {
            case 'overlaps': grHealth.addQuery('overlap_count', '>', 0); break;
            case 'failures': grHealth.addQuery('failure_rate_7d', '>', 0); break;
            case 'stale': grHealth.addQuery('is_stale', '=', true); break;
            case 'runaway': grHealth.addQuery('is_runaway', '=', true); break;
            case 'abandoned': grHealth.addQuery('is_abandoned', '=', true); break;
            case 'duplicates': grHealth.addNotNullQuery('duplicate_of'); break;
            case 'critical': grHealth.addQuery('health_score', '<', 50); break;
            case 'warning': grHealth.addQuery('health_score', '>=', 50); grHealth.addQuery('health_score', '<', 80); break;
            case 'healthy': grHealth.addQuery('health_score', '>=', 80); break;
        }

        var total = grHealth.getRowCount();
        grHealth.orderBy('health_score');
        if (limit > 0) grHealth.chooseWindow(offset, offset + limit, false);
        grHealth.query();

        var records = [];
        while (grHealth.next()) {
            records.push({
                sys_id: grHealth.getValue('sys_id'), trigger_sys_id: grHealth.getValue('trigger_sys_id'),
                job_name: grHealth.getValue('job_name'), job_type: grHealth.getValue('job_type'),
                owning_scope: grHealth.getValue('owning_scope'), target_table: grHealth.getValue('target_table'),
                schedule_window: grHealth.getValue('schedule_window'), last_run: grHealth.getValue('last_run'),
                last_duration_ms: parseInt(grHealth.getValue('last_duration_ms'), 10) || 0,
                avg_duration_ms: parseInt(grHealth.getValue('avg_duration_ms'), 10) || 0,
                failure_rate_7d: parseFloat(grHealth.getValue('failure_rate_7d')) || 0,
                failure_rate_30d: parseFloat(grHealth.getValue('failure_rate_30d')) || 0,
                consecutive_fails: parseInt(grHealth.getValue('consecutive_fails'), 10) || 0,
                is_runaway: grHealth.getValue('is_runaway') === 'true' || grHealth.getValue('is_runaway') === true,
                is_stale: grHealth.getValue('is_stale') === 'true' || grHealth.getValue('is_stale') === true,
                is_abandoned: grHealth.getValue('is_abandoned') === 'true' || grHealth.getValue('is_abandoned') === true,
                overlap_count: parseInt(grHealth.getValue('overlap_count'), 10) || 0,
                duplicate_of: grHealth.getValue('duplicate_of') || '',
                health_score: parseInt(grHealth.getValue('health_score'), 10) || 0,
                findings_json: grHealth.getValue('findings_json') || '',
                recommendations_json: grHealth.getValue('recommendations_json') || '',
                last_scan: grHealth.getValue('last_scan'), scan_status: grHealth.getValue('scan_status')
            });
        }

        var summary = _computeSummary(records, total);
        response.setStatus(200);
        response.setBody(JSON.stringify({total: total, returned: records.length, offset: offset, limit: limit, summary: summary, records: records}));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({error: 'Internal error: ' + e.message}));
    }

    function _computeSummary(records, total) {
        var summary = {total_jobs: total, healthy: 0, warning: 0, critical: 0, stale: 0, abandoned: 0, runaway: 0, with_overlaps: 0, duplicates: 0, avg_health_score: 0, avg_failure_rate_7d: 0};
        if (records.length === 0) return summary;
        var scoreSum = 0, failureSum = 0;
        for (var i = 0; i < records.length; i++) {
            var r = records[i], score = r.health_score;
            scoreSum += score; failureSum += r.failure_rate_7d;
            if (score >= 80) summary.healthy++;
            else if (score >= 50) summary.warning++;
            else summary.critical++;
            if (r.is_stale) summary.stale++;
            if (r.is_abandoned) summary.abandoned++;
            if (r.is_runaway) summary.runaway++;
            if (r.overlap_count > 0) summary.with_overlaps++;
            if (r.duplicate_of) summary.duplicates++;
        }
        summary.avg_health_score = Math.round(scoreSum / records.length);
        summary.avg_failure_rate_7d = Math.round((failureSum / records.length) * 10) / 10;
        return summary;
    }

})(request, response);
