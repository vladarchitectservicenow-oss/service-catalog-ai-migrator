// BR Medic — POST /execute (action-dispatch endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single write/query endpoint. Dispatches on the `action` body parameter:
//   scan, delta_scan, set_status
// Returns HTTP 400 with valid_actions for unknown actions, and a structured
// HTTP 500 on any unexpected error (no raw stack traces leak to the caller).

(function process(request, response) {
    try {
        var body = request.body ? request.body.data : {};
        var action = body.action || '';

        var scanner = new BrmScanner();
        var report = new BrmReport();
        var result;

        switch (action) {
            case 'scan':
                // Run a full scan of all business rules and script includes.
                var scanId = scanner.runScan();
                result = { scan_id: scanId };
                break;

            case 'delta_scan':
                // Run a delta scan (only scripts changed since the high-water mark).
                var deltaScanId = scanner.runDeltaScan();
                result = { scan_id: deltaScanId };
                break;

            case 'set_status':
                // Acknowledge/dismiss/fix a finding (human-in-the-loop).
                var ok = report.setFindingStatus(body.finding_sys_id, body.status);
                result = {
                    finding_sys_id: body.finding_sys_id,
                    status: body.status,
                    updated: ok
                };
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['scan', 'delta_scan', 'set_status']
                }));
                return;
        }

        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error processing request',
            message: e.message || 'unknown error'
        }));
    }
})(request, response);
