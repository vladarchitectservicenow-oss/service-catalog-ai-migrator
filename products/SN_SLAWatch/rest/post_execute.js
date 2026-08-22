// SLAWatch — POST /execute: action-dispatch endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Single POST endpoint dispatching on an `action` body parameter.
// Consolidates the design's scan/digest/remediation operations.
(function process(request, response) {
    var body = {};
    try {
        body = (request && request.body && request.body.data) ? request.body.data : {};
    } catch (e) {
        body = {};
    }
    var action = body.action || 'scan';
    var engine = new SlaWatchEngine();
    var report = new SlaWatchReport();
    var result;

    switch (action) {
        case 'scan':
            // Run a full or delta scan of the SLA estate.
            var scanType = body.scan_type || 'full';
            var livenessDays = parseInt(body.liveness_days || '30', 10);
            if (isNaN(livenessDays) || livenessDays <= 0) {
                livenessDays = 30;
            }
            var scanSysId = engine.runFullScan(scanType, livenessDays);
            result = { scan_sys_id: scanSysId, status: scanSysId ? 'completed' : 'failed' };
            break;

        case 'digest':
            // Ranked digest of top breach-risk SLAs.
            var limit = parseInt(body.limit || '10', 10);
            if (isNaN(limit) || limit <= 0) {
                limit = 10;
            }
            result = { digest: report.getRankedDigest(limit) };
            break;

        case 'summary':
            // Executive summary for a given scan.
            var summaryScanId = body.scan_sys_id || '';
            result = { summary: report.getExecutiveSummary(summaryScanId) };
            break;

        case 'narrative':
            // Optional AI breach-impact narrative for a finding.
            var findingId = body.finding_sys_id || '';
            result = { narrative: report.getBreachImpactNarrative(findingId) };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['scan', 'digest', 'summary', 'narrative']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
