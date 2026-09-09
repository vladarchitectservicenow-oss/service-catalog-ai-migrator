// RESTPulse — Outbound REST Message & Integration Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST /execute — action-dispatch endpoint for all write/query operations.
// Actions: evaluate, snapshot, alert, save_config
(function process(request, response) {
    var body = request.body ? request.body.data : {};
    var action = body.action || 'evaluate';
    var engine = new RESTPulseEngine();
    var result;

    switch (action) {
        case 'evaluate':
            result = engine.runEvaluation();
            break;
        case 'snapshot':
            result = { snapshots_written: engine.snapshotHistory() };
            break;
        case 'alert':
            var alerter = new RESTPulseAlert();
            result = alerter.runAlertCycle();
            break;
        case 'save_config':
            var updates = body.config || {};
            result = { saved: engine.saveConfig(updates), config: engine.getConfig() };
            break;
        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: ['evaluate', 'snapshot', 'alert', 'save_config']
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);
