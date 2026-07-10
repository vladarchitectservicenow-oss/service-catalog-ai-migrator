// Notification Trace — REST API: POST /api/x_ntrc/trace
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint: trace, overlap, health, remediate.
// Body: { action: "trace"|"overlap"|"health"|"remediate", ...params }

(function process(request, response) {

    var tracer = new NotificationTracer();
    var analyzer = new TraceAnalyzer();
    var body = request.body ? request.body.data : null;

    if (!body || !body.action) {
        response.setStatus(400);
        response.setBody(JSON.stringify({
            error: 'Missing required parameter: action',
            valid_actions: ['trace', 'overlap', 'health', 'remediate']
        }));
        return;
    }

    var action = body.action;

    try {
        switch (action) {
            case 'trace':
                _handleTrace(body, tracer, analyzer, response);
                break;

            case 'overlap':
                _handleOverlap(analyzer, response);
                break;

            case 'health':
                _handleHealth(analyzer, response);
                break;

            case 'remediate':
                _handleRemediate(body, tracer, response);
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['trace', 'overlap', 'health', 'remediate']
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error: ' + e.toString(),
            action: action
        }));
    }

    /**
     * Handle trace action: traceRecord + store + timeline + AI.
     */
    function _handleTrace(body, tracer, analyzer, response) {
        if (!body.table_name || !body.record_sys_id) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Missing required parameters: table_name, record_sys_id'
            }));
            return;
        }

        var traceResult = tracer.traceRecord(body.table_name, body.record_sys_id);
        var timeline = analyzer.generateTimeline(traceResult);

        // Store the result
        var storedSysId = tracer.storeTraceResult(traceResult, 'record', timeline);

        // AI explanation if requested
        var aiExplanation = null;
        if (body.ai_query) {
            aiExplanation = analyzer.aiExplain(traceResult, body.ai_query);
        }

        response.setStatus(200);
        response.setBody(JSON.stringify({
            trace: traceResult,
            timeline: timeline,
            stored_sys_id: storedSysId,
            ai_explanation: aiExplanation
        }));
    }

    /**
     * Handle overlap action: detectOverlaps + store.
     */
    function _handleOverlap(analyzer, response) {
        var overlaps = analyzer.detectOverlaps();
        var storedSysId = analyzer.storeOverlapResults(overlaps);

        response.setStatus(200);
        response.setBody(JSON.stringify({
            overlaps: overlaps,
            total: overlaps.length,
            stored_sys_id: storedSysId
        }));
    }

    /**
     * Handle health action: computeHealth + store.
     */
    function _handleHealth(analyzer, response) {
        var healthSnapshot = analyzer.computeHealth();
        var storedSysId = analyzer.storeHealthSnapshot(healthSnapshot);

        response.setStatus(200);
        response.setBody(JSON.stringify({
            health: healthSnapshot,
            stored_sys_id: storedSysId
        }));
    }

    /**
     * Handle remediate action: deactivate_rule, resend_email, clone_and_fix.
     */
    function _handleRemediate(body, tracer, response) {
        if (!body.remediation_action || !body.target) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Missing required parameters: remediation_action, target',
                valid_actions: ['deactivate_rule', 'resend_email', 'clone_and_fix']
            }));
            return;
        }

        var result = tracer.remediate(body.remediation_action, body.target);

        response.setStatus(result.success ? 200 : 400);
        response.setBody(JSON.stringify(result));
    }

})(request, response);