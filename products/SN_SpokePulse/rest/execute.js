// SpokePulse — IntegrationHub Spoke & Connection Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST endpoint: POST /api/x_snc_spk/execute
// Action-dispatch endpoint. Body param `action` selects the operation.
// Valid actions: scan, scan_credential, scan_alias, scan_version,
// scan_dead_action, remediate, alert.
(function process(request, response) {
    var body = request.body ? request.body.data : {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    var action = body.action || 'scan';
    var engine = new SpokePulseEngine();
    var result;

    switch (action) {
        case 'scan':
            result = engine.runAndSummarize(body.trigger || 'manual');
            break;
        case 'scan_credential':
            result = engine.runScanner('credential', body.trigger || 'manual');
            result = { run_id: result, message: 'Credential scan complete.' };
            break;
        case 'scan_alias':
            result = engine.runScanner('alias', body.trigger || 'manual');
            result = { run_id: result, message: 'Alias scan complete.' };
            break;
        case 'scan_version':
            result = engine.runScanner('version', body.trigger || 'manual');
            result = { run_id: result, message: 'Spoke version scan complete.' };
            break;
        case 'scan_dead_action':
            result = engine.runScanner('dead_action', body.trigger || 'manual');
            result = { run_id: result, message: 'Dead flow-action scan complete.' };
            break;
        case 'remediate':
            if (!body.health_sys_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'Missing health_sys_id for remediate action.' }));
                return;
            }
            result = engine.generateRemediation(body.health_sys_id);
            break;
        case 'alert':
            result = engine.alertHighRisk(body.run_id, body.recipient);
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'scan_credential', 'scan_alias', 'scan_version',
                    'scan_dead_action', 'remediate', 'alert']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
