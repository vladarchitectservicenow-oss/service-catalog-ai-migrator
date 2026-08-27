// PortalWidget Medic — REST: Query (GET query-parameter dispatch)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single GET endpoint dispatching on the `resource` query parameter:
//   ?resource=findings&severity=critical&limit=50   -> findings list
//   ?resource=health&limit=50                        -> health dashboard
//   ?resource=dependency                             -> dependency graph
//   ?resource=scan                                   -> latest scan status
// Unknown or missing resource returns HTTP 400.

(function process(request, response) {
    var api = new PwmApi();
    var qp = request.queryParams || {};
    var resource = qp.resource || '';

    try {
        if (resource === 'findings') {
            var findings = api.getFindings({
                severity: qp.severity,
                finding_type: qp.finding_type,
                widget_id: qp.widget_id,
                limit: qp.limit
            });
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, count: findings.length, data: findings }));
            return;
        }

        if (resource === 'health') {
            var health = api.getHealth(qp.limit);
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, count: health.length, data: health }));
            return;
        }

        if (resource === 'dependency') {
            var graph = api.buildDependencyGraph();
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, data: graph }));
            return;
        }

        if (resource === 'scan') {
            var scanStatus = api.getScanStatus();
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, data: scanStatus }));
            return;
        }

        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Unknown or missing resource. Supported: findings, health, dependency, scan' } }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Internal error: ' + e } }));
    }
})(request, response);
