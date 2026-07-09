// ServiceNow Update Set Diff & Review Studio — UsdsReviewManager
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Review workflow, approval lifecycle, comment management, and export for USDS.
// @class UsdsReviewManager @namespace x_snc_usds

var UsdsReviewManager = Class.create();
UsdsReviewManager.prototype = {
    initialize: function() {
        this.diffEngine = new UsdsDiffEngine();
    },

    submitForReview: function(diffResult, reviewerId, title, updateSetIds, conflicts, backupSnapshot) {
        var gr = new GlideRecord('x_snc_usds_review');
        gr.initialize();
        gr.setValue('title', title || 'Update Set Review');
        gr.setValue('update_set_ids', JSON.stringify(updateSetIds || []));
        gr.setValue('diff_results', JSON.stringify(diffResult || {}));
        gr.setValue('status', 'in_review');
        gr.setValue('approval_state', 'requested');
        gr.setValue('reviewer', reviewerId);
        gr.setValue('source_instance', gs.getProperty('instance_name', ''));
        if (conflicts) {
            gr.setValue('conflict_results', JSON.stringify(conflicts));
        }
        if (backupSnapshot) {
            gr.setValue('backup_snapshot', JSON.stringify(backupSnapshot));
        }
        try {
            var summary = this.diffEngine.summarizeChanges(diffResult || {});
            gr.setValue('ai_summary', summary);
        } catch (e) { gs.debug('[USDS] AI summary generation failed: ' + e.message); }
        try {
            var riskScores = this.diffEngine.scoreAllChanges(diffResult || {});
            gr.setValue('risk_scores', JSON.stringify(riskScores));
        } catch (e) { gs.debug('[USDS] Risk scoring failed: ' + e.message); }
        try { return gr.insert(); } catch (e) { gs.error('[USDS] Failed to create review: ' + e.message); throw e; }
    },

    approveChange: function(reviewId, fieldPath) {
        var gr = new GlideRecord('x_snc_usds_review');
        if (!gr.get(reviewId)) throw new Error('Review not found: ' + reviewId);
        this.addComment(reviewId, fieldPath, 'Approved', 'approval');
        this._checkAllApproved(reviewId);
    },

    rejectChange: function(reviewId, fieldPath, reason) {
        var gr = new GlideRecord('x_snc_usds_review');
        if (!gr.get(reviewId)) throw new Error('Review not found: ' + reviewId);
        gr.setValue('status', 'rejected');
        gr.setValue('approval_state', 'rejected');
        try { gr.update(); } catch (e) { gs.error('[USDS] Failed to update review status: ' + e.message); }
        this.addComment(reviewId, fieldPath, 'Rejected: ' + (reason || 'No reason provided'), 'rejection');
    },

    addComment: function(reviewId, fieldPath, text, commentType) {
        var gr = new GlideRecord('x_snc_usds_comment');
        gr.initialize();
        gr.setValue('review', reviewId);
        gr.setValue('field_path', fieldPath || '');
        gr.setValue('comment_text', text || '');
        gr.setValue('comment_type', commentType || 'general');
        gr.setValue('author', gs.getUserID());
        gr.setValue('resolved', false);
        try { return gr.insert(); } catch (e) { gs.error('[USDS] Failed to create comment: ' + e.message); throw e; }
    },

    getReviewStatus: function(reviewId) {
        var gr = new GlideRecord('x_snc_usds_review');
        if (!gr.get(reviewId)) throw new Error('Review not found: ' + reviewId);
        var riskScores = [];
        try { riskScores = JSON.parse(gr.getValue('risk_scores') || '[]'); } catch (e) { riskScores = []; }
        var maxRiskScore = 0;
        for (var r = 0; r < riskScores.length; r++) {
            var scoreNum = parseInt(riskScores[r].score, 10) || 0;
            if (scoreNum > maxRiskScore) maxRiskScore = scoreNum;
        }
        var conflicts = [];
        try { conflicts = JSON.parse(gr.getValue('conflict_results') || '[]'); } catch (e) { conflicts = []; }
        var unresolvedConflicts = 0;
        for (var c = 0; c < conflicts.length; c++) {
            if (conflicts[c].severity === 'BLOCKING') unresolvedConflicts++;
        }
        var status = {
            review_id: reviewId, title: '' + gr.getValue('title'), status: '' + gr.getValue('status'),
            approval_state: '' + gr.getValue('approval_state'), reviewer: '' + gr.getValue('reviewer'),
            created_by: '' + gr.getValue('sys_created_by'), created_at: '' + gr.getValue('sys_created_on'),
            committed_at: '' + gr.getValue('committed_at'), source_instance: '' + gr.getValue('source_instance'),
            ai_summary: '' + gr.getValue('ai_summary'), update_set_ids: [], diff_summary: null,
            conflicts: conflicts, unresolved_conflicts: unresolvedConflicts, risk_scores: riskScores,
            max_risk_score: maxRiskScore, comments: []
        };
        try { status.update_set_ids = JSON.parse(gr.getValue('update_set_ids') || '[]'); } catch (e) { status.update_set_ids = []; }
        try { var diff = JSON.parse(gr.getValue('diff_results') || '{}'); status.diff_summary = diff.summary || null; } catch (e) { status.diff_summary = null; }
        var commentGr = new GlideRecord('x_snc_usds_comment');
        commentGr.addQuery('review', reviewId);
        commentGr.orderBy('sys_created_on');
        commentGr.query();
        while (commentGr.next()) {
            status.comments.push({
                sys_id: '' + commentGr.sys_id, field_path: '' + commentGr.getValue('field_path'),
                comment_text: '' + commentGr.getValue('comment_text'), comment_type: '' + commentGr.getValue('comment_type'),
                author: '' + commentGr.getValue('author'),
                resolved: commentGr.getValue('resolved') == 'true' || commentGr.getValue('resolved') === true,
                created_at: '' + commentGr.getValue('sys_created_on')
            });
        }
        return status;
    },

    exportReport: function(reviewId, format) {
        var status = this.getReviewStatus(reviewId);
        var content = this._generateMarkdownReport(status);
        var attachmentGr = new GlideRecord('sys_attachment');
        attachmentGr.initialize();
        attachmentGr.setValue('table_name', 'x_snc_usds_review');
        attachmentGr.setValue('table_sys_id', reviewId);
        attachmentGr.setValue('file_name', 'usds_review_' + reviewId + '.' + (format === 'md' ? 'md' : 'txt'));
        attachmentGr.setValue('content_type', format === 'md' ? 'text/markdown' : 'text/plain');
        attachmentGr.setValue('size_bytes', content.length);
        try {
            var attSysId = attachmentGr.insert();
            var attWriter = new GlideSysAttachment();
            attWriter.write(attachmentGr, 'usds_review_' + reviewId + '.' + (format === 'md' ? 'md' : 'txt'), format === 'md' ? 'text/markdown' : 'text/plain', content);
            return { attachment_sys_id: attSysId, content: content };
        } catch (e) { gs.error('[USDS] Failed to create export attachment: ' + e.message); throw e; }
    },

    rollbackToSnapshot: function(reviewId) {
        var gr = new GlideRecord('x_snc_usds_review');
        if (!gr.get(reviewId)) throw new Error('Review not found: ' + reviewId);
        var backupStr = gr.getValue('backup_snapshot') || '{}';
        var snapshot;
        try { snapshot = JSON.parse(backupStr); } catch (e) { throw new Error('Invalid backup snapshot: ' + e.message); }
        var result = this.diffEngine.restoreBackup(snapshot);
        gr.setValue('status', 'rolled_back');
        try { gr.update(); } catch (e) { gs.error('[USDS] Failed to update review status after rollback: ' + e.message); }
        this.addComment(reviewId, '', 'Rolled back: ' + result.restored_count + ' records restored, ' + result.failed.length + ' failures', 'resolution');
        return result;
    },

    _checkAllApproved: function(reviewId) {
        var gr = new GlideRecord('x_snc_usds_review');
        if (!gr.get(reviewId)) return;
        var approvalCount = 0;
        var commentGr = new GlideRecord('x_snc_usds_comment');
        commentGr.addQuery('review', reviewId);
        commentGr.addQuery('comment_type', 'approval');
        commentGr.query();
        while (commentGr.next()) approvalCount++;
        var totalChanges = 0;
        try {
            var diff = JSON.parse(gr.getValue('diff_results') || '{}');
            if (diff.modifications) { for (var i = 0; i < diff.modifications.length; i++) totalChanges += diff.modifications[i].changes.length; }
            totalChanges += (diff.additions ? diff.additions.length : 0);
            totalChanges += (diff.deletions ? diff.deletions.length : 0);
        } catch (e) { gs.debug('[USDS] Failed to count changes: ' + e.message); }
        if (approvalCount >= totalChanges && totalChanges > 0) {
            gr.setValue('status', 'approved');
            gr.setValue('approval_state', 'approved');
            try { gr.update(); } catch (e) { gs.error('[USDS] Failed to auto-approve review: ' + e.message); }
        }
    },

    _generateMarkdownReport: function(status) {
        var lines = [];
        lines.push('# USDS Review Report: ' + status.title);
        lines.push('');
        lines.push('**Status:** ' + status.status + ' | **Approval:** ' + status.approval_state);
        lines.push('**Review ID:** ' + status.review_id);
        lines.push('**Created:** ' + status.created_at);
        if (status.committed_at) lines.push('**Committed:** ' + status.committed_at);
        lines.push('');
        if (status.ai_summary) { lines.push('## AI Summary'); lines.push(status.ai_summary); lines.push(''); }
        if (status.diff_summary) {
            lines.push('## Diff Summary');
            lines.push('- Total records: ' + status.diff_summary.total);
            lines.push('- Added: ' + status.diff_summary.added);
            lines.push('- Modified: ' + status.diff_summary.modified);
            lines.push('- Deleted: ' + status.diff_summary.deleted);
            lines.push('- Unchanged: ' + status.diff_summary.unchanged);
            lines.push('');
        }
        if (status.conflicts.length > 0) {
            lines.push('## Conflicts');
            for (var i = 0; i < status.conflicts.length; i++) {
                var c = status.conflicts[i];
                lines.push('- **' + c.severity + '**: ' + c.table + '.' + c.sys_id + ' — ' + c.field);
                lines.push('  - Set A: ' + c.value_a);
                lines.push('  - Set B: ' + c.value_b);
            }
            lines.push('');
        }
        if (status.risk_scores.length > 0) {
            lines.push('## Risk Scores');
            lines.push('| Table | Field | Score | Explanation |');
            lines.push('|-------|-------|-------|-------------|');
            for (var j = 0; j < status.risk_scores.length; j++) {
                var r = status.risk_scores[j];
                lines.push('| ' + r.table + ' | ' + r.field + ' | ' + r.score + ' | ' + (r.explanation || '') + ' |');
            }
            lines.push('');
        }
        if (status.comments.length > 0) {
            lines.push('## Comments');
            for (var k = 0; k < status.comments.length; k++) {
                var cmt = status.comments[k];
                lines.push('- [' + cmt.comment_type + '] ' + cmt.field_path + ': ' + cmt.comment_text);
            }
            lines.push('');
        }
        return lines.join('\n');
    },

    type: 'UsdsReviewManager'
};