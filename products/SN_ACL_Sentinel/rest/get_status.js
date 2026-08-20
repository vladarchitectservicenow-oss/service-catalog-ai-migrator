// ACL Sentinel — GET /status (read-only reporting)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single GET endpoint returning scan status, findings, and per-table
// least-privilege scores via query parameters. Consolidates the design's
// status/reporting endpoints into one read-only surface.
(function process(request, response) {

    var q = request.queryParams || {};
    var scanId = q.scan_id || '';
    var format = q.format || 'json';
    var engine = new AclSentinelEngine();
    var report = new AclSentinelReport();
    var result = { queried_at: new GlideDateTime().getValue() };

    if (scanId) {
        result.scan = report.buildReport(scanId, format);
    } else if (q.latest === 'true') {
        var latest = _getLatestScan();
        if (latest) {
            result.scan = report.buildReport(latest, format);
        } else {
            result.scan = null;
            result.message = 'No scans found';
        }
    } else {
        result.scans = _listScans();
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

    function _getLatestScan() {
        var gr = new GlideRecord('x_sn_acl_sentinel_scan');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return null;
    }

    function _listScans() {
        var scans = [];
        var gr = new GlideRecord('x_sn_acl_sentinel_scan');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(20);
        gr.query();
        while (gr.next()) {
            scans.push({
                sys_id: gr.getUniqueValue(),
                type: gr.getValue('type'),
                source_env: gr.getValue('source_env'),
                status: gr.getValue('status'),
                started_at: gr.getValue('started_at'),
                completed_at: gr.getValue('completed_at'),
                over_permissive_count: parseInt(gr.getValue('over_permissive_count') || '0', 10),
                orphan_count: parseInt(gr.getValue('orphan_count') || '0', 10),
                conflict_count: parseInt(gr.getValue('conflict_count') || '0', 10),
                access_denied_count: parseInt(gr.getValue('access_denied_count') || '0', 10)
            });
        }
        return scans;
    }

})(request, response);
