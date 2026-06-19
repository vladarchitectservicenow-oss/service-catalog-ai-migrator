// DemoSeed — GET /api/x_demoseed/v1/status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Query-parameter dispatch: batch status, wipe preview, snapshots, profiles, manifest, field suggestions
// Consolidated from 3+ design endpoints into 1 GET endpoint (max 2 constraint)

(function process(request, response) {
    try {
        var q = request.queryParams || {};
        var batchId = q.batch_id || '';
        var showWipePreview = q.wipe_preview === 'true';
        var showSnapshots = q.snapshots === 'true';
        var showProfiles = q.profiles === 'true';
        var showManifest = q.manifest === 'true';
        var dashboardIds = q.dashboard_ids || '';
        var snapshotId = q.snapshot_id || '';
        var suggestMappings = q.suggest_mappings || '';

        var core = new DemoSeedCore();
        var helper = new DemoSeedHelper();
        var result = { queried_at: new GlideDateTime().getValue() };

        // Batch status
        if (batchId) {
            var batchGr = new GlideRecord(core.auditTable);
            batchGr.addQuery('batch_id', batchId);
            batchGr.addQuery('is_batch_header', 'true');
            batchGr.query();
            if (batchGr.next()) {
                result.batch = {
                    batch_id: batchGr.getValue('batch_id'),
                    status: batchGr.getValue('status'),
                    profile_id: batchGr.getValue('profile_id'),
                    total_records: parseInt(batchGr.getValue('total_records'), 10) || 0,
                    tables_processed: batchGr.getValue('tables_processed') || '[]',
                    started_on: batchGr.getValue('started_on') || '',
                    completed_on: batchGr.getValue('completed_on') || '',
                    error_log: batchGr.getValue('error_log') || ''
                };
            } else {
                result.batch = { error: 'Batch not found' };
            }
        }

        // Wipe preview
        if (showWipePreview) {
            result.wipe_preview = core.getWipePreview(batchId || null);
        }

        // Snapshots list
        if (showSnapshots) {
            var snapshots = [];
            var snapGr = new GlideRecord(core.configTable);
            snapGr.addQuery('config_type', 'snapshot');
            snapGr.addQuery('active', 'true');
            snapGr.orderByDesc('sys_created_on');
            snapGr.setLimit(20);
            snapGr.query();
            while (snapGr.next()) {
                snapshots.push({
                    sys_id: snapGr.getUniqueValue(),
                    name: snapGr.getValue('name') || '',
                    description: snapGr.getValue('description') || '',
                    record_count: parseInt(snapGr.getValue('record_count'), 10) || 0,
                    created_on: snapGr.getValue('sys_created_on') || ''
                });
            }
            result.snapshots = snapshots;
        }

        // Single snapshot detail
        if (snapshotId) {
            var detailGr = new GlideRecord(core.configTable);
            if (detailGr.get(snapshotId)) {
                result.snapshot_detail = {
                    sys_id: detailGr.getUniqueValue(),
                    name: detailGr.getValue('name') || '',
                    description: detailGr.getValue('description') || '',
                    record_count: parseInt(detailGr.getValue('record_count'), 10) || 0,
                    created_on: detailGr.getValue('sys_created_on') || ''
                };
            }
        }

        // Profiles list
        if (showProfiles) {
            var profiles = [];
            var profGr = new GlideRecord(core.configTable);
            profGr.addQuery('config_type', 'profile');
            profGr.addQuery('active', 'true');
            profGr.query();
            while (profGr.next()) {
                profiles.push({
                    sys_id: profGr.getUniqueValue(),
                    name: profGr.getValue('name') || '',
                    profile_type: profGr.getValue('profile_type') || 'Custom',
                    volume: parseInt(profGr.getValue('volume'), 10) || 500,
                    date_range_days: parseInt(profGr.getValue('date_range_days'), 10) || 90,
                    target_tables: profGr.getValue('target_tables') || '[]'
                });
            }
            result.profiles = profiles;
        }

        // Dashboard manifest
        if (showManifest) {
            var dashIds = dashboardIds ? dashboardIds.split(',') : null;
            result.manifest = core.buildManifest(dashIds);
        }

        // Field mapping suggestions
        if (suggestMappings) {
            result.field_suggestions = helper.suggestMappings(suggestMappings);
        }

        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal server error: ' + e.message,
            endpoint: 'status'
        }));
    }
})(request, response);