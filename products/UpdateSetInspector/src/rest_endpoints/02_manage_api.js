/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * UpdateSet Inspector — Manage API (POST)
 * Action-based dispatch for all mutation/generation operations.
 * Endpoint: POST /api/x_usi_inspector/v1/manage
 * Body: { "action": "<action>", "update_set_sys_id": "<id>", ... }
 *
 * Actions: generate_report, ai_summary, trigger_backup, restore_backup, scan_all_collisions, clear_findings
 */
(function process(request, response) {
    response.setStatus(200);
    response.setHeader('Content-Type', 'application/json');

    var body;
    try {
        body = JSON.parse(request.body.data);
    } catch (e) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: 'Invalid JSON body. Expected { action: "...", ... }' }));
        return;
    }

    if (!body || !body.action) {
        response.setStatus(400);
        response.setBody(JSON.stringify({ ok: false, error: 'Missing required field: action' }));
        return;
    }

    var action = body.action;
    var updateSetSysId = body.update_set_sys_id || '';
    var scanBatchId = body.scan_batch_id || '';
    var auditSysId = body.audit_sys_id || '';

    try {
        var result;

        switch (action) {
            case 'generate_report':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id is required' }));
                    return;
                }
                var reportGen = new USIReportGenerator();
                result = reportGen.generateReport(updateSetSysId);
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    scan_batch_id: result.scan_batch_id,
                    report_preview: result.report_html ? result.report_html.substring(0, 1000) : null,
                    error: result.error || null
                }));
                return;

            case 'ai_summary':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id is required' }));
                    return;
                }
                var summarizer = new USIAIChangeSummarizer();
                result = summarizer.generateSummary(updateSetSysId);
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    summary: result.summary,
                    assessment: result.assessment,
                    recommendation: result.recommendation,
                    source: result.source,
                    error: result.error || null
                }));
                return;

            case 'trigger_backup':
                var backupMgr = new USIBackupManager();
                result = backupMgr.backupAllInProgress();
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    backed_up: result.backed_up,
                    count: result.count,
                    error: result.error || null
                }));
                return;

            case 'restore_backup':
                if (!auditSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'audit_sys_id is required' }));
                    return;
                }
                var restoreMgr = new USIBackupManager();
                result = restoreMgr.restoreBackup(auditSysId);
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    message: result.message,
                    update_set_name: result.update_set_name,
                    error: result.error || null
                }));
                return;

            case 'scan_all_collisions':
                var collisionDetector = new USICollisionDetector();
                result = collisionDetector.detectAllCollisions(scanBatchId);
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    collisions: result.collisions,
                    count: result.count,
                    scan_batch_id: result.scan_batch_id,
                    error: result.error || null
                }));
                return;

            case 'clear_findings':
                if (!scanBatchId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'scan_batch_id is required to clear findings' }));
                    return;
                }
                var clearGr = new GlideRecord('x_usi_inspector_finding');
                clearGr.addQuery('scan_batch_id', scanBatchId);
                clearGr.query();
                var deletedCount = clearGr.getRowCount();
                clearGr.deleteMultiple();
                response.setBody(JSON.stringify({
                    ok: true,
                    deleted_count: deletedCount,
                    scan_batch_id: scanBatchId
                }));
                return;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Unknown action: ' + action,
                    valid_actions: ['generate_report', 'ai_summary', 'trigger_backup', 'restore_backup', 'scan_all_collisions', 'clear_findings']
                }));
                return;
        }
    } catch (ex) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: ex.message }));
    }
})(request, response);