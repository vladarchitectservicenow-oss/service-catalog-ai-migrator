// CMDB Health Validator for AI Readiness — GET /status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter dispatch REST endpoint for all read-only operations.
// Query params: ?scan_id=<id> | ?recent=true&limit=10 | ?summary=true | ?remediation=<scan_id> | ?health=current

(function process(request, response) {
    var q = request.queryParams || {};
    var scanner = new CmdbHealthScanner();
    var result = {};

    if (q.scan_id) {
        // Full scan detail
        var detail = scanner.getScanDetail(q.scan_id);
        if (detail) {
            result = detail;
        } else {
            response.setStatus(404);
            result = { error: 'Scan not found: ' + q.scan_id };
        }
    } else if (q.recent === 'true') {
        // Recent scan history
        var limit = parseInt(q.limit, 10) || 10;
        result = { recent_scans: scanner.getScanHistory(limit) };
    } else if (q.summary === 'true') {
        // Latest scan summary
        var current = scanner.getCurrentHealth();
        result = {
            current_health: current,
            threshold: {
                critical: { min: 0, max: 40 },
                at_risk: { min: 41, max: 70 },
                ai_ready: { min: 71, max: 100 }
            }
        };
    } else if (q.remediation) {
        // Remediation status for a scan
        var remediator = new CmdbHealthRemediator();
        result = remediator.getRemediationStatus(q.remediation);
    } else if (q.health === 'current') {
        // Current health snapshot
        result = scanner.getCurrentHealth();
    } else {
        // Default: return usage info without querying the database
        result = {
            usage: {
                endpoints: [
                    '?scan_id=<id> — Full scan detail with findings',
                    '?recent=true&limit=10 — Recent scan history',
                    '?summary=true — Latest scan summary with thresholds',
                    '?remediation=<scan_id> — Remediation task status',
                    '?health=current — Current health snapshot'
                ]
            }
        };
    }

    response.setBody(JSON.stringify(result));
})(request, response);
