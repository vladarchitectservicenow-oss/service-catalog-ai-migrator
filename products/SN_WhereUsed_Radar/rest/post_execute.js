// WhereUsed Radar — POST /execute (action-dispatch endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single write/query endpoint. Dispatches on the `action` body parameter:
//   scan, assess_batch, diff
// Returns HTTP 400 with valid_actions for unknown actions, and a structured
// HTTP 500 on any unexpected error (no raw stack traces leak to the caller).

(function process(request, response) {
    try {
        var body = request.body ? request.body.data : {};
        var action = body.action || '';

        var scanner = new WurScanner();
        var report = new WurReport();
        var result;

        switch (action) {
            case 'scan':
                // Run a full scan for a single target object and persist it.
                var scanId = scanner.runScan(body.target_type, body.target_name);
                result = {
                    scan_id: scanId,
                    target_type: body.target_type,
                    target_name: body.target_name
                };
                break;

            case 'assess_batch':
                // Assess a list of objects (update-set / promotion preview).
                result = {
                    results: report.assessBatch(body.targets || [])
                };
                break;

            case 'diff':
                // Cross-instance / cross-update-set impact diff preview.
                result = {
                    diff: report.diffImpact(body.baseline || [], body.candidate || [])
                };
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['scan', 'assess_batch', 'diff']
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
