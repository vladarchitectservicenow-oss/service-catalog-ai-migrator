// MidPulse — Mid Server Health & Queue Monitor — GET /status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Read-only status endpoint. Returns the latest sweep summary, global health
// score, and alert summary. Optional query params:
//   ?limit=<n>  — number of recent snapshots to include (default 20)
(function process(request, response) {
    try {
        var q = request.queryParams || {};
        var limit = parseInt(q.limit, 10) || 20;
        var analyzer = new MidPulseAnalyzer();

        var snapshots = analyzer.report(limit);
        var globalHealth = 0;
        var lastSweep = "";
        if (snapshots.length > 0) {
            globalHealth = snapshots[0].health_score;
            lastSweep = snapshots[0].taken_at;
        }

        var result = {
            queried_at: new GlideDateTime().getValue(),
            last_sweep: lastSweep,
            global_health: globalHealth,
            snapshot_count: snapshots.length,
            alert_summary: {
                degraded: globalHealth < 60,
                threshold_breaches: 0
            },
            snapshots: snapshots
        };
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        gs.error("MidPulse GET /status failed: " + e);
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: "Internal error processing request",
            detail: e.message || String(e)
        }));
    }
})(request, response);
