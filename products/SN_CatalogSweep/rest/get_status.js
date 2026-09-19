// CatalogSweep — REST Status Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// GET read-only endpoint. Query parameters select the report shape.
(function process(request, response) {
    var q = request.queryParams || {};
    var scanner = new CatalogSweepScanner();
    var orch = new CatalogSweepOrchestrator();

    var result = { queried_at: new GlideDateTime().getValue() };

    // Full machine-readable export.
    if (q.export === 'full') {
        result = orch.exportFull();
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
        return;
    }

    // Dashboard aggregation.
    if (q.summary === 'true') {
        result.summary = orch.dashboardSummary();
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
        return;
    }

    // Dependency list for a single item.
    if (q.item_sys_id) {
        result.dependencies = scanner.getDependencies(q.item_sys_id);
        result.finding = scanner.getFinding(q.item_sys_id);
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
        return;
    }

    // Filtered findings list.
    var filters = {};
    if (q.category) { filters.category = q.category; }
    if (q.bucket) { filters.bucket = q.bucket; }
    if (q.state) { filters.state = q.state; }
    if (q.item_type) { filters.item_type = q.item_type; }
    result.findings = scanner.listFindings(filters);
    result.count = result.findings.length;

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
