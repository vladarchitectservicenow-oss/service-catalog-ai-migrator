// PerfPulse — POST /execute (action dispatch)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single POST endpoint dispatching all write/query operations via an
// `action` body parameter. Consolidates the design's scan, report, and
// remediation endpoints into one.
(function process(request, response) {

    var body = request.body ? request.body.data : {};
    var action = body.action || 'scan';
    var engine = new PerfPulseEngine();
    var report = new PerfPulseReport();
    var result;

    switch (action) {
        case 'scan':
            result = _handleScan(engine, body);
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
                valid_actions: ['scan', 'report', 'narrative']
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
        var findingId = body.finding_id || '';
        if (!findingId) {
            return { ok: false, error: 'finding_id is required' };
        }
        var finding = report.getFinding(findingId);
        if (!finding) {
            return { ok: false, error: 'Finding not found' };
        }
        var narrative = report.remediationNarrative(finding);
        return { ok: true, narrative: narrative };
    }

})(request, response);
