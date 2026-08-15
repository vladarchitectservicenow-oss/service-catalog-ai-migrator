// JobPulse — Scheduled Job Health Auditor — Execute REST API
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0

(function process(request, response) {

    try {
        var body = request.body.data;
        if (!body || !body.action) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Missing required parameter: action',
                valid_actions: ['scan', 'score', 'overlap', 'ownership', 'delta', 'summary', 'resolve']
            }));
            return;
        }

        var action = body.action;
        var scanner = new JobPulseScanner();
        var analytics = new JobPulseAnalytics();

        if (action === 'scan') {
            var incremental = body.incremental === true || body.incremental === 'true';
            var stats = scanner.scanAllJobs(incremental);
            response.setStatus(200);
            response.setBody(JSON.stringify({
                action: 'scan',
                scanned: stats.scanned,
                findings: stats.findings,
                critical: stats.critical
            }));

        } else if (action === 'score') {
            if (!body.job_sys_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'Missing required parameter: job_sys_id' }));
                return;
            }
            var result = scanner.scanJob(body.job_sys_id);
            response.setStatus(200);
            response.setBody(JSON.stringify(result));

        } else if (action === 'overlap') {
            var overlap = analytics.getOverlapMap();
            response.setStatus(200);
            response.setBody(JSON.stringify({ action: 'overlap', data: overlap }));

        } else if (action === 'ownership') {
            var ownership = analytics.getOwnershipReport();
            response.setStatus(200);
            response.setBody(JSON.stringify({ action: 'ownership', data: ownership }));

        } else if (action === 'delta') {
            var delta = analytics.getDelta(body.since_scan_id);
            response.setStatus(200);
            response.setBody(JSON.stringify({ action: 'delta', data: delta }));

        } else if (action === 'summary') {
            var summary = analytics.getSummary();
            response.setStatus(200);
            response.setBody(JSON.stringify({ action: 'summary', data: summary }));

        } else if (action === 'resolve') {
            if (!body.finding_sys_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'Missing required parameter: finding_sys_id' }));
                return;
            }
            var fg = new GlideRecord('x_jobpulse_finding');
            if (!fg.get(body.finding_sys_id)) {
                response.setStatus(404);
                response.setBody(JSON.stringify({ error: 'Finding not found' }));
                return;
            }
            fg.setValue('resolved', true);
            fg.setValue('resolved_at', new GlideDateTime().toString());
            fg.setWorkflow(false);
            fg.update();
            response.setStatus(200);
            response.setBody(JSON.stringify({ action: 'resolve', finding_sys_id: body.finding_sys_id, resolved: true }));

        } else {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'score', 'overlap', 'ownership', 'delta', 'summary', 'resolve']
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
