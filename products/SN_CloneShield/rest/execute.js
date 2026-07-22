// CloneShield — REST API: POST /api/x_snc_cs/execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Action-dispatch endpoint for restore, export, and manual snapshot operations.
// Body: { action: "restore"|"export"|"snapshot", ...params }

(function process(request, response) {
    try {
        var body = request.body.data;
        var action = body.action || '';
        var csn = new CloneSafetyNet();

        switch (action) {
            case 'restore':
                var snapshotId = body.snapshot_id || '';
                var mode = body.mode || 'overwrite';
                if (!snapshotId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({
                        status: 'error',
                        message: 'snapshot_id is required for restore action'
                    }));
                    return;
                }
                var restoreResult = csn.restoreArtifact(snapshotId, mode);
                response.setBody(JSON.stringify(restoreResult));
                break;

            case 'export':
                var snapshotIds = body.snapshot_ids || [];
                if (snapshotIds.length === 0) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({
                        status: 'error',
                        message: 'snapshot_ids array is required for export action'
                    }));
                    return;
                }
                var exportXml = csn.exportSnapshots(snapshotIds);
                response.setContentType('application/xml');
                response.setBody(exportXml);
                break;

            case 'snapshot':
                var artifactTypes = body.artifact_types || [];
                if (artifactTypes.length === 0) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({
                        status: 'error',
                        message: 'artifact_types array is required for snapshot action'
                    }));
                    return;
                }
                var snapResult = csn.manualSnapshot(artifactTypes);
                response.setBody(JSON.stringify(snapResult));
                break;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    status: 'error',
                    message: 'Unknown action: ' + action + '. Supported actions: restore, export, snapshot'
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            status: 'error',
            message: 'Internal error: ' + e.message
        }));
    }
})(request, response);
