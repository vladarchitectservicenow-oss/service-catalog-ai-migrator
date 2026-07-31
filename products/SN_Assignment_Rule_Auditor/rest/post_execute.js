// SN Assignment Rule Auditor — REST API: POST /api/x_sn_ara/execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint for all write/query operations.
// Valid actions: scan, simulate, explain, create_baseline, compare_baseline

(function process(request, response) {
    var body = request.body ? request.body.data : {};
    var action = body.action || '';

    var helper = new AssignmentRuleHelper();
    var engine = new AssignmentRuleEngine();
    var result;

    switch (action) {
        case 'scan':
            result = engine.scanAll(body.table_name || null);
            break;

        case 'simulate':
            if (!body.table_name || !body.field_values) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'table_name and field_values are required for simulation' }));
                return;
            }
            result = engine.simulate(body.table_name, body.field_values);
            if (body.save_scenario) {
                helper.saveSimulation(body.table_name, body.field_values, result, body.scenario_name || null);
            }
            break;

        case 'explain':
            if (!body.conflict_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'conflict_id is required for explanation' }));
                return;
            }
            result = { explanation: helper.explainConflict(body.conflict_id) };
            break;

        case 'create_baseline':
            if (!body.name) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'name is required for baseline creation' }));
                return;
            }
            var baselineId = helper.createBaseline(body.name, body.created_by || null);
            result = { baseline_id: baselineId, status: baselineId ? 'created' : 'failed' };
            break;

        case 'compare_baseline':
            if (!body.baseline_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'baseline_id is required for comparison' }));
                return;
            }
            result = helper.compareBaseline(body.baseline_id);
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'simulate', 'explain', 'create_baseline', 'compare_baseline']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
