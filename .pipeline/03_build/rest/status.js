// REST Medic — Scripted REST API Health Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET /api/x_vlad_rest_medic/status — Lightweight health check

(function process(request, response) {
    try {
        var engine = new RESTMedicEngine();
        var report = engine.getHealthReport();

        response.setStatus(200);
        response.setBody(JSON.stringify({
            success: true,
            last_scan: report.last_scan,
            endpoint_count: report.endpoint_count,
            healthy: report.healthy,
            warning: report.warning,
            critical: report.critical,
            avg_score: report.avg_score
        }));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            success: false,
            error: 'Internal error: ' + e.toString()
        }));
    }
})(request, response);
