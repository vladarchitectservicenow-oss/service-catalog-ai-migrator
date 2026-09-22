// CatalogForge — POST /execute (propose | approve | export)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch REST endpoint. All write surfaces collapse into a single
// POST with an `action` body parameter, plus GET /status for all reads.
//
//   action=propose  → run the engine, persist a review draft, return preview
//   action=approve  → commit the draft's item graph to the OOTB catalog tables
//   action=export   → emit the portable JSON bundle for the draft
//
// ES5-compatible. Uses the request.body.data JSON body contract.
(function process(request, response) {

    var writer = new CatalogForgeWriter();

    var action = '';
    var rawIntake = '';
    var draftSysId = '';

    // Parse the JSON body.
    if (request && request.body && request.body.data) {
        var data = request.body.data;
        action = (data.action || '').toString();
        rawIntake = data.intake || '';
        draftSysId = (data.draft_sys_id || '').toString();
    }

    // Fallback to query params when no body was provided.
    if (!action && request && request.queryParams) {
        action = (request.queryParams.action || '').toString();
        draftSysId = (request.queryParams.draft_sys_id || '').toString();
    }

    var result;

    switch (action) {
        case 'propose':
            if (!rawIntake) {
                result = { ok: false, error: 'NO_INTAKE', message: 'Provide `intake` (JSON string or plain-language description)' };
            } else {
                result = writer.propose(rawIntake, gs.getUserID());
            }
            break;

        case 'approve':
            if (!gs.hasRole('x_sncf.admin')) {
                result = { ok: false, error: 'FORBIDDEN', message: 'Only x_sncf.admin can approve/commit a draft' };
                response.setStatus(403);
            } else if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id` to approve' };
            } else {
                result = writer.commit(draftSysId);
            }
            break;

        case 'export':
            if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id` to export' };
            } else {
                result = writer.exportBundle(draftSysId);
            }
            break;

        default:
            result = { ok: false, error: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action, valid_actions: ['propose', 'approve', 'export'] };
            response.setStatus(400);
            break;
    }

    response.setContentType('application/json');
    response.setBody(JSON.stringify(result));
})(request, response);
