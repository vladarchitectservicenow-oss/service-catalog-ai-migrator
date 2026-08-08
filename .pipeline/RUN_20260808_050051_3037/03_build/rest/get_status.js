// FlowTest — Automated Regression Testing for Flow Designer
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST API: GET /api/x_sn_flow_test/status
// Query-dispatch endpoint for all read/status operations.

(function process(request, response) {
    var q = request.queryParams || {};
    var action = q.action || 'dashboard';

    var recorder = new FlowTestRecorder();
    var engine = new FlowTestReplayEngine();
    var result;

    switch (action) {
        case 'traces':
            result = {
                traces: recorder.listTraces(
                    q.flow_id || null,
                    q.tag || null,
                    parseInt(q.limit, 10) || 50
                )
            };
            break;

        case 'trace_detail':
            if (!q.trace_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'trace_id is required' }));
                return;
            }
            var trace = recorder.getTrace(q.trace_id);
            if (!trace) {
                response.setStatus(404);
                response.setBody(JSON.stringify({ error: 'Trace not found' }));
                return;
            }
            result = { trace: trace };
            break;

        case 'suite_results':
            if (!q.suite_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'suite_id is required' }));
                return;
            }
            result = engine.getSuiteResults(q.suite_id);
            break;

        case 'suite_history':
            if (!q.suite_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'suite_id is required' }));
                return;
            }
            result = {
                suite_id: q.suite_id,
                history: engine.getSuiteHistory(q.suite_id, parseInt(q.limit, 10) || 20)
            };
            break;

        case 'dashboard':
            result = engine.getDashboard();
            break;

        case 'suites':
            var suiteGr = new GlideRecord('x_sn_flow_test_suite');
            suiteGr.orderByDesc('last_run');
            suiteGr.setLimit(parseInt(q.limit, 10) || 50);
            suiteGr.query();

            var suites = [];
            while (suiteGr.next()) {
                suites.push({
                    sys_id: suiteGr.getUniqueValue(),
                    name: suiteGr.getValue('name'),
                    description: suiteGr.getValue('description'),
                    pass_count: parseInt(suiteGr.getValue('pass_count'), 10) || 0,
                    fail_count: parseInt(suiteGr.getValue('fail_count'), 10) || 0,
                    last_run: suiteGr.getValue('last_run'),
                    schedule: suiteGr.getValue('schedule')
                });
            }
            result = { suites: suites };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: [
                    'traces', 'trace_detail',
                    'suite_results', 'suite_history',
                    'dashboard', 'suites'
                ]
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
