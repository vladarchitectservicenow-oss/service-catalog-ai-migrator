// DemoForge — Realistic Demo & Test Data Generator for ServiceNow
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET /api/x_demo_forge/status — read-only reporting endpoint.
// Query params: scenario (preview plan), run_sys_id (run detail), list (all runs).
(function process(request, response) {
    var q = request.queryParams || {};
    var engine = new DemoForgeEngine();
    var result = { queried_at: new GlideDateTime().getValue() };

    if (q.scenario) {
        // Dry-run preview: what a seed would create, without writing.
        var scenario = engine.loadScenario(q.scenario);
        if (!scenario) {
            response.setStatus(404);
            response.setBody(JSON.stringify({ error: 'Scenario not found: ' + q.scenario }));
            return;
        }
        var target = parseInt(q.count, 10) || scenario.default_count || 100;
        result.preview = engine.preview(q.scenario, target);
    } else if (q.run_sys_id) {
        // Detail for a single run.
        var gr = new GlideRecord(engine.RUN_TABLE);
        if (gr.get(q.run_sys_id)) {
            result.run = {
                sys_id: gr.getUniqueValue(),
                scenario: gr.getValue('scenario'),
                record_count: gr.getValue('record_count'),
                status: gr.getValue('status'),
                started_at: gr.getValue('started_at'),
                completed_at: gr.getValue('completed_at'),
                created_count: gr.getValue('created_count'),
                updated_count: gr.getValue('updated_count'),
                error_count: gr.getValue('error_count')
            };
        } else {
            response.setStatus(404);
            response.setBody(JSON.stringify({ error: 'Run not found: ' + q.run_sys_id }));
            return;
        }
    } else {
        // Default: list recent runs.
        var runs = [];
        var rg = new GlideRecord(engine.RUN_TABLE);
        rg.orderByDesc('started_at');
        rg.setLimit(parseInt(q.limit, 10) || 20);
        rg.query();
        while (rg.next()) {
            runs.push({
                sys_id: rg.getUniqueValue(),
                scenario: rg.getValue('scenario'),
                status: rg.getValue('status'),
                started_at: rg.getValue('started_at'),
                created_count: rg.getValue('created_count')
            });
        }
        result.runs = runs;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
