// ScriptInclude Medic — REST: run scan
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scripted REST API endpoint that triggers a full or incremental scan.
// POST /api/x_snc_script_include_medic/scan
// Body: { "incremental": false, "entry_points": ["MyEntryPoint"] }
// Returns: scan summary JSON.
//
// @class SimScanApi
// @namespace x_snc_script_include_medic

(function process(request, response) {

    try {
        var body = request.body ? request.body.data : null;
        var incremental = false;
        var entryPoints = null;

        if (body) {
            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                } catch (e) {
                    body = null;
                }
            }
            if (body && typeof body === 'object') {
                incremental = body.incremental === true;
                if (Array.isArray(body.entry_points)) {
                    entryPoints = body.entry_points;
                }
            }
        }

        var runner = new SimMedicRunner();
        var summary = runner.runScan(incremental, entryPoints);

        response.setStatus(200);
        response.setBody(JSON.stringify({
            success: true,
            scan_sys_id: summary.scan_sys_id,
            instance_health: summary.instance_health,
            include_count: summary.include_count,
            counts: {
                dead_code: summary.dead_count,
                duplicate: summary.duplicate_count,
                naming: summary.naming_count,
                documentation: summary.doc_count,
                cycle: summary.cycle_count,
                reinvention: summary.reinvention_count
            }
        }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            success: false,
            error: e.message || 'Unknown error'
        }));
    }

})(request, response);
