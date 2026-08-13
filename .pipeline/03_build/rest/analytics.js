// Now Assist Cost Lens — GET /api/x_nacl/analytics
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter-driven analytics endpoint.
// Supported reports: roi, waste, forecast, summary, breakdown, anomalies

(function process(request, response) {

    var queryParams = request.queryParams || {};
    var report = queryParams.report || 'summary';
    var periodStr = queryParams.period || '30d';
    var feature = queryParams.feature || 'all';

    // Parse period
    var periodDays = 30;
    if (periodStr === '7d') {
        periodDays = 7;
    } else if (periodStr === '90d') {
        periodDays = 90;
    } else if (periodStr === '30d') {
        periodDays = 30;
    }

    var engine = new NACLAnalyticsEngine();
    var result;

    switch (report) {
        case 'roi':
            result = {
                report: 'roi',
                period_days: periodDays,
                data: engine.computeROI(periodDays)
            };
            break;

        case 'waste':
            result = {
                report: 'waste',
                period_days: periodDays,
                data: engine.detectWaste(periodDays)
            };
            break;

        case 'forecast':
            result = {
                report: 'forecast',
                data: engine.forecastSpend(periodDays)
            };
            break;

        case 'summary':
            result = {
                report: 'summary',
                data: engine.getSummary()
            };
            break;

        case 'breakdown':
            var breakdown = engine.getFeatureBreakdown(periodDays);
            if (feature !== 'all') {
                var filtered = [];
                for (var i = 0; i < breakdown.features.length; i++) {
                    if (breakdown.features[i].feature_type === feature) {
                        filtered.push(breakdown.features[i]);
                    }
                }
                breakdown.features = filtered;
            }
            result = {
                report: 'breakdown',
                period_days: periodDays,
                feature_filter: feature,
                data: breakdown
            };
            break;

        case 'anomalies':
            result = {
                report: 'anomalies',
                data: {
                    anomalies: engine.checkAnomalies()
                }
            };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown report type: ' + report,
                supported_reports: ['roi', 'waste', 'forecast', 'summary', 'breakdown', 'anomalies'],
                usage: 'GET /api/x_nacl/analytics?report=<type>&period=7d|30d|90d&feature=<type>'
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

})(request, response);
