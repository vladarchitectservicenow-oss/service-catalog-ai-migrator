// ConfigSync — Instance Configuration Drift Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scripted REST API for CI/CD pipeline integration and drift status queries.
// POST /api/x_csync/drift/check — gate check for CI/CD pipelines
// GET /api/x_csync/drift/status — current drift status

(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var engine = new x_csync.ConfigSyncEngine();
    var ai = new x_csync.ConfigSyncAI();

    // Determine action from HTTP method + query params
    var method = request.method || 'GET';
    var queryParams = request.queryParams || {};
    var bodyData = {};

    if (method === 'POST') {
        try {
            bodyData = request.body ? request.body.data : {};
            if (!bodyData || typeof bodyData !== 'object') {
                bodyData = {};
            }
        } catch (e) {
            bodyData = {};
        }
    }

    // ── POST /check — CI/CD gate check ──
    if (method === 'POST' && (queryParams.action === 'check' || bodyData.baseline_id)) {
        var baselineId = bodyData.baseline_id || queryParams.baseline_id || '';
        var targetId = bodyData.target_id || queryParams.target_id || '';

        if (!baselineId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Missing required parameter: baseline_id',
                deployable: false
            }));
            return;
        }

        // If no target_id provided, use the latest snapshot as target
        if (!targetId) {
            targetId = _getLatestSnapshotId();
        }

        var gateReport = engine.checkGate(baselineId, targetId);
        response.setStatus(200);
        response.setBody(JSON.stringify(gateReport));
        return;
    }

    // ── GET /status — current drift status ──
    if (method === 'GET') {
        var latestSnapId = _getLatestSnapshotId();
        var previousSnapId = _getPreviousSnapshotId(latestSnapId);

        if (!latestSnapId) {
            response.setStatus(200);
            response.setBody(JSON.stringify({
                status: 'no_data',
                message: 'No snapshots found. Run a fingerprint first.',
                latest_snapshot: null,
                drift_score: null,
                trend: []
            }));
            return;
        }

        var driftReport = null;
        if (previousSnapId) {
            driftReport = engine.compareSnapshots(previousSnapId, latestSnapId);
        }

        var timeline = engine.getDriftTimeline(_getInstanceName(), 30);
        var summary = driftReport ? ai.generateSummary(driftReport) : 'No comparison data available.';

        response.setStatus(200);
        response.setBody(JSON.stringify({
            status: driftReport ? 'ok' : 'insufficient_data',
            latest_snapshot: {
                id: latestSnapId,
                name: _getSnapshotName(latestSnapId)
            },
            drift_score: driftReport ? driftReport.drift_score : null,
            gate: driftReport ? driftReport.gate : null,
            drift_count: driftReport ? driftReport.drift_count : 0,
            total_artifacts: driftReport ? driftReport.total_artifacts : 0,
            summary: summary,
            trend: timeline.points || []
        }));
        return;
    }

    // ── Unknown action ──
    response.setStatus(400);
    response.setBody(JSON.stringify({
        error: 'Unknown action. Supported: POST /check (with baseline_id in body), GET /status'
    }));

    // ── Private helpers ──

    function _getLatestSnapshotId() {
        var snap = new GlideRecord('x_csync_snapshot');
        snap.orderByDesc('sys_created_on');
        snap.setLimit(1);
        snap.query();
        if (snap.next()) {
            return snap.getUniqueValue();
        }
        return '';
    }

    function _getPreviousSnapshotId(latestId) {
        if (!latestId) return '';
        var latest = new GlideRecord('x_csync_snapshot');
        if (!latest.get(latestId)) return '';
        var createdOn = latest.getValue('sys_created_on');

        var prev = new GlideRecord('x_csync_snapshot');
        prev.addQuery('sys_created_on', '<', createdOn);
        prev.orderByDesc('sys_created_on');
        prev.setLimit(1);
        prev.query();
        if (prev.next()) {
            return prev.getUniqueValue();
        }
        return '';
    }

    function _getInstanceName() {
        var snap = new GlideRecord('x_csync_snapshot');
        snap.orderByDesc('sys_created_on');
        snap.setLimit(1);
        snap.query();
        if (snap.next()) {
            return snap.getValue('instance') || gs.getProperty('instance_name', '');
        }
        return gs.getProperty('instance_name', '');
    }

    function _getSnapshotName(snapshotId) {
        if (!snapshotId) return '';
        var snap = new GlideRecord('x_csync_snapshot');
        if (snap.get(snapshotId)) {
            return snap.getValue('name') || '';
        }
        return '';
    }

})(request, response);
