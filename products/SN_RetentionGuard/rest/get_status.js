// RetentionGuard — GET /status (read-only reporting endpoint)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Read-only endpoint. Dispatches on query parameters:
//   ?inventory=true        → table growth inventory
//   ?report=<run_id>       → compliance audit report for a run
//   ?forecast=true         → growth/cost projection
//   ?drift=true            → policy drift warnings
//   ?holds=true            → active legal holds
// Returns HTTP 400 when no recognized parameter is supplied, and a structured
// HTTP 500 on any unexpected error (no raw stack traces leak to the caller).

(function process(request, response) {
    try {
        var q = request.queryParams || {};
        var engine = new RetentionGuardEngine();
        var report = new RetentionGuardReport();
        var result = { queried_at: new GlideDateTime().getValue() };

        if (q.inventory === 'true') {
            result.inventory = engine.inventoryTables();
        } else if (q.report) {
            result.report = report.buildAuditReport(q.report);
            if (result.report) {
                result.compliance_statement = report.buildComplianceStatement(result.report);
            }
        } else if (q.forecast === 'true') {
            result.forecast = report.forecastGrowth(engine.inventoryTables());
        } else if (q.drift === 'true') {
            result.drift = report.detectDrift(engine.inventoryTables());
        } else if (q.holds === 'true') {
            result.holds = report.listHolds();
        } else {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'No recognized query parameter supplied',
                valid_params: ['inventory', 'report', 'forecast', 'drift', 'holds']
            }));
            return;
        }

        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error processing request',
            message: e.message || 'unknown error'
        }));
    }
})(request, response);
