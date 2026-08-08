// FlowTest — Automated Regression Testing for Flow Designer
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST API: POST /api/x_sn_flow_test/execute
// Action-dispatch endpoint for all write operations.

(function process(request, response) {
    var body = request.body || {};
    var action = body.action || '';

    var recorder = new FlowTestRecorder();
    var engine = new FlowTestReplayEngine();
    var result;

    switch (action) {
        case 'record_start':
            result = {
                trace_id: recorder.startRecording(
                    body.flow_id || '',
                    body.trace_name || 'Untitled Trace',
                    body.flow_tags || ''
                ),
                message: recorder.traceId ? 'Recording started' : 'Failed to start recording'
            };
            if (!recorder.traceId) {
                response.setStatus(500);
                response.setBody(JSON.stringify(result));
                return;
            }
            break;

        case 'record_step':
            recorder.captureStep(
                body.step_name || '',
                body.action_name || '',
                body.inputs || {},
                body.outputs || {},
                body.duration || 0
            );
            result = { message: 'Step captured', step_count: recorder.serializeContext().step_count };
            break;

        case 'record_stop':
            result = {
                success: recorder.stopRecording(body.trigger_inputs || {}, body.final_output || {}),
                trace_id: recorder.traceId,
                step_count: recorder.serializeContext().step_count
            };
            break;

        case 'suite_create':
            var suiteGr = new GlideRecord('x_sn_flow_test_suite');
            suiteGr.initialize();
            suiteGr.setValue('name', body.name || 'Untitled Suite');
            suiteGr.setValue('description', body.description || '');
            suiteGr.setValue('flow_ids', JSON.stringify(body.flow_ids || []));
            suiteGr.setValue('schedule', body.schedule || '');
            suiteGr.setValue('pass_count', 0);
            suiteGr.setValue('fail_count', 0);
            suiteGr.setValue('created_by', gs.getUserID());

            var suiteId;
            try {
                suiteId = suiteGr.insert();
            } catch (e) {
                response.setStatus(500);
                response.setBody(JSON.stringify({ error: 'Failed to create suite: ' + e.message }));
                return;
            }

            result = { suite_id: suiteId, name: body.name, message: 'Suite created' };
            break;

        case 'suite_run':
            if (!body.suite_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'suite_id is required' }));
                return;
            }
            result = engine.runSuite(body.suite_id);
            break;

        case 'export':
            if (!body.suite_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'suite_id is required' }));
                return;
            }
            var bundle = engine.exportSuite(body.suite_id);
            if (!bundle) {
                response.setStatus(404);
                response.setBody(JSON.stringify({ error: 'Suite not found or export failed' }));
                return;
            }
            result = bundle;
            break;

        case 'import':
            if (!body.bundle) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'bundle is required' }));
                return;
            }
            var importedId = engine.importSuite(body.bundle);
            if (!importedId) {
                response.setStatus(500);
                response.setBody(JSON.stringify({ error: 'Import failed' }));
                return;
            }
            result = { suite_id: importedId, message: 'Suite imported' };
            break;

        case 'trace_delete':
            if (!body.trace_id) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'trace_id is required' }));
                return;
            }
            result = { success: recorder.deleteTrace(body.trace_id) };
            break;

        case 'triage':
            if (!body.trace_id || !body.diff_result) {
                response.setStatus(400);
                response.setBody(JSON.stringify({ error: 'trace_id and diff_result are required' }));
                return;
            }
            result = engine.triageWithAI(body.trace_id, body.diff_result);
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: [
                    'record_start', 'record_step', 'record_stop',
                    'suite_create', 'suite_run',
                    'export', 'import',
                    'trace_delete', 'triage'
                ]
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
