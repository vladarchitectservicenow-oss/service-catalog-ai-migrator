// ClientScript Medic — GET /status (read-only reporting REST endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single GET endpoint returning conflict map, health scores, or findings based
// on query parameters. Consolidates the design's `conflicts` and `health`
// endpoints into one read-only surface.
//
// Query params: view=conflicts|health|findings, table=<name>, type=<finding_type>

(function process(request, response) {
    var q = request.queryParams || {};
    var view = q.view || 'health';
    var engine = new ClientScriptMedicEngine();
    var result = { queried_at: new GlideDateTime().getValue() };

    switch (view) {
        case 'conflicts':
            result.conflicts = engine.getConflictMap(q.table || '');
            break;

        case 'health':
            result.health = engine.getHealthScores();
            break;

        case 'findings':
            result.findings = engine.getFindings(q.type || '', q.table || '');
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                ok: false,
                error: 'Unknown view: ' + view,
                valid_views: ['conflicts', 'health', 'findings']
            }));
            return;
    }

    result.ok = true;
    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
