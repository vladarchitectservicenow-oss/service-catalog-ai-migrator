// DedupeGuard — POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action dispatch endpoint. Body:
//   { "action": "scan" }                          — scan all configured tables
//   { "action": "scan", "table": "sys_user" }     — scan one table
//   { "action": "merge", "table": "...", "survivor": "...", "loser": "..." }
//   { "action": "rollback", "merge_sys_id": "..." }
// Unknown actions return HTTP 400.
(function process(request, response) {

    // request.body is a RESTAPIRequestBody; the parsed JSON lives in
    // request.body.data. Tolerate a raw JSON string as well.
    var body = request.body ? request.body.data : null;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = null;
        }
    }
    if (!body) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: 'request body required' }));
        return;
    }

    var action = body.action;
    var engine = new DedupeGuardEngine();
    var merge = new DedupeGuardMerge();
    var actor = gs.getUserID();

    switch (action) {
        case 'scan':
            var scanResult = body.table ? engine.scan(body.table) : engine.scanAll();
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, action: 'scan', result: scanResult }));
            break;

        case 'merge':
            var mergeResult = merge.merge(body.table, body.survivor, body.loser, actor);
            response.setStatus(mergeResult.ok ? 200 : 400);
            response.setBody(JSON.stringify(mergeResult));
            break;

        case 'rollback':
            var rollbackResult = merge.rollback(body.merge_sys_id, actor);
            response.setStatus(rollbackResult.ok ? 200 : 404);
            response.setBody(JSON.stringify(rollbackResult));
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({ ok: false, error: 'unknown action: ' + action }));
            break;
    }

})(request, response);
