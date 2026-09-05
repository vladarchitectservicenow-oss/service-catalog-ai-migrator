// SpokePulse — IntegrationHub Spoke & Connection Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST endpoint: GET /api/x_snc_spk/status
// Read-only reporting endpoint. Query params select the report shape.
//   ?summary=true        -> full health summary (default)
//   ?run_id=<sys_id>     -> summary for a specific scan run
//   ?aggregate=true      -> aggregate risk score (0-100)
//   ?history=true        -> scan-run history
(function process(request, response) {
    var q = request.queryParams || {};
    var engine = new SpokePulseEngine();
    var result = { queried_at: new GlideDateTime().getValue() };

    if (q.history === 'true') {
        result.history = engine.getScanHistory();
    } else if (q.aggregate === 'true') {
        result.aggregate_risk = engine.getAggregateRisk(q.run_id);
    } else {
        result.summary = engine.getSummary(q.run_id);
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
