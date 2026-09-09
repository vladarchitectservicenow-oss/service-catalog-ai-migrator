// RESTPulse — Outbound REST Message & Integration Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET /status — read-only reporting endpoint. Query params:
//   ?view=summary        -> all health records (default)
//   ?message_sys_id=<id> -> single message detail + history
//   ?view=dependency     -> dependency map (nodes + edges)
//   ?view=config         -> current configuration
(function process(request, response) {
    var q = request.queryParams || {};
    var view = q.view || 'summary';
    var engine = new RESTPulseEngine();
    var result = { queried_at: new GlideDateTime().getValue(), view: view };

    if (view === 'summary') {
        result.integrations = engine.getHealthSummary();
    } else if (view === 'dependency') {
        result.map = engine.buildDependencyMap();
    } else if (view === 'config') {
        result.config = engine.getConfig();
    } else if (view === 'detail') {
        var msgSysId = q.message_sys_id || '';
        if (!msgSysId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'message_sys_id required for view=detail' }));
            return;
        }
        result.integration = engine.getHealthDetail(msgSysId);
        if (!result.integration) {
            response.setStatus(404);
            response.setBody(JSON.stringify({ error: 'No health record found for message_sys_id: ' + msgSysId }));
            return;
        }
        result.history = engine.getHistory(msgSysId, 50);
    } else {
        response.setStatus(400);
        response.setBody(JSON.stringify({
            error: 'Unknown view: ' + view,
            valid_views: ['summary', 'dependency', 'config', 'detail']
        }));
        return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
