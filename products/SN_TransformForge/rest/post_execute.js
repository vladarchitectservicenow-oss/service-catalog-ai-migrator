// TransformForge — REST Execute Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST action-dispatch endpoint. All generation/export operations route
// through a single `action` body parameter.
(function process(request, response) {
    var body = request.body ? (request.body.data || {}) : {};
    var action = body.action || '';

    var result;
    switch (action) {
        case 'generate':
            result = _handleGenerate(body);
            break;
        case 'export':
            result = _handleExport(body);
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['generate', 'export']
            }));
            return;
    }

    if (result && result.ok === false) {
        response.setStatus(400);
        response.setBody(JSON.stringify(result));
        return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

    function _handleGenerate(b) {
        var csvText = b.csv_text || '';
        var targetTable = b.target_table || '';
        if (!csvText) {
            return { ok: false, error: 'MISSING_CSV', message: 'csv_text is required' };
        }
        if (!targetTable) {
            return { ok: false, error: 'MISSING_TARGET', message: 'target_table is required' };
        }
        var gen = new TransformForgeGenerator();
        return gen.generate(csvText, targetTable, {
            dryRun: (b.dry_run === true),
            requested_by: b.requested_by || ''
        });
    }

    function _handleExport(b) {
        var jobSysId = b.job_sys_id || '';
        if (!jobSysId) {
            return { ok: false, error: 'MISSING_JOB', message: 'job_sys_id is required' };
        }
        var gen = new TransformForgeGenerator();
        return gen.exportMapPayload(jobSysId);
    }
})(request, response);
