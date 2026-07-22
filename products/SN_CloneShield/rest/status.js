// CloneShield — REST API: GET /api/x_snc_cs/status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter dispatch endpoint for dashboard data.
// Query params: ?action=history|conflicts|calendar|health

(function process(request, response) {
    try {
        var queryParams = request.queryParams;
        var action = queryParams.action || 'health';
        var csn = new CloneSafetyNet();

        switch (action) {
            case 'history':
                var historyResult = csn.getStatus('history');
                response.setBody(JSON.stringify(historyResult));
                break;

            case 'conflicts':
                var conflictsResult = csn.getStatus('conflicts');
                response.setBody(JSON.stringify(conflictsResult));
                break;

            case 'calendar':
                var calendarResult = csn.getStatus('calendar');
                response.setBody(JSON.stringify(calendarResult));
                break;

            case 'health':
                var healthResult = csn.getStatus('health');
                response.setBody(JSON.stringify(healthResult));
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action + '. Supported actions: history, conflicts, calendar, health'
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error: ' + e.message
        }));
    }
})(request, response);
