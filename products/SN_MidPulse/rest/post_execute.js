// MidPulse — Mid Server Health & Queue Monitor — POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint. Accepts a JSON body with an `action` field:
//   sweep  — run a full health sweep and persist snapshots
//   report — return the most recent snapshot set
//   export — return the most recent snapshot set (JSON export)
(function process(request, response) {
    try {
        var body = (request.body && request.body.data) ? request.body.data : {};
        var action = body.action || "sweep";
        var collector = new MidPulseCollector();
        var analyzer = new MidPulseAnalyzer();

        var result;
        switch (action) {
            case "sweep":
                var sweep = collector.sweepAll();
                result = analyzer.analyze(sweep);
                break;
            case "report":
                result = { snapshots: analyzer.report(body.limit || 20) };
                break;
            case "export":
                result = { exported_at: new GlideDateTime().getValue(), snapshots: analyzer.report(body.limit || 100) };
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: "Unknown action: " + action,
                    valid_actions: ["sweep", "report", "export"]
                }));
                return;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        gs.error("MidPulse POST /execute failed: " + e);
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: "Internal error processing request",
            detail: e.message || String(e)
        }));
    }
})(request, response);
