// ChangeCollision Radar — POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action dispatch endpoint. Body: { "action": "scan" | "score" | "ack",
// "collision_sys_id": "<sys_id>" }. Unknown actions return HTTP 400.
(function process(request, response) {

    var body = request.body ? request.body : null;
    if (!body) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: 'request body required' }));
        return;
    }

    var action = body.action;
    var engine = new CollisionRadarEngine();
    var remediate = new CollisionRadarRemediate();

    switch (action) {
        case 'scan':
            var scanResult = engine.scanCollisions();
            remediate.flagForReview();
            remediate.notifyCAB();
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, action: 'scan', result: scanResult }));
            break;

        case 'score':
            var scoreResult = engine.score();
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, action: 'score', result: scoreResult }));
            break;

        case 'ack':
            var ackResult = remediate.ackCollision(body.collision_sys_id);
            if (ackResult.ok) {
                response.setStatus(200);
            } else {
                response.setStatus(404);
            }
            response.setBody(JSON.stringify(ackResult));
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({ ok: false, error: 'unknown action: ' + action }));
            break;
    }

})(request, response);
