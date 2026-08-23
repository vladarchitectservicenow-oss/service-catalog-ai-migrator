// DemoForge — Realistic Demo & Test Data Generator for ServiceNow
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST /api/x_demo_forge/execute — action-dispatch endpoint.
// Actions: seed, clean, list_scenarios.
(function process(request, response) {
    var body = request.body ? request.body.data : {};
    var action = body.action || '';

    var engine = new DemoForgeEngine();
    var result;

    switch (action) {
        case 'seed':
            engine.setBatchSize(body.batch_size);
            engine.setMaxRecords(body.max_records);
            if (body.seed !== undefined && body.seed !== null) {
                engine.setSeed(body.seed);
            }
            result = engine.seed(body.scenario, body.count, body.dry_run === true);
            break;

        case 'clean':
            result = engine.clean(body.run_sys_id);
            break;

        case 'list_scenarios':
            result = { ok: true, scenarios: engine.listScenarios() };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['seed', 'clean', 'list_scenarios']
            }));
            return;
    }

    if (result && result.ok === false) {
        response.setStatus(400);
        response.setBody(JSON.stringify(result));
        return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
