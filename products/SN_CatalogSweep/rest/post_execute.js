// CatalogSweep — REST Execute Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST action-dispatch endpoint. All write/query operations route through
// a single `action` body parameter.
(function process(request, response) {
    var body = request.body ? (request.body.data || {}) : {};
    var action = body.action || '';

    var result;
    switch (action) {
        case 'scan':
            result = _handleScan(body);
            break;
        case 'stage':
            result = _handleStage(body);
            break;
        case 'approve':
            result = _handleApprove(body);
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'stage', 'approve']
            }));
            return;
    }

    if (result && result.ok === false) {
        response.setStatus(400);
        response.setBody(JSON.stringify(result));
        return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

    function _handleScan(b) {
        var mode = b.mode || 'full';
        var scanner = new CatalogSweepScanner();
        var scanSysId = scanner.run(mode);
        if (!scanSysId) {
            return { ok: false, error: 'SCAN_FAILED', message: 'Scan did not produce a scan_run record' };
        }
        return { ok: true, scan_run: scanSysId, mode: mode };
    }

    function _handleStage(b) {
        var itemSysId = b.item_sys_id;
        if (!itemSysId) {
            return { ok: false, error: 'MISSING_ITEM', message: 'item_sys_id is required' };
        }
        var orch = new CatalogSweepOrchestrator();
        return orch.stage(itemSysId, b.requested_by);
    }

    function _handleApprove(b) {
        var findingSysId = b.finding_sys_id;
        if (!findingSysId) {
            return { ok: false, error: 'MISSING_FINDING', message: 'finding_sys_id is required' };
        }
        var orch = new CatalogSweepOrchestrator();
        return orch.approve(findingSysId, b.approved_by);
    }
})(request, response);
