// SN Demo Data Generator — REST Execute Endpoint
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// POST /api/x_sn_demo_data_gen/execute
// Action-dispatch endpoint for all write/query operations.

(function process(request, response) {
    var body = request.body || {};
    var action = body.action || '';

    var engine = new DemoDataEngine();
    var result;

    switch (action) {
        case 'generate':
            result = _handleGenerate(engine, body);
            break;

        case 'preview':
            result = _handlePreview(engine, body);
            break;

        case 'cleanup':
            result = _handleCleanup(engine, body);
            break;

        case 'estimate':
            result = _handleEstimate(engine, body);
            break;

        case 'save_profile':
            result = _handleSaveProfile(engine, body);
            break;

        case 'load_profile':
            result = _handleLoadProfile(engine, body);
            break;

        case 'import_profile':
            result = _handleImportProfile(engine, body);
            break;

        default:
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'Unknown action: ' + action,
                valid_actions: [
                    'generate', 'preview', 'cleanup', 'estimate',
                    'save_profile', 'load_profile', 'import_profile'
                ]
            }));
            return;
    }

    response.setStatus(200);
    response.setBody(JSON.stringify(result));
})(request, response);

// ── Action Handlers ────────────────────────────────────────────────

function _handleGenerate(engine, body) {
    var dashboard = body.dashboard || '';
    var dateStart = body.date_start || '';
    var dateEnd = body.date_end || '';
    var pattern = body.pattern || 'random_walk';
    var multiplier = parseInt(body.multiplier || '1', 10);
    if (multiplier < 1 || multiplier > 10) {
        return { error: 'multiplier must be 1-10' };
    }
    var overrides = body.overrides || {};

    if (!dashboard || !dateStart || !dateEnd) {
        return { error: 'Missing required fields: dashboard, date_start, date_end' };
    }

    return engine.generate(dashboard, dateStart, dateEnd, pattern, multiplier, overrides);
}

function _handlePreview(engine, body) {
    var dashboard = body.dashboard || '';
    var pattern = body.pattern || 'random_walk';
    var overrides = body.overrides || {};

    if (!dashboard) {
        return { error: 'Missing required field: dashboard' };
    }

    return engine.preview(dashboard, pattern, overrides);
}

function _handleCleanup(engine, body) {
    var runId = body.run_id || '';
    var dryRun = body.dry_run === true || body.dry_run === 'true';

    if (!runId) {
        return { error: 'Missing required field: run_id' };
    }

    return engine.cleanup(runId, dryRun);
}

function _handleEstimate(engine, body) {
    var dashboard = body.dashboard || '';
    var dateStart = body.date_start || '';
    var dateEnd = body.date_end || '';
    var multiplier = parseInt(body.multiplier || '1', 10);

    if (!dashboard || !dateStart || !dateEnd) {
        return { error: 'Missing required fields: dashboard, date_start, date_end' };
    }

    return engine.estimate(dashboard, dateStart, dateEnd, multiplier);
}

function _handleSaveProfile(engine, body) {
    var name = body.name || '';
    var description = body.description || '';
    var config = body.config || {};
    if (typeof config !== 'object' || Array.isArray(config)) {
        return { error: 'config must be an object' };
    }
    var userId = body.user_id || gs.getUserID();
    var isShared = body.is_shared === true || body.is_shared === 'true';

    if (!name) {
        return { error: 'Missing required field: name' };
    }

    var sysId = engine.saveProfile(name, description, config, userId, isShared);
    if (!sysId) {
        return { error: 'Failed to save profile' };
    }
    return { sys_id: sysId, name: name };
}

function _handleLoadProfile(engine, body) {
    var profileId = body.profile_id || '';

    if (!profileId) {
        return { error: 'Missing required field: profile_id' };
    }

    var config = engine.loadProfile(profileId);
    if (!config) {
        return { error: 'Profile not found: ' + profileId };
    }
    return { profile_id: profileId, config: config };
}

function _handleImportProfile(engine, body) {
    var jsonStr = body.json || '';
    var userId = body.user_id || gs.getUserID();

    if (!jsonStr) {
        return { error: 'Missing required field: json' };
    }

    var sysId = engine.importJSON(jsonStr, userId);
    if (!sysId) {
        return { error: 'Failed to import profile: invalid JSON' };
    }
    return { sys_id: sysId };
}
