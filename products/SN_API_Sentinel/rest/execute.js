// API Sentinel — POST /execute REST endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint. Body: { action: "scan" | "report" | "delta" }.
// Returns JSON. Requires x_snc_api_sentinel.admin role (enforced by ACL).

(function process(request, response) {
    var result = { ok: false, error: '' };

    try {
        var body = request.body ? request.body.data : null;
        var action = body && body.action ? body.action : '';

        var scanner = new ApiSentinelScanner();
        var engine = new ApiSentinelScoreEngine();

        if (action === 'scan') {
            var endpoints = scanner.scan();
            engine.scoreAll(endpoints);
            var scanId = _persistScan(endpoints);
            result = {
                ok: true,
                action: 'scan',
                scan_sys_id: scanId,
                endpoints_found: endpoints.length,
                counts: _countBands(endpoints)
            };
        } else if (action === 'report') {
            var format = body.format ? body.format : 'json';
            var stored = _loadLatestEndpoints();
            engine.scoreAll(stored);
            if (format === 'markdown' || format === 'md') {
                result = {
                    ok: true,
                    action: 'report',
                    format: 'markdown',
                    report: engine.buildMarkdownReport(stored, { generated_at: new GlideDateTime().getDisplayValue() })
                };
            } else if (format === 'csv') {
                result = {
                    ok: true,
                    action: 'report',
                    format: 'csv',
                    report: engine.buildCsvReport(stored)
                };
            } else {
                result = {
                    ok: true,
                    action: 'report',
                    format: 'json',
                    report: engine.buildJsonReport(stored, { generated_at: new GlideDateTime().getDisplayValue() })
                };
            }
        } else if (action === 'delta') {
            var prev = _loadPreviousEndpoints();
            var curr = scanner.scan();
            engine.scoreAll(curr);
            var delta = engine.computeDelta(prev, curr);
            var deltaScanId = _persistDelta(delta);
            result = {
                ok: true,
                action: 'delta',
                scan_sys_id: deltaScanId,
                added: delta.added.length,
                removed: delta.removed.length,
                changed: delta.changed.length,
                details: delta
            };
        } else {
            response.setStatus(400);
            result = { ok: false, error: 'Unknown action "' + action + '". Valid actions: scan, report, delta.' };
        }
    } catch (e) {
        response.setStatus(500);
        result = { ok: false, error: e.message || String(e) };
    }

    response.setBody(JSON.stringify(result));
})(request, response);

/**
 * Persist a scan run: write the scan header and endpoint records.
 * Returns the scan header sys_id.
 */
function _persistScan(endpoints) {
    var scan = new GlideRecord('x_snc_api_sentinel_scan');
    scan.initialize();
    scan.setValue('scan_started', new GlideDateTime());
    scan.setValue('scan_completed', new GlideDateTime());
    scan.setValue('endpoints_found', endpoints.length);
    var counts = _countBands(endpoints);
    scan.setValue('critical_count', counts.critical);
    scan.setValue('high_count', counts.high);
    scan.setValue('medium_count', counts.medium);
    scan.setValue('low_count', counts.low);
    var scanId = scan.insert();

    for (var i = 0; i < endpoints.length; i++) {
        var e = endpoints[i];
        var gr = new GlideRecord('x_snc_api_sentinel_endpoint');
        gr.initialize();
        gr.setValue('endpoint_type', e.endpoint_type);
        gr.setValue('name', e.name);
        gr.setValue('path', e.path);
        gr.setValue('auth_required', e.auth_required);
        gr.setValue('role_guard', e.role_guard);
        gr.setValue('tables_touched', JSON.stringify(e.tables_touched || []));
        gr.setValue('pii_fields', JSON.stringify(e.pii_fields || []));
        gr.setValue('risk_score', e.risk_score);
        gr.setValue('risk_band', e.risk_band);
        gr.setValue('source_table', e.source_table);
        gr.setValue('source_sys_id', e.source_sys_id);
        gr.setValue('scan', scanId);
        gr.insert();
    }
    return scanId;
}

/**
 * Persist a delta result to the scan table's delta_json field.
 * Returns the scan header sys_id.
 */
function _persistDelta(delta) {
    var scan = new GlideRecord('x_snc_api_sentinel_scan');
    scan.initialize();
    scan.setValue('scan_started', new GlideDateTime());
    scan.setValue('scan_completed', new GlideDateTime());
    scan.setValue('delta_json', JSON.stringify(delta));
    return scan.insert();
}

/**
 * Load the most recent scan's endpoints.
 */
function _loadLatestEndpoints() {
    var endpoints = [];
    var scan = new GlideRecord('x_snc_api_sentinel_scan');
    scan.orderByDesc('scan_started');
    scan.setLimit(1);
    scan.query();
    if (!scan.next()) {
        return endpoints;
    }
    var gr = new GlideRecord('x_snc_api_sentinel_endpoint');
    gr.addQuery('scan', scan.getUniqueValue());
    gr.query();
    while (gr.next()) {
        endpoints.push({
            endpoint_type: gr.endpoint_type.toString(),
            name: gr.name.toString(),
            path: gr.path.toString(),
            auth_required: gr.auth_required.toString(),
            role_guard: gr.role_guard.toString(),
            tables_touched: _safeParse(gr.tables_touched.toString()),
            pii_fields: _safeParse(gr.pii_fields.toString()),
            risk_score: parseInt(gr.risk_score.toString(), 10) || 0,
            risk_band: gr.risk_band.toString(),
            source_table: gr.source_table.toString(),
            source_sys_id: gr.source_sys_id.toString()
        });
    }
    return endpoints;
}

/**
 * Load the second-most-recent scan's endpoints (for delta comparison).
 */
function _loadPreviousEndpoints() {
    var endpoints = [];
    var scan = new GlideRecord('x_snc_api_sentinel_scan');
    scan.orderByDesc('scan_started');
    scan.setLimit(2);
    scan.query();
    var ids = [];
    while (scan.next()) {
        ids.push(scan.getUniqueValue());
    }
    if (ids.length < 2) {
        return endpoints;
    }
    var gr = new GlideRecord('x_snc_api_sentinel_endpoint');
    gr.addQuery('scan', ids[1]);
    gr.query();
    while (gr.next()) {
        endpoints.push({
            endpoint_type: gr.endpoint_type.toString(),
            name: gr.name.toString(),
            path: gr.path.toString(),
            auth_required: gr.auth_required.toString(),
            role_guard: gr.role_guard.toString(),
            tables_touched: _safeParse(gr.tables_touched.toString()),
            pii_fields: _safeParse(gr.pii_fields.toString()),
            risk_score: parseInt(gr.risk_score.toString(), 10) || 0,
            risk_band: gr.risk_band.toString(),
            source_table: gr.source_table.toString(),
            source_sys_id: gr.source_sys_id.toString()
        });
    }
    return endpoints;
}

function _countBands(endpoints) {
    var counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (var i = 0; i < endpoints.length; i++) {
        var band = endpoints[i].risk_band;
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

function _safeParse(s) {
    if (!s) {
        return [];
    }
    try {
        var parsed = JSON.parse(s);
        return parsed;
    } catch (e) {
        return [];
    }
}
