/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * UpdateSet Inspector — Inspect API (GET)
 * Action-based dispatch for all read/query operations.
 * Endpoint: GET /api/x_usi_inspector/v1/inspect?action=<action>&update_set_sys_id=<id>
 *
 * Actions: content, collisions, dependencies, risk, deploy_order, findings, backups, reports, ai_summaries
 */
(function process(request, response) {
    response.setStatus(200);
    response.setHeader('Content-Type', 'application/json');

    var action = request.queryParams.action || 'content';
    var updateSetSysId = request.queryParams.update_set_sys_id || '';
    var scanBatchId = request.queryParams.scan_batch_id || '';
    var findingType = request.queryParams.finding_type || '';
    var limitStr = request.queryParams.limit || '100';
    var limit = parseInt(limitStr, 10) || 100;

    try {
        var result;

        switch (action) {
            case 'content':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id parameter is required' }));
                    return;
                }
                var parser = new USIContentParser();
                result = parser.parseUpdateSet(updateSetSysId);
                response.setBody(JSON.stringify({ ok: result.ok, data: result.entries || [], count: result.count, error: result.error || null }));
                return;

            case 'collisions':
                var detector = new USICollisionDetector();
                if (updateSetSysId) {
                    result = detector.detectForUpdateSet(updateSetSysId, scanBatchId);
                } else {
                    result = detector.detectAllCollisions(scanBatchId);
                }
                response.setBody(JSON.stringify({ ok: result.ok, data: result.collisions || [], count: result.count, scan_batch_id: result.scan_batch_id, error: result.error || null }));
                return;

            case 'dependencies':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id parameter is required' }));
                    return;
                }
                var analyzer = new USIDependencyAnalyzer();
                result = analyzer.analyzeUpdateSet(updateSetSysId, scanBatchId);
                response.setBody(JSON.stringify({
                    ok: result.ok,
                    dependencies: result.dependencies || [],
                    missing_dependencies: result.missing_dependencies || [],
                    deployment_order: result.deployment_order || [],
                    scan_batch_id: result.scan_batch_id,
                    error: result.error || null
                }));
                return;

            case 'risk':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id parameter is required' }));
                    return;
                }
                var scorer = new USIRiskScorer();
                result = scorer.scoreUpdateSet(updateSetSysId);
                response.setBody(JSON.stringify({ ok: result.ok, data: result, error: result.error || null }));
                return;

            case 'deploy_order':
                if (!updateSetSysId) {
                    response.setStatus(400);
                    response.setBody(JSON.stringify({ ok: false, error: 'update_set_sys_id parameter is required' }));
                    return;
                }
                var depAnalyzer = new USIDependencyAnalyzer();
                var depResult = depAnalyzer.analyzeUpdateSet(updateSetSysId, scanBatchId);
                response.setBody(JSON.stringify({
                    ok: depResult.ok,
                    deployment_order: depResult.deployment_order || [],
                    error: depResult.error || null
                }));
                return;

            case 'findings':
                var fGr = new GlideRecord('x_usi_inspector_finding');
                if (findingType) {
                    fGr.addQuery('finding_type', findingType);
                }
                if (scanBatchId) {
                    fGr.addQuery('scan_batch_id', scanBatchId);
                }
                fGr.setLimit(limit);
                fGr.orderByDesc('sys_created_on');
                fGr.query();
                var findings = [];
                while (fGr.next()) {
                    findings.push({
                        sys_id: fGr.getUniqueValue(),
                        finding_type: fGr.getValue('finding_type'),
                        update_set_a: fGr.getValue('update_set_a'),
                        update_set_b: fGr.getValue('update_set_b'),
                        target_table: fGr.getValue('target_table'),
                        target_record_name: fGr.getValue('target_record_name'),
                        severity: fGr.getValue('severity'),
                        status: fGr.getValue('status'),
                        risk_level: fGr.getValue('risk_level'),
                        description: fGr.getValue('description'),
                        scan_batch_id: fGr.getValue('scan_batch_id')
                    });
                }
                response.setBody(JSON.stringify({ ok: true, data: findings, count: findings.length }));
                return;

            case 'backups':
                var bGr = new GlideRecord('x_usi_inspector_audit');
                bGr.addQuery('record_type', 'backup');
                bGr.setLimit(limit);
                bGr.orderByDesc('sys_created_on');
                bGr.query();
                var backups = [];
                while (bGr.next()) {
                    backups.push({
                        sys_id: bGr.getUniqueValue(),
                        update_set_name: bGr.getValue('update_set_name'),
                        update_set_sys_id: bGr.getValue('update_set_sys_id'),
                        status: bGr.getValue('status'),
                        backup_attachment_sys_id: bGr.getValue('backup_attachment_sys_id'),
                        content_json: bGr.getValue('content_json'),
                        created_on: bGr.getValue('sys_created_on')
                    });
                }
                response.setBody(JSON.stringify({ ok: true, data: backups, count: backups.length }));
                return;

            case 'reports':
                var rGr = new GlideRecord('x_usi_inspector_audit');
                rGr.addQuery('record_type', 'cab_report');
                if (updateSetSysId) {
                    rGr.addQuery('update_set_sys_id', updateSetSysId);
                }
                rGr.setLimit(limit);
                rGr.orderByDesc('sys_created_on');
                rGr.query();
                var reports = [];
                while (rGr.next()) {
                    reports.push({
                        sys_id: rGr.getUniqueValue(),
                        update_set_name: rGr.getValue('update_set_name'),
                        update_set_sys_id: rGr.getValue('update_set_sys_id'),
                        risk_level: rGr.getValue('risk_level'),
                        status: rGr.getValue('status'),
                        record_count: rGr.getValue('record_count'),
                        created_on: rGr.getValue('sys_created_on')
                    });
                }
                response.setBody(JSON.stringify({ ok: true, data: reports, count: reports.length }));
                return;

            case 'ai_summaries':
                var sGr = new GlideRecord('x_usi_inspector_audit');
                sGr.addQuery('record_type', 'ai_summary');
                if (updateSetSysId) {
                    sGr.addQuery('update_set_sys_id', updateSetSysId);
                }
                sGr.setLimit(limit);
                sGr.orderByDesc('sys_created_on');
                sGr.query();
                var summaries = [];
                while (sGr.next()) {
                    summaries.push({
                        sys_id: sGr.getUniqueValue(),
                        update_set_name: sGr.getValue('update_set_name'),
                        update_set_sys_id: sGr.getValue('update_set_sys_id'),
                        content_text: sGr.getValue('content_text'),
                        content_json: sGr.getValue('content_json'),
                        status: sGr.getValue('status'),
                        created_on: sGr.getValue('sys_created_on')
                    });
                }
                response.setBody(JSON.stringify({ ok: true, data: summaries, count: summaries.length }));
                return;

            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    ok: false,
                    error: 'Unknown action: ' + action,
                    valid_actions: ['content', 'collisions', 'dependencies', 'risk', 'deploy_order', 'findings', 'backups', 'reports', 'ai_summaries']
                }));
                return;
        }
    } catch (ex) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ ok: false, error: ex.message }));
    }
})(request, response);