// JobPulse — Scheduled Job Health Auditor — Analytics REST API
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0

(function process(request, response) {

    try {
        var qp = request.queryParams;
        var report = qp.report || 'summary';
        var analytics = new JobPulseAnalytics();

        if (report === 'summary') {
            var summary = analytics.getSummary();
            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'summary', data: summary }));

        } else if (report === 'overlap') {
            var overlap = analytics.getOverlapMap();
            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'overlap', data: overlap }));

        } else if (report === 'ownership') {
            var ownership = analytics.getOwnershipReport();
            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'ownership', data: ownership }));

        } else if (report === 'delta') {
            var delta = analytics.getDelta(qp.since_scan_id);
            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'delta', data: delta }));

        } else if (report === 'history') {
            var jobName = qp.job_name || '';
            if (!jobName) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'Missing required parameter: job_name' }));
                return;
            }
            var days = parseInt(qp.days, 10) || 7;
            var history = analytics.getRunHistory(jobName, days);
            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'history', data: history }));

        } else if (report === 'health') {
            // Health report: list health records, optionally filtered by severity.
            var severity = qp.severity || '';
            var limit = parseInt(qp.limit, 10) || 50;
            if (limit > 200) { limit = 200; }

            var rows = [];
            var gr = new GlideRecord('x_jobpulse_health');
            if (severity === 'critical') {
                gr.addQuery('health_score', '<', 50);
            } else if (severity === 'warning') {
                gr.addQuery('health_score', '>=', 50);
                gr.addQuery('health_score', '<', 80);
            } else if (severity === 'info') {
                gr.addQuery('health_score', '>=', 80);
            }
            gr.orderBy('health_score');
            gr.setLimit(limit);
            gr.query();

            while (gr.next()) {
                rows.push({
                    job_id: gr.getValue('job_id') || '',
                    job_name: gr.getValue('job_name') || '',
                    health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                    critical_findings: parseInt(gr.getValue('critical_findings'), 10) || 0,
                    total_findings: parseInt(gr.getValue('total_findings'), 10) || 0,
                    scanned_at: gr.getValue('scanned_at') || ''
                });
            }

            response.setStatus(200);
            response.setBody(JSON.stringify({ report: 'health', count: rows.length, data: rows }));

        } else if (report === 'failures' || report === 'orphans' || report === 'stale') {
            // Finding-type report: list open findings of a given type.
            var typeMap = { failures: 'failure', orphans: 'orphan', stale: 'stale' };
            var findingType = typeMap[report];
            var limit = parseInt(qp.limit, 10) || 50;
            if (limit > 200) { limit = 200; }

            var rows = [];
            var fGr = new GlideRecord('x_jobpulse_finding');
            fGr.addQuery('resolved', false);
            fGr.addQuery('finding_type', findingType);
            fGr.orderByDesc('last_seen');
            fGr.setLimit(limit);
            fGr.query();

            while (fGr.next()) {
                rows.push({
                    sys_id: fGr.getUniqueValue(),
                    job_id: fGr.getValue('job_id') || '',
                    job_name: fGr.getValue('job_name') || '',
                    severity: fGr.getValue('severity') || '',
                    remediation: fGr.getValue('remediation') || '',
                    last_seen: fGr.getValue('last_seen') || ''
                });
            }

            response.setStatus(200);
            response.setBody(JSON.stringify({ report: report, count: rows.length, data: rows }));

        } else {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown report: ' + report,
                valid_reports: ['summary', 'overlap', 'ownership', 'delta', 'history', 'health', 'failures', 'orphans', 'stale']
            }));
        }

    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal server error',
            detail: e.toString()
        }));
    }
})(request, response);
