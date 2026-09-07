// ApprovalRelay — Stalled & Orphaned Approval Detector with Auto-Remediation
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST endpoint: POST /api/x_sn_approval_relay/execute
// Action dispatch: scan | remediate | ack
//   scan       — scan for stalled approvals now, classify, alert (returns stalls)
//   remediate  — apply remediation to a stall (body: { stall_sys_id })
//   ack        — acknowledge an alert (body: { alert_sys_id, acked_by })
(function process(request, response) {

    var body = {};
    try {
        if (request.body && request.body.data) {
            body = request.body.data;
        }
    } catch (e) {
        body = {};
    }

    var action = body.action || request.queryParams.action || '';
    var engine = new ApprovalRelayEngine();
    var remediator = new ApprovalRelayRemediate();

    try {
        switch (action) {
            case 'scan':
                var stalls = engine.scanStalled();
                var alerted = 0;
                for (var i = 0; i < stalls.length; i++) {
                    if (remediator.raiseAlert(stalls[i])) {
                        alerted++;
                    }
                }
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, action: 'scan', count: stalls.length, alerted: alerted, data: stalls }));
                break;

            case 'remediate':
                if (!body.stall_sys_id) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing stall_sys_id' }));
                    return;
                }
                var stall = engine.getStall(body.stall_sys_id);
                if (!stall) {
                    response.setStatus(404);
                    response.setBody(JSON.stringify({ ok: false, error: 'Stall not found' }));
                    return;
                }
                var result = remediator.remediate(stall);
                response.setStatus(200);
                response.setBody(JSON.stringify({ ok: true, action: 'remediate', data: result }));
                break;

            case 'ack':
                if (!body.alert_sys_id) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'Missing alert_sys_id' }));
                    return;
                }
                var ackResult = remediator.acknowledge(body.alert_sys_id, body.acked_by || '');
                response.setStatus(ackResult.ok ? 200 : 404);
                response.setBody(JSON.stringify(ackResult));
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({ ok: false, error: 'Unknown action: ' + action }));
                break;
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: e.message }));
    }

})(request, response);
