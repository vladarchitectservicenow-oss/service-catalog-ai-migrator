// ClientScript Medic — POST /execute (action-dispatch REST endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single POST endpoint dispatching on an `action` body parameter. Consolidates
// the design's `scan` and `findings` endpoints into one write/query surface.
//
// Actions: scan, findings, enrich

(function process(request, response) {
    var body = {};
    try {
        body = request.body ? request.body.data : {};
    } catch (e) {
        body = {};
    }

    var action = body.action || '';
    var engine = new ClientScriptMedicEngine();
    var result = {};

    switch (action) {
        case 'scan':
            // Write action — admin role only.
            if (!gs.hasRole('x_snc_csm.admin')) {
                response.setStatus(403);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Action "' + action + '" requires the x_snc_csm.admin role'
                }));
                return;
            }
            // Run a full audit; return the run sys_id.
            var runId = engine.scanAll();
            result = {
                ok: true,
                run_id: runId,
                scanned_at: new GlideDateTime().getValue()
            };
            break;

        case 'findings':
            // Return findings, optionally filtered by type and table.
            result = {
                ok: true,
                findings: engine.getFindings(body.finding_type || '', body.table_name || '')
            };
            break;

        case 'enrich':
            // Write action — admin role only.
            if (!gs.hasRole('x_snc_csm.admin')) {
                response.setStatus(403);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Action "' + action + '" requires the x_snc_csm.admin role'
                }));
                return;
            }
            // Generate AI advisory suggestions for a completed run.
            var ai = new ClientScriptMedicAI();
            ai.enrichRun(body.run_id || '');
            result = {
                ok: true,
                enriched_run_id: body.run_id || ''
            };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                ok: false,
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'findings', 'enrich']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
