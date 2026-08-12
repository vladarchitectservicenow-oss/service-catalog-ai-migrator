// REST Medic — Scripted REST API Health Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST /api/x_vlad_rest_medic/execute — Action-dispatch endpoint
// Actions: scan_all, scan_one, get_report, get_alerts

(function process(request, response) {
    var engine = new RESTMedicEngine();
    var alerter = new RESTMedicAlerter();

    try {
        var body = request.body;
        var action = body.action || '';

        switch (action) {
            case 'scan_all':
                var result = engine.scanAll();
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    success: true,
                    action: 'scan_all',
                    data: result
                }));
                break;

            case 'scan_one':
                var endpointId = body.endpoint_id || '';
                if (!endpointId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({
                        success: false,
                        error: 'Missing required parameter: endpoint_id'
                    }));
                    return;
                }
                var scanResult = engine.scanOne(endpointId);
                if (scanResult.error) {
                    response.setStatus(404);
                    response.setBody(JSON.stringify({
                        success: false,
                        error: scanResult.error
                    }));
                } else {
                    response.setStatus(200);
                    response.setBody(JSON.stringify({
                        success: true,
                        action: 'scan_one',
                        data: scanResult
                    }));
                }
                break;

            case 'get_report':
                var report = engine.getHealthReport();
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    success: true,
                    action: 'get_report',
                    data: report
                }));
                break;

            case 'get_alerts':
                var hoursBack = parseInt(body.hours_back || '168', 10);
                var alerts = alerter.getAlertHistory(hoursBack);
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    success: true,
                    action: 'get_alerts',
                    data: { alerts: alerts, count: alerts.length }
                }));
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    success: false,
                    error: 'Unknown action: ' + action + '. Supported actions: scan_all, scan_one, get_report, get_alerts'
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            success: false,
            error: 'Internal error: ' + e.toString()
        }));
    }
})(request, response);
