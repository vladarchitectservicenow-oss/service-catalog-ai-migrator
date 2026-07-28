// SN Assignment Rule Auditor — REST API: GET /api/x_sn_ara/status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter dispatch for all read-only status/reporting operations.
// Query params: table, type (health|conflicts|dead_rules|stale_conditions|simulations|baselines)

(function process(request, response) {
    var q = request.queryParams || {};
    var tableName = q.table || '';
    var type = q.type || 'health';
    var limit = parseInt(q.limit || '20', 10);
    if (limit !== limit || limit < 1) limit = 20;

    var helper = new AssignmentRuleHelper();
    var result;

    switch (type) {
        case 'health':
            result = helper.getHealthSummary(tableName || null);
            break;

        case 'conflicts':
            if (!tableName) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'table parameter is required for conflicts query' }));
                return;
            }
            result = { table: tableName, conflicts: helper.getConflicts(tableName) };
            break;

        case 'dead_rules':
            if (!tableName) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'table parameter is required for dead_rules query' }));
                return;
            }
            result = { table: tableName, dead_rules: helper.getDeadRules(tableName) };
            break;

        case 'stale_conditions':
            if (!tableName) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'table parameter is required for stale_conditions query' }));
                return;
            }
            result = { table: tableName, stale_conditions: helper.getStaleConditions(tableName) };
            break;

        case 'simulations':
            result = { simulations: helper.getSimulationHistory(tableName || null, limit) };
            break;

        case 'baselines':
            result = { baselines: helper.getBaselines(limit) };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown type: ' + type,
                valid_types: ['health', 'conflicts', 'dead_rules', 'stale_conditions', 'simulations', 'baselines']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
