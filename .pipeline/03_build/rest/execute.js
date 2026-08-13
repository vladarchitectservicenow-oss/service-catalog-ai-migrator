// Now Assist Cost Lens — POST /api/x_nacl/execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch REST endpoint. Accepts JSON body with "action" field.
// Supported actions: recalculate, forecast, detect_waste, optimize

(function process(request, response) {

    var body = request.body ? request.body.data : null;
    if (!body) {
        response.setStatus(400);
        response.setBody(JSON.stringify({
            error: 'Missing request body',
            message: 'Provide a JSON body with an "action" field'
        }));
        return;
    }

    var action = body.action || '';
    var engine = new NACLAnalyticsEngine();
    var tracker = new NACLCostTracker();
    var result;

    switch (action) {
        case 'recalculate':
            var startDate = body.start_date || null;
            var endDate = body.end_date || null;
            var recalculatedCount = tracker.recalculateAll(startDate, endDate);
            result = {
                action: 'recalculate',
                status: 'completed',
                records_updated: recalculatedCount,
                message: 'All interaction costs recalculated with current config'
            };
            break;

        case 'forecast':
            var projDays = parseInt(body.projection_days) || 30;
            result = {
                action: 'forecast',
                status: 'completed',
                data: engine.forecastSpend(projDays)
            };
            break;

        case 'detect_waste':
            var wasteDays = parseInt(body.period_days) || 7;
            result = {
                action: 'detect_waste',
                status: 'completed',
                data: engine.detectWaste(wasteDays)
            };
            break;

        case 'optimize':
            result = {
                action: 'optimize',
                status: 'completed',
                data: engine.getOptimizationRecommendations()
            };
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                supported_actions: ['recalculate', 'forecast', 'detect_waste', 'optimize']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));

})(request, response);
