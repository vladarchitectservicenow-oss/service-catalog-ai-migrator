// PerfPulse — GET /status (read-only reporting)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single GET endpoint returning scan status, findings, and per-component
// performance scores via query parameters. Consolidates the design's
// status/reporting endpoints into one read-only surface.
(function process(request, response) {

    var q = request.queryParams || {};
    var scanId = q.scan_id || '';
    var format = q.format || 'json';
    var report = new PerfPulseReport();
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
        var gr = new GlideRecord('x_vkap_perf_pulse_scan');
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
        var gr = new GlideRecord('x_vkap_perf_pulse_scan');
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
                business_rule_count: parseInt(gr.getValue('business_rule_count') || '0', 10),
                slow_query_count: parseInt(gr.getValue('slow_query_count') || '0', 10),
                n_plus_one_count: parseInt(gr.getValue('n_plus_one_count') || '0', 10),
                client_script_count: parseInt(gr.getValue('client_script_count') || '0', 10),
                acl_cost_count: parseInt(gr.getValue('acl_cost_count') || '0', 10),
                transaction_count: parseInt(gr.getValue('transaction_count') || '0', 10)
            });
        }
        return scans;
    }

})(request, response);
