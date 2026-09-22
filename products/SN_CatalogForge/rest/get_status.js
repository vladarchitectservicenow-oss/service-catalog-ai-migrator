// CatalogForge — GET /status (preview | list)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Read-only REST endpoint. Query-parameter dispatch:
//   ?draft_sys_id=<id>   → return the stored preview graph for that draft
//   ?limit=<n>           → return the most recent drafts (bounded ≤100)
//   (no params)          → return the engine version and endpoint summary
//
// ES5-compatible. No side effects.
(function process(request, response) {

    var writer = new CatalogForgeWriter();
    var queryParams = (request && request.queryParams) ? request.queryParams : {};

    var draftSysId = (queryParams.draft_sys_id || '').toString();
    var limit = queryParams.limit;

    var result;

    if (draftSysId) {
        result = writer.preview(draftSysId, null);
    } else if (limit) {
        result = writer.listDrafts(limit);
    } else {
        result = {
            ok: true,
            engine_version: new CatalogForgeEngine().ENGINE_VERSION,
            endpoints: {
                'POST /execute': ['propose', 'approve', 'export'],
                'GET /status': ['preview (draft_sys_id)', 'list (limit)']
            }
        };
    }

    if (!result.ok) {
        if (result.error === 'NOT_FOUND') { response.setStatus(404); }
    }

    response.setContentType('application/json');
    response.setBody(JSON.stringify(result));
})(request, response);
