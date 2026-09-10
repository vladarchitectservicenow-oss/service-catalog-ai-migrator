// API Sentinel — GET /status REST endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Last scan summary, counts by risk band, and next scheduled scan.
// Requires x_snc_api_sentinel.viewer (or admin) role (enforced by ACL).

(function process(request, response) {
    var result = { ok: false, error: '' };

    try {
        var scan = new GlideRecord('x_snc_api_sentinel_scan');
        scan.orderByDesc('scan_started');
        scan.setLimit(1);
        scan.query();

        if (!scan.next()) {
            result = {
                ok: true,
                has_scan: false,
                message: 'No scan has been run yet. POST /execute with action "scan" to begin.'
            };
        } else {
            var counts = _countBandsForScan(scan.getUniqueValue());
            result = {
                ok: true,
                has_scan: true,
                last_scan: scan.scan_started.toString(),
                endpoints_found: parseInt(scan.endpoints_found.toString(), 10) || 0,
                critical_count: parseInt(scan.critical_count.toString(), 10) || 0,
                counts: counts,
                next_scheduled_scan: _nextScheduledScan()
            };
        }
    } catch (e) {
        response.setStatus(500);
        result = { ok: false, error: e.message || String(e) };
    }

    response.setBody(JSON.stringify(result));
})(request, response);

function _countBandsForScan(scanId) {
    var counts = { critical: 0, high: 0, medium: 0, low: 0 };
    var gr = new GlideRecord('x_snc_api_sentinel_endpoint');
    gr.addQuery('scan', scanId);
    gr.query();
    while (gr.next()) {
        var band = gr.risk_band.toString();
        if (band === 'Critical') {
            counts.critical++;
        } else if (band === 'High') {
            counts.high++;
        } else if (band === 'Medium') {
            counts.medium++;
        } else {
            counts.low++;
        }
    }
    return counts;
}

function _nextScheduledScan() {
    var sj = new GlideRecord('sys_trigger');
    sj.addQuery('name', 'API Sentinel Daily Scan');
    sj.addQuery('active', true);
    sj.setLimit(1);
    sj.query();
    if (sj.next()) {
        return sj.next_action.toString();
    }
    return '';
}
