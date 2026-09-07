// ApprovalRelay — Stalled & Orphaned Approval Detector with Auto-Remediation
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST endpoint: GET /api/x_sn_approval_relay/stalls
// Returns open stall records, optionally filtered by workflow (sys_id) or
// bucket. When a stall sys_id is supplied, returns that single record.
(function process(request, response) {

    var engine = new ApprovalRelayEngine();
    var stallParam = request.queryParams.sys_id || request.queryParams.stall || '';
    var workflowParam = request.queryParams.workflow || '';
    var bucketParam = request.queryParams.bucket || '';

    try {
        if (stallParam) {
            var stall = engine.getStall(stallParam);
            if (!stall) {
                response.setStatus(404);
                response.setBody(JSON.stringify({ ok: false, error: 'Stall not found: ' + stallParam }));
                return;
            }
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, data: stall }));
            return;
        }

        var stalls = engine.getStalls(workflowParam);
        if (bucketParam) {
            var filtered = [];
            for (var i = 0; i < stalls.length; i++) {
                if (stalls[i].bucket === bucketParam) {
                    filtered.push(stalls[i]);
                }
            }
            stalls = filtered;
        }

        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, count: stalls.length, data: stalls }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: e.message }));
    }

})(request, response);
