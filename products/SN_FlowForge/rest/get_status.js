// FlowForge — GET /status (draft | preview | catalog)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Read-only reporting endpoint. No write side effects. A `mode` query
// parameter (or body) selects the report:
//
//   mode=draft    → metadata for a single draft (draft_sys_id)
//   mode=preview  → re-render the dry-run preview for a draft
//   mode=catalog  → list the resolved action-catalog entries available
//
// Missing/unrecognized mode returns 400.
(function process(request, response) {

    var mode = '';
    var draftSysId = '';

    if (request && request.queryParams) {
        mode = (request.queryParams.mode || '').toString();
        draftSysId = (request.queryParams.draft_sys_id || '').toString();
    }
    if (!mode && request && request.body && request.body.data) {
        var data = request.body.data;
        mode = (data.mode || '').toString();
        draftSysId = (data.draft_sys_id || '').toString();
    }

    var writer = new FlowForgeWriter();
    var result;

    switch (mode) {
        case 'draft':
            if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id`' };
                response.setStatus(400);
            } else {
                var draft = writer._loadDraft(draftSysId);
                if (!draft) {
                    result = { ok: false, error: 'NOT_FOUND', message: 'Draft ' + draftSysId + ' not found' };
                    response.setStatus(404);
                } else {
                    result = {
                        ok: true,
                        draft_sys_id: draft.sys_id,
                        name: draft.name,
                        status: draft.status
                    };
                }
            }
            break;

        case 'preview':
            if (!draftSysId) {
                result = { ok: false, error: 'NO_DRAFT', message: 'Provide `draft_sys_id`' };
                response.setStatus(400);
            } else {
                var d = writer._loadDraft(draftSysId);
                if (!d) {
                    result = { ok: false, error: 'NOT_FOUND', message: 'Draft ' + draftSysId + ' not found' };
                    response.setStatus(404);
                } else {
                    var rehydrated = writer._rehydrate(d);
                    if (!rehydrated.ok) {
                        result = { ok: false, error: 'REHYDRATE_FAILED', message: rehydrated.message };
                    } else {
                        var generated = {
                            flow: rehydrated.flow,
                            version: rehydrated.version,
                            steps: rehydrated.steps,
                            logic: rehydrated.logic,
                            validation: rehydrated.validation || { errors: [], warnings: [] }
                        };
                        result = {
                            ok: true,
                            draft_sys_id: d.sys_id,
                            preview: writer.engine.renderPreview(generated),
                            step_count: generated.steps.length
                        };
                    }
                }
            }
            break;

        case 'catalog':
            var engine = new FlowForgeEngine();
            var actions = [];
            for (var key in engine.ACTION_CATALOG) {
                if (engine.ACTION_CATALOG.hasOwnProperty(key)) {
                    actions.push({ token: key, action: engine.ACTION_CATALOG[key].action, table: engine.ACTION_CATALOG[key].table });
                }
            }
            result = { ok: true, action_count: actions.length, actions: actions };
            break;

        default:
            result = {
                ok: false,
                error: 'UNKNOWN_MODE',
                message: 'Unknown mode: ' + mode,
                valid_modes: ['draft', 'preview', 'catalog']
            };
            response.setStatus(400);
            break;
    }

    response.setContentType('application/json');
    response.setBody(JSON.stringify(result));
})(request, response);
