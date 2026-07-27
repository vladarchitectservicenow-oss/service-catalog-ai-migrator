// CMDB Health Validator for AI Readiness — POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch REST endpoint for all write/query operations.
// Body: {"action": "scan|remediate|resolve_task|predict_impact", ...params}

(function process(request, response) {
    var body = {};
    try {
        if (request.body && request.body.data) {
            body = request.body.data;
        }
    } catch (e) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ error: 'Invalid request body', details: e.message }));
        return;
    }

    var action = body.action || '';
    var result = {};

    switch (action) {
        case 'scan':
            var scanner = new CmdbHealthScanner();
            var ciClassFilter = body.ci_class_filter || '';
            var scanResult = scanner.scanAll(ciClassFilter);
            if (scanResult) {
                if (scanResult.already_running) {
                    result = { scan_id: scanResult.scan_id, status: 'already_running', message: 'A health scan is already in progress' };
                } else {
                    result = { scan_id: scanResult, status: 'started', message: 'Health scan initiated' };
                }
            } else {
                response.setStatus(500);
                result = { error: 'Failed to start health scan' };
            }
            break;

        case 'remediate':
            if (!body.scan_id) {
                response.setStatus(400);
                result = { error: 'Missing required parameter: scan_id' };
                break;
            }
            var remediator = new CmdbHealthRemediator();
            result = remediator.generateRemediationPlan(body.scan_id);
            break;

        case 'resolve_task':
            if (!body.task_id) {
                response.setStatus(400);
                result = { error: 'Missing required parameter: task_id' };
                break;
            }
            var taskRemediator = new CmdbHealthRemediator();
            var resolved = taskRemediator.resolveTask(body.task_id, body.resolution_notes || '');
            result = { success: resolved, task_id: body.task_id, task_status: resolved ? 'resolved' : 'not_found' };
            break;

        case 'predict_impact':
            if (!body.scan_id) {
                response.setStatus(400);
                result = { error: 'Missing required parameter: scan_id' };
                break;
            }
            var impactRemediator = new CmdbHealthRemediator();
            var aiScope = body.ai_scope || { ci_classes: [], use_cases: [] };
            result = impactRemediator.predictAIImpact(body.scan_id, aiScope);
            break;

        default:
            response.setStatus(400);
            result = {
                error: 'Unknown action: ' + (action || '(empty)'),
                valid_actions: ['scan', 'remediate', 'resolve_task', 'predict_impact']
            };
            break;
    }

    response.setBody(JSON.stringify(result));
})(request, response);
