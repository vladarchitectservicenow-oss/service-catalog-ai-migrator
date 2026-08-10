// SkillBridge — ServiceNow Developer Portfolio Exporter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST /api/x_snc_skb/execute — Action-dispatch endpoint for scan, export, and compare operations.

(function process(request, response) {
    var body = request.body || {};
    var action = body.action || '';
    var result = {};

    var scanner = new SkillBridgeScanner();
    var exporter = new SkillBridgeExporter();

    switch (action) {
        case 'scan':
            result = _handleScan(body, scanner);
            break;
        case 'export':
            result = _handleExport(body, exporter);
            break;
        case 'compare':
            result = _handleCompare(body, exporter);
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                ok: false,
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'export', 'compare']
            }));
            return;
    }

    response.setStatus(result.status || 200);
    response.setBody(JSON.stringify(result));
})(request, response);

function _handleScan(body, scanner) {
    try {
        var configObj = {
            config_name: body.config_name || '',
            artifact_types: body.artifact_types || '',
            date_from: body.date_from || '',
            date_to: body.date_to || '',
            exclude_patterns: body.exclude_patterns || ''
        };

        var snapshotId = scanner.scanAll(configObj);
        if (!snapshotId) {
            return { ok: false, status: 500, error: 'Scan failed — no snapshot created' };
        }

        return {
            ok: true,
            data: {
                snapshot_id: snapshotId,
                message: 'Scan completed successfully'
            }
        };
    } catch (e) {
        return { ok: false, status: 500, error: 'Scan error: ' + e.message };
    }
}

function _handleExport(body, exporter) {
    try {
        var snapshotId = body.snapshot_id || '';
        var format = body.format || 'markdown';

        if (!snapshotId) {
            return { ok: false, status: 400, error: 'snapshot_id is required' };
        }

        var validFormats = ['markdown', 'json', 'linkedin'];
        if (validFormats.indexOf(format) === -1) {
            return { ok: false, status: 400, error: 'Invalid format: ' + format, valid_formats: validFormats };
        }

        var attachmentId = exporter.generatePortfolio(snapshotId, format);
        if (!attachmentId) {
            return { ok: false, status: 500, error: 'Export failed — no attachment created' };
        }

        return {
            ok: true,
            data: {
                snapshot_id: snapshotId,
                format: format,
                attachment_id: attachmentId,
                message: 'Portfolio exported successfully'
            }
        };
    } catch (e) {
        return { ok: false, status: 500, error: 'Export error: ' + e.message };
    }
}

function _handleCompare(body, exporter) {
    try {
        var snapshotId1 = body.snapshot_id || '';
        var snapshotId2 = body.snapshot_id_2 || '';

        if (!snapshotId1 || !snapshotId2) {
            return { ok: false, status: 400, error: 'Both snapshot_id and snapshot_id_2 are required' };
        }

        var comparison = exporter.compareSnapshots(snapshotId1, snapshotId2);
        if (comparison.error) {
            return { ok: false, status: 404, error: comparison.error };
        }

        return {
            ok: true,
            data: comparison
        };
    } catch (e) {
        return { ok: false, status: 500, error: 'Compare error: ' + e.message };
    }
}
