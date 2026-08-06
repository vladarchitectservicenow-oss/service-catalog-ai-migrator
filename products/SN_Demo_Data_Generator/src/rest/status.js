// SN Demo Data Generator — REST Status Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET /api/x_sn_demo_data_gen/status
// Read-only endpoint for run history, profile listing, and export.

(function process(request, response) {
    var q = request.queryParams || {};
    var engine = new DemoDataEngine();
    var result = {};

    // Run history
    if (q.runs === 'true') {
        var status = q.status || '';
        var limit = parseInt(q.limit || '20', 10);
        result.runs = engine.getRunHistory(status, limit);
    }

    // Profile listing
    if (q.profiles === 'true') {
        var userId = q.user_id || '';
        result.profiles = engine.listProfiles(userId);
    }

    // Profile export
    if (q.export_profile) {
        var jsonStr = engine.exportJSON(q.export_profile);
        if (jsonStr) {
            result.export = jsonStr;
        } else {
            result.export_error = 'Profile not found: ' + q.export_profile;
        }
    }

    // Dashboard scan
    if (q.scan_dashboard) {
        var scanner = new PADataScanner();
        result.scan = scanner.resolveDependencies(q.scan_dashboard);
    }

    // If no specific query, return available endpoints
    if (Object.keys(result).length === 0) {
        result.available_queries = {
            runs: '?runs=true[&status=complete][&limit=20]',
            profiles: '?profiles=true[&user_id=<sys_id>]',
            export_profile: '?export_profile=<profile_sys_id>',
            scan_dashboard: '?scan_dashboard=<dashboard_sys_id>'
        };
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
