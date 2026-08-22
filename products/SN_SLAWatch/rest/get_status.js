// SLAWatch — GET /status: read-only reporting endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single GET endpoint returning scan status, findings, and health data
// differentiated by query parameters.
(function process(request, response) {
    var q = (request && request.queryParams) ? request.queryParams : {};
    var result = { queried_at: new GlideDateTime().getValue() };

    var scanSysId = q.scan_sys_id || '';
    var category = q.category || '';
    var severity = q.severity || '';
    var limit = parseInt(q.limit || '50', 10);
    if (isNaN(limit) || limit <= 0) {
        limit = 50;
    }

    if (scanSysId) {
        // Full detail for one scan record.
        var scanGr = new GlideRecord('x_sn_slawatch_scan');
        if (scanGr.get(scanSysId)) {
            result.scan = {
                scan_type: scanGr.getValue('scan_type'),
                status: scanGr.getValue('status'),
                started_at: scanGr.getValue('started_at'),
                completed_at: scanGr.getValue('completed_at'),
                sla_count: scanGr.getValue('sla_count'),
                finding_count: scanGr.getValue('finding_count'),
                high_risk_count: scanGr.getValue('high_risk_count')
            };
        } else {
            result.scan = null;
        }
    }

    // Findings query (optionally filtered by scan, category, severity).
    var fgr = new GlideRecord('x_sn_slawatch_finding');
    if (scanSysId) {
        fgr.addQuery('scan', scanSysId);
    }
    if (category) {
        fgr.addQuery('category', category);
    }
    if (severity) {
        fgr.addQuery('severity', severity);
    }
    fgr.orderByDesc('sys_created_on');
    fgr.setLimit(limit);
    fgr.query();
    var findings = [];
    while (fgr.next()) {
        findings.push({
            sys_id: fgr.getUniqueValue(),
            sla_name: fgr.getValue('sla_name'),
            sla_table: fgr.getValue('sla_table'),
            category: fgr.getValue('category'),
            severity: fgr.getValue('severity'),
            message: fgr.getValue('message'),
            status: fgr.getValue('status')
        });
    }
    result.findings = findings;
    result.findings_count = findings.length;

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
