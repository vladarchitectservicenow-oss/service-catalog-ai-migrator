// ServiceNow Update Set Diff & Review Studio — GET /api/x_snc_usds/status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
// Query endpoint for review status, conflicts, history, and comments.

(function process(request, response) {
    var action = request.queryParams.action || '';
    var manager = new UsdsReviewManager();

    try {
        switch (action) {
            case '':
            case 'review':
                _handleReviewStatus(request, manager, response);
                break;
            case 'conflicts':
                _handleConflicts(request, response);
                break;
            case 'history':
                _handleHistory(request, response);
                break;
            case 'comments':
                _handleComments(request, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Unknown action: ' + action,
                    valid_actions: ['review', 'conflicts', 'history', 'comments']
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error: ' + e.message
        }));
    }

    function _handleReviewStatus(request, manager, response) {
        var reviewId = request.queryParams.review_id;
        if (!reviewId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id is required' }));
            return;
        }
        var status = manager.getReviewStatus(reviewId);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: status }));
    }

    function _handleConflicts(request, response) {
        var setA = request.queryParams.set_a;
        var setB = request.queryParams.set_b;
        if (!setA || !setB) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'set_a and set_b are required' }));
            return;
        }
        var engine = new UsdsDiffEngine();
        var a = engine.parseUpdateSet(setA);
        var b = engine.parseUpdateSet(setB);
        var conflicts = engine.detectConflicts(a, b);
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: { conflicts: conflicts } }));
    }

    function _handleHistory(request, response) {
        var table = request.queryParams.table;
        if (!table) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'table is required' }));
            return;
        }
        var gr = new GlideRecord('x_snc_usds_review');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(50);
        gr.query();
        var history = [];
        while (gr.next()) {
            var diff = JSON.parse(gr.getValue('diff_results') || '{}');
            var tableRecords = [];
            var lists = ['additions', 'modifications', 'deletions', 'unchanged'];
            for (var i = 0; i < lists.length; i++) {
                var list = diff[lists[i]] || [];
                for (var j = 0; j < list.length; j++) {
                    if (list[j].table === table) tableRecords.push(list[j].sys_id || list[j].name || 'unknown');
                }
            }
            if (tableRecords.length > 0) {
                history.push({
                    review_id: gr.getValue('sys_id'),
                    number: gr.getValue('number'),
                    created_on: gr.getValue('sys_created_on'),
                    records: tableRecords
                });
            }
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: { table: table, history: history } }));
    }

    function _handleComments(request, response) {
        var reviewId = request.queryParams.review_id;
        if (!reviewId) {
            response.setStatus(400);
            response.setBody(JSON.stringify({ error: 'review_id is required' }));
            return;
        }
        var gr = new GlideRecord('x_snc_usds_comment');
        gr.addQuery('review', reviewId);
        gr.orderBy('sys_created_on');
        gr.query();
        var comments = [];
        while (gr.next()) {
            comments.push({
                field_path: gr.getValue('field_path'),
                comment_text: gr.getValue('comment_text'),
                comment_type: gr.getValue('comment_type'),
                author: gr.getValue('author'),
                created_on: gr.getValue('sys_created_on'),
                resolved: gr.getValue('resolved') == 'true'
            });
        }
        response.setStatus(200);
        response.setBody(JSON.stringify({ ok: true, data: { review_id: reviewId, comments: comments } }));
    }

})(request, response);
