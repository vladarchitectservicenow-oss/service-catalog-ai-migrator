// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — GET /api/x_snc_ai_tower/v1/status
// Query-based dispatch via ?type= parameter
// type=metrics | alerts | instances | instance_status | connectors | roi | nl_query

(function process(request, response) {
    var queryParams = request.queryParams || {};
    var type = queryParams.type || 'instances';
    response.setHeader('Content-Type', 'application/json');

    try {
        switch (type) {
            case 'metrics':
                _getMetrics(queryParams, response);
                break;
            case 'alerts':
                _getAlerts(queryParams, response);
                break;
            case 'instances':
                _getInstances(response);
                break;
            case 'instance_status':
                _getInstanceStatus(queryParams, response);
                break;
            case 'connectors':
                _getConnectors(response);
                break;
            case 'roi':
                _getROI(queryParams, response);
                break;
            case 'nl_query':
                _getNLQuery(queryParams, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({ ok: false, error: { message: 'Unknown type: ' + type } }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Internal error: ' + e.message } }));
    }
})(request, response);

function _getMetrics(queryParams, response) {
    var analytics = new TowerAnalytics();
    var filters = {
        instance: queryParams.instance || null,
        product: queryParams.product || null,
        metric_type: queryParams.metric_type || null,
        since: queryParams.since || null,
        limit: parseInt(queryParams.limit || '500', 10)
    };
    var results = analytics.queryMetrics(filters);
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: results, count: results.length }));
}

function _getAlerts(queryParams, response) {
    var gov = new TowerGovernance();
    var filters = {
        severity: queryParams.severity || null,
        status: queryParams.status || null,
        instance: queryParams.instance || null,
        product: queryParams.product || null,
        limit: parseInt(queryParams.limit || '100', 10)
    };
    var results = gov.getAlerts(filters);
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: results, count: results.length }));
}

function _getInstances(response) {
    var core = new TowerCore();
    var results = core.getInstances();
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: results, count: results.length }));
}

function _getInstanceStatus(queryParams, response) {
    if (!queryParams.instance_id) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'instance_id parameter required' } }));
        return;
    }
    var core = new TowerCore();
    var result = core.getInstanceStatus(queryParams.instance_id);
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: result }));
}

function _getConnectors(response) {
    var core = new TowerCore();
    var results = core.getActiveConnectors();
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: results, count: results.length }));
}

function _getROI(queryParams, response) {
    if (!queryParams.instance_id) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'instance_id parameter required' } }));
        return;
    }
    var analytics = new TowerAnalytics();
    var result;
    if (queryParams.report === 'full') {
        result = analytics.generateReport(queryParams.instance_id);
    } else {
        var timeRange = {};
        if (queryParams.start) timeRange.start = queryParams.start;
        if (queryParams.end) timeRange.end = queryParams.end;
        result = analytics.calculateROI(queryParams.instance_id, timeRange);
    }
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: result }));
}

function _getNLQuery(queryParams, response) {
    var gov = new TowerGovernance();
    var query = queryParams.q || '';
    var translated = gov.translateQuery(query);
    var results = gov.executeQuery(translated.encoded_query, parseInt(queryParams.limit || '100', 10));
    response.setStatus(200);
    response.setBody(JSON.stringify({
        ok: true,
        data: {
            translated: translated,
            results: results,
            count: results.length
        }
    }));
}