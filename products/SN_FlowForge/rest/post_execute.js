// FlowForge — POST /execute (propose | commit | export)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch REST endpoint. All write surfaces collapse into a single
// POST with an `action` body parameter (or query param). GET /status covers
// all reads.
//
//   action=propose  → run the engine, persist a draft, return the preview
//   action=commit   → write the draft graph to the OOTB flow tables
//   action=export   → emit the portable update-set XML bundle
//
// Authorization:
//   propose/export  → any authenticated user with the x_snff.mapper role
//   commit          → requires the x_snff.admin role
//
// ES5-compatible. Uses the request.body.data JSON body contract.
(function process(request, response) {

    var writer = new FlowForgeWriter();

    var action = '';
    var rawSpec = '';
    var draftSysId = '';

    // Parse the JSON body.
    if (request && request.body && request.body.data) {
        var data = request.body.data;
        action = (data.action || '').toString();
        rawSpec = data.spec || '';
        draftSysId = (data.draft_sys_id || '').toString();
    }

    // Fallback to query params when no body was provided.
    if (!action && request && request.queryParams) {
        action = (request.queryParams.action || '').toString();
        rawSpec = request.queryParams.spec || '';
        draftSysId = (request.queryParams.draft_sys_id || '').toString();
    }

    var result;

    switch (action) {
        case 'propose':
            if (!gs.hasRole('x_snff.mapper') && !gs.hasRole('x_snff.admin')) {
                result = { ok: false, error: 'FORBIDDEN', message: 'propose requires the x_snff.mapper role' };
                response.setStatus(403);
            } else if (!rawSpec) {
                result = { ok: false, error: 'NO_SPEC', message: 'Provide `spec` (FlowSpec JSON string or object)' };
                response.setStatus(400);
            } else {
                result = writer.propose(rawSpec, gs.getUserID());
            }
            break;

        case 'commit':
            if (!gs.hasRole('x_snff.admin')) {
                result = { ok: false, error: 'FORBIDDEN', message: 'Only x_snff.admin can commit a draft to the flow tables' };
                response.setStatus(403);
            } else if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id` to commit' };
                response.setStatus(400);
            } else {
                result = writer.commit(draftSysId);
            }
            break;

        case 'export':
            if (!gs.hasRole('x_snff.mapper') && !gs.hasRole('x_snff.admin')) {
                result = { ok: false, error: 'FORBIDDEN', message: 'export requires the x_snff.mapper role' };
                response.setStatus(403);
            } else if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id` to export' };
                response.setStatus(400);
            } else {
                result = writer.exportUpdateSetXml(draftSysId);
            }
            break;

        default:
            result = {
                ok: false,
                error: 'UNKNOWN_ACTION',
                message: 'Unknown action: ' + action,
                valid_actions: ['propose', 'commit', 'export']
            };
            response.setStatus(400);
            break;
    }

    response.setContentType('application/json');
    response.setBody(JSON.stringify(result));
})(request, response);
