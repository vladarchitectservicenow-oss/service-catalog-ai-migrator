// ServiceNow Update Set Diff & Review Studio — POST /api/x_snc_usds/execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
// Action-dispatch REST endpoint for USDS operations.
// Body: { "action": "diff|backup|rollback|export|submit_review|approve_change|reject_change", ... }

(function process(request, response) {

    var body;
    try {
        body = request.body ? request.body.data : null;
        if (!body) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'Missing request body' }));
            return;
        }
    } catch (e) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ error: 'Invalid request body: ' + e.message }));
        return;
    }

    var action = body.action || '';
    var engine = new UsdsDiffEngine();
    var manager = new UsdsReviewManager();

    try {
        switch (action) {
            case 'diff':
                _handleDiff(body, engine, response);
                break;
            case 'backup':
                _handleBackup(body, engine, response);
                break;
            case 'rollback':
                _handleRollback(body, manager, response);
                break;
            case 'export':
                _handleExport(body, manager, response);
                break;
            case 'submit_review':
                _handleSubmitReview(body, engine, manager, response);
                break;
            case 'approve_change':
                _handleApproveChange(body, manager, response);
                break;
            case 'reject_change':
                _handleRejectChange(body, manager, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['diff', 'backup', 'rollback', 'export', 'submit_review', 'approve_change', 'reject_change']
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error processing action "' + (body && body.action ? body.action : 'unknown') + '": ' + e.message
        }));
    }

    function _handleDiff(body, engine, response) {
        var updateSetIds = body.update_set_ids;
        if (!updateSetIds || !Array.isArray(updateSetIds) || updateSetIds.length < 2) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'update_set_ids must be an array of at least 2 sys_ids' }));
            return;
        }
        var setA = engine.parseUpdateSet(updateSetIds[0]);
        var setB = engine.parseUpdateSet(updateSetIds[1]);
        var diff = engine.diffFieldLevel(setA, setB);
        var conflicts = engine.detectConflicts(setA, setB);
        var riskScores = engine.scoreAllChanges(diff);
        var summary = engine.summarizeChanges(diff);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, diff: diff, conflicts: conflicts, risk_scores: riskScores, summary: summary }));
    }

    function _handleBackup(body, engine, response) {
        var updateSetId = body.update_set_id;
        if (!updateSetId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'update_set_id is required' }));
            return;
        }
        var snapshot = engine.createBackup(updateSetId);
        var count = snapshot && snapshot.records ? snapshot.records.length : 0;
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, backup_id: updateSetId, record_count: count, created_at: (snapshot && snapshot.created_at) ? snapshot.created_at : new GlideDateTime().getValue() }));
    }

    function _handleRollback(body, manager, response) {
        var reviewId = body.review_id;
        if (!reviewId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id is required' }));
            return;
        }
        if (!gs.hasRole('x_snc_usds.admin') && !gs.hasRole('admin')) {
            response.setStatus(403);
            response.setBody(JSON.stringify({ error: 'Forbidden: rollback requires admin role' }));
            return;
        }
        var result = manager.rollbackToSnapshot(reviewId);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, restored_count: result.restored_count, failed: result.failed }));
    }

    function _handleExport(body, manager, response) {
        var reviewId = body.review_id;
        var format = body.format || 'md';
        if (!reviewId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id is required' }));
            return;
        }
        if (format !== 'md') {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'format must be "md". PDF export is not yet implemented.' }));
            return;
        }
        var result = manager.exportReport(reviewId, format);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, attachment_sys_id: result.attachment_sys_id || '', format: format, content: result.content || '' }));
    }

    function _handleSubmitReview(body, engine, manager, response) {
        var updateSetIds = body.update_set_ids;
        var reviewerId = body.reviewer_id;
        if (!updateSetIds || !Array.isArray(updateSetIds) || updateSetIds.length < 2) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'update_set_ids must be an array of at least 2 sys_ids' }));
            return;
        }
        if (!reviewerId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'reviewer_id is required' }));
            return;
        }
        var setA = engine.parseUpdateSet(updateSetIds[0]);
        var setB = engine.parseUpdateSet(updateSetIds[1]);
        var diff = engine.diffFieldLevel(setA, setB);
        var conflicts = engine.detectConflicts(setA, setB);
        var title = body.title || 'Update Set Review';
        var backupSnapshot = engine.createBackup(updateSetIds[0]);
        var reviewId = manager.submitForReview(diff, reviewerId, title, updateSetIds, conflicts, backupSnapshot);
        var status = manager.getReviewStatus(reviewId);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, review_id: reviewId, status: 'in_review', conflict_count: status.unresolved_conflicts, max_risk_score: status.max_risk_score, blocked_by_risk: _checkBlockedByRisk(status.max_risk_score) }));
    }

    function _handleApproveChange(body, manager, response) {
        if (!body.review_id || !body.field_path) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id and field_path required' }));
            return;
        }
        manager.approveChange(body.review_id, body.field_path);
        var status = manager.getReviewStatus(body.review_id);
        if (status.max_risk_score > parseInt(gs.getProperty('x_snc_usds.max_auto_approve_risk', '70'), 10)) {
            response.setStatus(200);
            response.setBody(JSON.stringify({ ok: true, approved: body.field_path, warning: 'High-risk review (' + status.max_risk_score + ') still requires explicit approval before commit' }));
            return;
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, approved: body.field_path }));
    }

    function _handleRejectChange(body, manager, response) {
        if (!body.review_id || !body.field_path) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id and field_path required' }));
            return;
        }
        manager.rejectChange(body.review_id, body.field_path, body.reason || '');
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, rejected: body.field_path }));
    }

    function _checkBlockedByRisk(maxRiskScore) {
        var threshold = parseInt(gs.getProperty('x_snc_usds.max_auto_approve_risk', '70'), 10);
        if (isNaN(threshold)) threshold = 70;
        return maxRiskScore > threshold;
    }

})(request, response);
