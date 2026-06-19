// DemoSeed — POST /api/x_demoseed/v1/execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint: generate, wipe, refresh, snapshots, field mappings, AI features
// Consolidated from 3+ design endpoints into 1 POST endpoint (max 2 constraint)

(function process(request, response) {
    try {
        var body = request.body ? request.body.data : {};
        var action = body.action || 'generate';

        var core = new DemoSeedCore();
        var helper = new DemoSeedHelper();
        var result;

        switch (action) {
            case 'generate':
                result = core.generate(
                    body.profile_id || '',
                    body.volume || 0,
                    body.date_range_days || 0
                );
                break;

            case 'wipe_batch':
                result = core.wipeBatch(body.batch_id || '');
                break;

            case 'wipe_range':
                result = core.wipeByDateRange(
                    body.start_date || '',
                    body.end_date || ''
                );
                break;

            case 'wipe_all':
                result = core.wipeAll();
                break;

            case 'refresh':
                result = helper.refreshDaily();
                break;

            case 'save_snapshot':
                var snapId = helper.saveSnapshot(
                    body.name || 'Untitled Snapshot',
                    body.description || ''
                );
                result = { snapshot_id: snapId, name: body.name };
                break;

            case 'restore_snapshot':
                result = helper.restoreSnapshot(body.snapshot_id || '');
                break;

            case 'export_snapshot_xml':
                result = { xml: helper.exportXML(body.snapshot_id || '') };
                break;

            case 'apply_field_mappings':
                result = {
                    created: helper.applyMapping(
                        body.table_name || '',
                        body.mappings || []
                    )
                };
                break;

            case 'generate_descriptions':
                result = {
                    descriptions: helper.generateDescriptions(
                        body.table_name || 'incident',
                        body.count || 10
                    )
                };
                break;

            case 'generate_narrative':
                result = {
                    narrative: helper.generateDemoNarrative(body.dashboard_data || {})
                };
                break;

            case 'validate_quality':
                result = helper.validateDataQuality(body.records || []);
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: [
                        'generate', 'wipe_batch', 'wipe_range', 'wipe_all',
                        'refresh', 'save_snapshot', 'restore_snapshot',
                        'export_snapshot_xml', 'apply_field_mappings',
                        'generate_descriptions', 'generate_narrative', 'validate_quality'
                    ]
                }));
                return;
        }

        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal server error: ' + e.message,
            endpoint: 'execute'
        }));
    }
})(request, response);