// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — POST /api/x_snc_ai_tower/v1/execute
// Action-based dispatch: ingest | config_update | alert_ack | alert_resolve | register_instance | register_connector

(function process(request, response) {
    var body = request.body ? request.body.data : null;
    if (!body) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Missing request body' } }));
        return;
    }

    var action = body.action || '';
    response.setHeader('Content-Type', 'application/json');

    try {
        switch (action) {
            case 'ingest':
                _handleIngest(body, response);
                break;
            case 'config_update':
                _handleConfigUpdate(body, response);
                break;
            case 'alert_ack':
                _handleAlertAck(body, response);
                break;
            case 'alert_resolve':
                _handleAlertResolve(body, response);
                break;
            case 'register_instance':
                _handleRegisterInstance(body, response);
                break;
            case 'register_connector':
                _handleRegisterConnector(body, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({ ok: false, error: { message: 'Unknown action: ' + action } }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Internal error: ' + e.message } }));
    }
})(request, response);

function _handleIngest(body, response) {
    var core = new TowerCore();
    var result = core.ingest(body);
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: result }));
}

function _handleConfigUpdate(body, response) {
    var gr = new GlideRecord('x_snc_ai_tower_config');
    if (!body.instance_id || !gr.get(body.instance_id)) {
        response.setStatus(404);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Instance not found' } }));
        return;
    }
    if (body.sync_frequency) {
        gr.setValue('sync_frequency', body.sync_frequency);
    }
    if (body.active !== undefined) {
        gr.setValue('active', body.active ? 'true' : 'false');
    }
    if (body.auth_token) {
        gr.setValue('auth_token', body.auth_token);
    }
    gr.update();
    response.setStatus(200);
    response.setBody(JSON.stringify({ ok: true, data: { instance_id: body.instance_id, updated: true } }));
}

function _handleAlertAck(body, response) {
    var gov = new TowerGovernance();
    var result = gov.acknowledgeAlert(body.alert_id, body.acknowledged_by);
    response.setStatus(result ? 200 : 404);
    response.setBody(JSON.stringify({ ok: result, data: { alert_id: body.alert_id, acknowledged: result } }));
}

function _handleAlertResolve(body, response) {
    var gov = new TowerGovernance();
    var result = gov.resolveAlert(body.alert_id, body.resolved_by, body.resolution_note);
    response.setStatus(result ? 200 : 404);
    response.setBody(JSON.stringify({ ok: result, data: { alert_id: body.alert_id, resolved: result } }));
}

function _handleRegisterInstance(body, response) {
    var gr = new GlideRecord('x_snc_ai_tower_config');
    gr.initialize();
    gr.setValue('config_type', 'instance');
    gr.setValue('name', body.name || '');
    gr.setValue('url', body.url || '');
    gr.setValue('instance_type', body.instance_type || 'prod');
    gr.setValue('region', body.region || '');
    gr.setValue('auth_token', body.auth_token || gs.generateGUID());
    gr.setValue('sync_frequency', body.sync_frequency || '15');
    gr.setValue('active', 'true');
    var sysId = gr.insert();
    response.setStatus(201);
    response.setBody(JSON.stringify({ ok: true, data: { instance_id: sysId, auth_token: gr.getValue('auth_token') } }));
}

function _handleRegisterConnector(body, response) {
    var core = new TowerCore();
    var sysId = core.registerConnector({
        product_name: body.product_name,
        source_tables: body.source_tables,
        field_mappings: body.field_mappings,
        version: body.version
    });
    if (sysId) {
        response.setStatus(201);
        response.setBody(JSON.stringify({ ok: true, data: { connector_id: sysId } }));
    } else {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: { message: 'Failed to register connector' } }));
    }
}