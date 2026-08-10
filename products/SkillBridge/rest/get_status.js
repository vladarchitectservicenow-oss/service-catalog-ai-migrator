// SkillBridge — ServiceNow Developer Portfolio Exporter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET /api/x_snc_skb/status — Query-parameter dispatch for all read-only operations.

(function process(request, response) {
    var queryParams = request.queryParams || {};
    var exporter = new SkillBridgeExporter();
    var result = {};

    var snapshotId = queryParams.snapshot_id || '';
    var recent = queryParams.recent === 'true';
    var limit = parseInt(queryParams.limit, 10) || 10;
    var skillSummary = queryParams.skill_summary === 'true';

    if (snapshotId && skillSummary) {
        // Skill breakdown for a specific snapshot
        result = exporter.getSkillSummary(snapshotId);
        if (result.error) {
            response.setStatus(404);
            response.setBody(JSON.stringify({ ok: false, error: result.error }));
            return;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: result }));
        return;
    }

    if (snapshotId) {
        // Full snapshot detail
        var snapshot = exporter.getSnapshot(snapshotId);
        if (!snapshot) {
            response.setStatus(404);
            response.setBody(JSON.stringify({ ok: false, error: 'Snapshot not found: ' + snapshotId }));
            return;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: snapshot }));
        return;
    }

    if (recent) {
        // List recent snapshots
        var snapshots = exporter.getRecentSnapshots(limit);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: { snapshots: snapshots, count: snapshots.length } }));
        return;
    }

    // Default: return available query options
    response.setStatus(200);
    response.setBody(JSON.stringify({
        ok: true,
        data: {
            message: 'SkillBridge Status API',
            available_queries: [
                '?snapshot_id=<id> — Get full snapshot detail',
                '?snapshot_id=<id>&skill_summary=true — Get skill breakdown',
                '?recent=true&limit=10 — List recent snapshots'
            ]
        }
    }));
})(request, response);
