// ChangeCollision Radar — CollisionRadarRemediate
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Remediation and notification layer for ChangeCollision Radar. Flags
// high-risk changes for CAB review, notifies the change manager, acknowledges
// collisions, and writes an audit trail. Read-only with respect to change
// state — it never mutates change_request records.
//
// @class CollisionRadarRemediate
// @namespace x_snc_ccr
var CollisionRadarRemediate = Class.create();
CollisionRadarRemediate.prototype = {

    initialize: function () {
    },

    // ------------------------------------------------------------------
    // Flag high-risk changes for mandatory CAB review
    // ------------------------------------------------------------------
    flagForReview: function () {
        var flagged = 0;
        var gr = new GlideRecord('x_snc_ccr_risk');
        gr.addQuery('review_required', 'true');
        gr.addQuery('flagged', 'false');
        gr.query();
        while (gr.next()) {
            gr.setValue('flagged', true);
            gr.setValue('flagged_on', new GlideDateTime().toString());
            try {
                gr.update();
                flagged++;
            } catch (e) {
                gs.error('x_snc_ccr: failed to flag risk row ' + gr.getUniqueValue() + ': ' + e);
            }
        }
        return flagged;
    },

    // ------------------------------------------------------------------
    // Notify the CAB / change manager of new high-risk changes
    // ------------------------------------------------------------------
    notifyCAB: function () {
        var recipients = this._recipients();
        if (!recipients) {
            return 0;
        }
        var highRisk = this._collectHighRisk();
        if (highRisk.length === 0) {
            return 0;
        }

        var body = this._buildDigest(highRisk);
        var mail = new GlideEmailOutbound();
        mail.setTo(recipients);
        mail.setSubject('ChangeCollision Radar — CAB digest: ' + highRisk.length + ' high-risk change(s)');
        mail.setBody(body);
        try {
            mail.send();
            this.logAudit('notify_cab', 'sent digest for ' + highRisk.length + ' high-risk changes');
            return highRisk.length;
        } catch (e) {
            gs.error('x_snc_ccr: CAB notification failed: ' + e);
            return 0;
        }
    },

    _recipients: function () {
        var r = gs.getProperty('x_snc_ccr.notify.recipients');
        if (!r) {
            return null;
        }
        return r;
    },

    _collectHighRisk: function () {
        var rows = [];
        var gr = new GlideRecord('x_snc_ccr_risk');
        gr.addQuery('review_required', 'true');
        gr.addQuery('notified', 'false');
        gr.orderByDesc('score');
        gr.setLimit(50);
        gr.query();
        while (gr.next()) {
            rows.push({
                sys_id: gr.getUniqueValue(),
                change: gr.getValue('change'),
                score: gr.getValue('score'),
                factors_json: gr.getValue('factors_json')
            });
            gr.setValue('notified', true);
            gr.setValue('notified_on', new GlideDateTime().toString());
            try {
                gr.update();
            } catch (e) {
                gs.error('x_snc_ccr: failed to mark risk row notified: ' + e);
            }
        }
        return rows;
    },

    _buildDigest: function (rows) {
        var lines = ['ChangeCollision Radar — CAB Daily Digest', ''];
        lines.push('The following changes require mandatory CAB review:');
        lines.push('');
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var factors = {};
            try {
                factors = JSON.parse(r.factors_json || '{}');
            } catch (e) {
                factors = {};
            }
            lines.push((i + 1) + '. ' + r.change + ' — risk score ' + r.score + '/100');
            lines.push('   collisions: ' + (factors.collision_count || 0) +
                ', affected services: ' + (factors.affected_services || 0) +
                ', freeze overlap: ' + (factors.freeze_overlap_minutes || 0) + ' min');
            lines.push('');
        }
        lines.push('Review the Collision Radar dashboard for the full heatmap and evidence.');
        return lines.join('\n');
    },

    // ------------------------------------------------------------------
    // Acknowledge a collision (idempotent)
    // ------------------------------------------------------------------
    ackCollision: function (collisionSysId) {
        if (!collisionSysId) {
            return { ok: false, error: 'collision sys_id required' };
        }
        var gr = new GlideRecord('x_snc_ccr_collision');
        if (!gr.get(collisionSysId)) {
            return { ok: false, error: 'collision not found' };
        }
        gr.setValue('state', 'acknowledged');
        gr.setValue('acknowledged_on', new GlideDateTime().toString());
        gr.setValue('acknowledged_by', gs.getUserName());
        try {
            gr.update();
            this.logAudit('ack_collision', 'acknowledged collision ' + collisionSysId);
            return { ok: true, sys_id: collisionSysId };
        } catch (e) {
            gs.error('x_snc_ccr: failed to acknowledge collision: ' + e);
            return { ok: false, error: String(e) };
        }
    },

    // ------------------------------------------------------------------
    // Audit logging (platform log — no custom audit table)
    // ------------------------------------------------------------------
    logAudit: function (action, detail) {
        gs.info('x_snc_ccr audit: [' + action + '] ' + detail + ' (user=' + gs.getUserName() + ')');
    },

    type: 'CollisionRadarRemediate'
};
