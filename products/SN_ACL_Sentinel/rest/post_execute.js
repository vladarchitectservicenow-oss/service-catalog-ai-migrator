// ACL Sentinel — POST /execute (action dispatch)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single POST endpoint dispatching all write/query operations via an
// `action` body parameter. Consolidates the design's scan, drift, and
// remediation endpoints into one.
(function process(request, response) {

    var body = request.body ? request.body.data : {};
    var action = body.action || 'scan';
    var engine = new AclSentinelEngine();
    var report = new AclSentinelReport();
    var result;

    switch (action) {
        case 'scan':
            result = _handleScan(engine, body);
            break;
        case 'drift':
            result = _handleDrift(engine, body);
            break;
        case 'report':
            result = _handleReport(report, body);
            break;
        case 'narrative':
            result = _handleNarrative(report, body);
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'drift', 'report', 'narrative']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

    function _handleScan(engine, body) {
        var scanType = body.scan_type || 'full';
        var sourceEnv = body.source_env || 'local';
        var scanId = engine.runScan(scanType, sourceEnv);
        if (!scanId) {
            return { ok: false, error: 'Scan failed to start' };
        }
        return { ok: true, scan_id: scanId, scan_type: scanType, source_env: sourceEnv };
    }

    function _handleDrift(engine, body) {
        var remoteAcls = body.remote_acls || [];
        var drift = engine.diffEnvironments(remoteAcls);
        return { ok: true, drift: drift };
    }

    function _handleReport(report, body) {
        var scanId = body.scan_id || '';
        var format = body.format || 'markdown';
        if (!scanId) {
            return { ok: false, error: 'scan_id is required' };
        }
        var content = report.buildReport(scanId, format);
        return { ok: true, format: format, report: content };
    }

    function _handleNarrative(report, body) {
        var finding = body.finding || {};
        var narrative = report.remediationNarrative(finding);
        return { ok: true, narrative: narrative };
    }

})(request, response);
