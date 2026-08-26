// RetentionGuard — POST /execute (action-dispatch endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single write/query endpoint. Dispatches on the `action` body parameter:
//   run_cycle, seed_policies, add_hold, remove_hold, record_growth
// Returns HTTP 400 with valid_actions for unknown actions, and a structured
// HTTP 500 on any unexpected error (no raw stack traces leak to the caller).

(function process(request, response) {
    try {
        var body = request.body ? request.body.data : {};
        var action = body.action || '';

        var engine = new RetentionGuardEngine();
        var report = new RetentionGuardReport();
        var result;

        switch (action) {
            case 'run_cycle':
                result = engine.runCycle(body.dry_run === true || body.dry_run === 'true');
                break;

            case 'seed_policies':
                result = { created: engine.seedDefaultPolicies() };
                break;

            case 'add_hold':
                result = {
                    applied: report.addHold(body.table_name, body.reason, body.held_by)
                };
                break;

            case 'remove_hold':
                result = {
                    removed: report.removeHold(body.table_name)
                };
                break;

            case 'record_growth':
                engine.recordGrowthSnapshot(body.table_name, parseInt(body.row_count, 10) || 0);
                result = { recorded: true, table_name: body.table_name };
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['run_cycle', 'seed_policies', 'add_hold', 'remove_hold', 'record_growth']
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
