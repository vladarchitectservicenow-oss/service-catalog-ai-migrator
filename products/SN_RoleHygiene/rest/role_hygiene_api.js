// RoleHygiene — REST API (Scripted REST)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single consolidated endpoint with action dispatch. Read-only by design for
// the audit surface; the only mutating action is `remediate`, which creates an
// approval-gated task (never a direct security-state change).
//
// POST /api/x_snc_role_hygiene/audit/execute
//   body: { action: "run"|"remediate", threshold_days?, clear_previous?, finding_sys_id?, remediation_action?, justification? }
//
// GET /api/x_snc_role_hygiene/audit/report?run=...
//   query: run (optional sys_id of a run), limit (optional int)
(function process(request, response) {

    var manager = new RoleHygieneManager();

    function ok(data) {
        response.setStatus(200);
        response.setBody(JSON.stringify({ result: data }));
    }

    function fail(status, message) {
        response.setStatus(status);
        response.setBody(JSON.stringify({ error: { message: message } }));
    }

    try {
        var method = request.method || '';
        var path = request.pathParams || {};

        // GET /report — compliance-ready report export
        if (method === 'GET') {
            var runId = request.queryParams.run || null;
            var limit = parseInt(request.queryParams.limit || '0', 10);
            var rows = manager.generateReport(runId);
            if (limit > 0 && rows.length > limit) {
                rows = rows.slice(0, limit);
            }
            ok(rows);
            return;
        }

        // POST /execute — action dispatch
        if (method === 'POST') {
            var body = request.body ? request.body.data : {};
            if (!body) {
                fail(400, 'Request body must be JSON');
                return;
            }

            var action = body.action;
            if (!action) {
                fail(400, 'Missing "action" field');
                return;
            }

            switch (action) {
                case 'run':
                    var summary = manager.runFullAudit({
                        threshold_days: body.threshold_days,
                        clear_previous: !!body.clear_previous
                    });
                    ok(summary);
                    break;

                case 'remediate':
                    var task = manager.createRemediationTask({
                        finding_sys_id: body.finding_sys_id,
                        action: body.remediation_action,
                        justification: body.justification
                    });
                    if (task.status === 'rejected' || task.status === 'error') {
                        fail(400, task.reason || 'remediation failed');
                    } else {
                        ok(task);
                    }
                    break;

                default:
                    fail(400, 'Unknown action: ' + action);
                    break;
            }
            return;
        }

        fail(405, 'Method not allowed');

    } catch (e) {
        gs.error('RoleHygiene REST: ' + e);
        fail(500, 'Internal error: ' + e.message);
    }

})(request, response);
