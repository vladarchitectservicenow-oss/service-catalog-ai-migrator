// PortalWidget Medic — REST: Execute (POST action-dispatch)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single POST endpoint dispatching on the `action` body parameter:
//   { "action": "run_scan", "incremental": true }  -> trigger a scan
//   { "action": "report", "format": "json|csv|markdown" } -> render audit report
// Unknown or missing action returns HTTP 400.

(function process(request, response) {
    var api = new PwmApi();
    var body = request.body ? request.body.data : null;
    var action = body && body.action ? body.action : '';

    try {
        if (action === 'run_scan') {
            var incremental = body.incremental === true || body.incremental === 'true';
            var stats = api.runScan(incremental);
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, data: stats }));
            return;
        }

        if (action === 'report') {
            var format = body.format || 'json';
            if (format !== 'json' && format !== 'csv' && format !== 'markdown') {
                response.setStatus(400);
                response.setBody(JSON.stringify({ ok: false, error: { message: 'Unsupported format: ' + format } }));
                return;
            }
            var report = api.generateReport(format);
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, format: format, data: report }));
            return;
        }

        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Unknown or missing action. Supported: run_scan, report' } }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Internal error: ' + e } }));
    }
})(request, response);
