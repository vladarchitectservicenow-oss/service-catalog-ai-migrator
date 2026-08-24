// ScriptInclude Medic — REST: read results
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scripted REST API endpoint that returns scan results.
// GET /api/x_snc_script_include_medic/results
// Query params:
//   scan_id=<sys_id>        optional — restrict to one scan
//   type=dead_code|duplicate|naming|documentation|cycle|reinvention|health
//   limit=<int>             optional — max findings (default 100)
// Returns: findings array JSON.
//
// @class SimResultsApi
// @namespace x_snc_script_include_medic

(function process(request, response) {

    try {
        var qp = request.queryParams || {};
        var scanId = qp.scan_id || '';
        var type = qp.type || '';
        var limit = parseInt(qp.limit, 10);
        if (isNaN(limit) || limit <= 0) {
            limit = 100;
        }
        if (limit > 500) {
            limit = 500;
        }

        var gr = new GlideRecord('x_snc_script_include_medic_finding');
        if (scanId) {
            gr.addQuery('scan', scanId);
        }
        if (type) {
            gr.addQuery('type', type);
        }
        gr.orderByDesc('sys_created_on');
        gr.setLimit(limit);
        gr.query();

        var findings = [];
        while (gr.next()) {
            findings.push({
                sys_id: gr.getUniqueValue(),
                type: gr.getValue('type'),
                severity: gr.getValue('severity'),
                include_sys_id: gr.getValue('include_sys_id'),
                include_name: gr.getValue('include_name'),
                target_name: gr.getValue('target_name'),
                metric: gr.getValue('metric'),
                score: gr.getValue('score') ? parseInt(gr.getValue('score'), 10) : null,
                detail: gr.getValue('detail')
            });
        }

        response.setStatus(200);
        response.setBody(JSON.stringify({
            success: true,
            count: findings.length,
            findings: findings
        }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            success: false,
            error: e.message || 'Unknown error'
        }));
    }

})(request, response);
