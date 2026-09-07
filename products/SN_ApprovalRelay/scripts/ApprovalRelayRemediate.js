// ApprovalRelay — Stalled & Orphaned Approval Detector with Auto-Remediation
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// ApprovalRelayRemediate — per-bucket remediation, alerting, and audit logging.
// Applies the configured per-bucket action (reassign / escalate / prompt
// delegation), raises notifications and/or incidents, and records every action
// on the stall record itself (remediation fields) for compliance. Destructive
// actions are off-by-default and require explicit per-bucket enablement.
//
// @class ApprovalRelayRemediate
// @namespace x_sn_approval_relay
var ApprovalRelayRemediate = Class.create();
ApprovalRelayRemediate.prototype = {

    initialize: function () {
        this._config = this._loadConfig();
    },

    _loadConfig: function () {
        return {
            reassignEnabled: gs.getProperty('x_sn_approval_relay.reassign_enabled', 'false') === 'true',
            escalateEnabled: gs.getProperty('x_sn_approval_relay.escalate_enabled', 'false') === 'true',
            promptEnabled: gs.getProperty('x_sn_approval_relay.prompt_enabled', 'true') === 'true',
            createIncident: gs.getProperty('x_sn_approval_relay.create_incident', 'true') === 'true',
            notifyUsers: gs.getProperty('x_sn_approval_relay.notify_users', ''),
            alertCooldownMinutes: parseInt(gs.getProperty('x_sn_approval_relay.alert_cooldown_minutes', '60'), 10)
        };
    },

    // ---- Remediate a single stall ----

    remediate: function (stall) {
        var action = this._actionForBucket(stall.bucket);
        var result = { bucket: stall.bucket, action: action, applied: false, detail: '' };

        switch (action) {
            case 'reassign':
                result = this._reassignToManager(stall);
                break;
            case 'escalate':
                result = this._escalateToAssigned(stall);
                break;
            case 'prompt':
                result = this._promptDelegation(stall);
                break;
            default:
                result.detail = 'No remediation action configured for bucket ' + stall.bucket;
                break;
        }

        this._recordRemediation(stall, action, result);
        return result;
    },

    _actionForBucket: function (bucket) {
        switch (bucket) {
            case 'orphaned_approver':
                return this._config.reassignEnabled ? 'reassign' : 'prompt';
            case 'no_delegation':
                return this._config.promptEnabled ? 'prompt' : 'none';
            case 'dead_group':
                return this._config.escalateEnabled ? 'escalate' : 'prompt';
            case 'dead_end_chain':
                return this._config.escalateEnabled ? 'escalate' : 'prompt';
            case 'silent_approver':
                return this._config.promptEnabled ? 'prompt' : 'none';
            default:
                return 'none';
        }
    },

    // ---- Reassign to the approver's manager ----

    _reassignToManager: function (stall) {
        if (!stall.approver) {
            return { bucket: stall.bucket, action: 'reassign', applied: false, detail: 'No approver to reassign from' };
        }
        var managerSysId = this._managerOf(stall.approver);
        if (!managerSysId) {
            return { bucket: stall.bucket, action: 'reassign', applied: false, detail: 'Approver has no manager on record' };
        }
        try {
            var gr = new GlideRecord('sysapproval_approver');
            if (gr.get(stall.approval)) {
                gr.setValue('approver', managerSysId);
                gr.update();
                return { bucket: stall.bucket, action: 'reassign', applied: true, detail: 'Reassigned to manager ' + managerSysId };
            }
            return { bucket: stall.bucket, action: 'reassign', applied: false, detail: 'Approval record not found' };
        } catch (e) {
            gs.error('ApprovalRelayRemediate._reassignToManager failed: ' + e.message);
            return { bucket: stall.bucket, action: 'reassign', applied: false, detail: e.message };
        }
    },

    // ---- Escalate to the request's assigned_to ----

    _escalateToAssigned: function (stall) {
        try {
            var approvalGr = new GlideRecord('sysapproval_approver');
            if (!approvalGr.get(stall.approval)) {
                return { bucket: stall.bucket, action: 'escalate', applied: false, detail: 'Approval record not found' };
            }
            var taskSysId = approvalGr.getValue('sysapproval') || '';
            if (!taskSysId) {
                return { bucket: stall.bucket, action: 'escalate', applied: false, detail: 'No parent task to escalate to' };
            }
            var taskGr = new GlideRecord('task');
            if (!taskGr.get(taskSysId)) {
                return { bucket: stall.bucket, action: 'escalate', applied: false, detail: 'Parent task not found' };
            }
            var assignedTo = taskGr.getValue('assigned_to') || '';
            if (!assignedTo) {
                return { bucket: stall.bucket, action: 'escalate', applied: false, detail: 'Parent task has no assigned_to' };
            }
            // Escalation is a notification to the assignee, not a state mutation.
            gs.eventQueue('x_sn_approval_relay.escalation', null, stall.approval_number, assignedTo);
            return { bucket: stall.bucket, action: 'escalate', applied: true, detail: 'Escalated to assignee ' + assignedTo };
        } catch (e) {
            gs.error('ApprovalRelayRemediate._escalateToAssigned failed: ' + e.message);
            return { bucket: stall.bucket, action: 'escalate', applied: false, detail: e.message };
        }
    },

    // ---- One-click delegation prompt to the approver's manager ----

    _promptDelegation: function (stall) {
        var managerSysId = stall.approver ? this._managerOf(stall.approver) : '';
        if (!managerSysId) {
            return { bucket: stall.bucket, action: 'prompt', applied: false, detail: 'No manager to prompt for delegation' };
        }
        try {
            gs.eventQueue('x_sn_approval_relay.delegation_prompt', null, stall.approval_number, managerSysId);
            return { bucket: stall.bucket, action: 'prompt', applied: true, detail: 'Delegation prompt sent to manager ' + managerSysId };
        } catch (e) {
            gs.error('ApprovalRelayRemediate._promptDelegation failed: ' + e.message);
            return { bucket: stall.bucket, action: 'prompt', applied: false, detail: e.message };
        }
    },

    _managerOf: function (userSysId) {
        var gr = new GlideRecord('sys_user');
        if (!gr.get(userSysId)) {
            return '';
        }
        return gr.getValue('manager') || '';
    },

    // ---- Record remediation + audit trail on the stall record ----

    _recordRemediation: function (stall, action, result) {
        try {
            var gr = new GlideRecord('x_sn_approval_relay_stall');
            if (!gr.get(stall.sys_id)) {
                return;
            }
            if (result.applied) {
                gr.setValue('state', 'remediated');
                gr.setValue('remediated_on', new GlideDateTime().getDisplayValue());
            }
            gr.setValue('remediation_action', action);
            gr.setValue('remediation_actor', gs.getUserName());
            gr.setValue('remediation_detail', result.detail || '');
            gr.update();
        } catch (e) {
            gs.error('ApprovalRelayRemediate._recordRemediation failed: ' + e.message);
        }
    },

    // ---- Alerting ----

    raiseAlert: function (stall) {
        if (this._isInCooldown(stall.approval, stall.bucket)) {
            return null;
        }
        var alertSysId = this._persistAlert(stall);
        if (stall.bucket === 'orphaned_approver' || stall.bucket === 'dead_group' || stall.bucket === 'dead_end_chain') {
            if (this._config.createIncident) {
                this._createIncident(stall, alertSysId);
            }
        }
        this._raiseNotification(stall);
        return alertSysId;
    },

    _isInCooldown: function (approvalSysId, bucket) {
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-this._config.alertCooldownMinutes * 60);
        var gr = new GlideRecord('x_sn_approval_relay_alert');
        gr.addQuery('approval', approvalSysId);
        gr.addQuery('bucket', bucket);
        gr.addQuery('state', 'open');
        gr.addQuery('sys_created_on', '>', cutoff.getDisplayValue());
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    _persistAlert: function (stall) {
        try {
            var gr = new GlideRecord('x_sn_approval_relay_alert');
            gr.initialize();
            gr.setValue('approval', stall.approval);
            gr.setValue('approval_number', stall.approval_number);
            gr.setValue('bucket', stall.bucket);
            gr.setValue('severity', this._severityForBucket(stall.bucket));
            gr.setValue('evidence_json', stall.evidence_json ? stall.evidence_json.substring(0, 4000) : '');
            gr.setValue('state', 'open');
            return gr.insert();
        } catch (e) {
            gs.error('ApprovalRelayRemediate._persistAlert failed: ' + e.message);
            return null;
        }
    },

    _severityForBucket: function (bucket) {
        if (bucket === 'orphaned_approver' || bucket === 'dead_group' || bucket === 'dead_end_chain') {
            return 'critical';
        }
        return 'warning';
    },

    _createIncident: function (stall, alertSysId) {
        try {
            var inc = new GlideRecord('incident');
            inc.initialize();
            inc.setValue('short_description', 'ApprovalRelay: stalled approval ' + stall.approval_number + ' (' + stall.bucket + ')');
            inc.setValue('description',
                'Approval: ' + stall.approval_number + '\n' +
                'Bucket: ' + stall.bucket + '\n' +
                'Approver: ' + (stall.approver_name || stall.approver || '(group)') + '\n\n' +
                'Evidence:\n' + (stall.evidence_json || '')
            );
            inc.setValue('impact', this._severityForBucket(stall.bucket) === 'critical' ? '1' : '2');
            inc.setValue('urgency', this._severityForBucket(stall.bucket) === 'critical' ? '1' : '2');
            var incSysId = inc.insert();
            if (incSysId && alertSysId) {
                var alertGr = new GlideRecord('x_sn_approval_relay_alert');
                if (alertGr.get(alertSysId)) {
                    alertGr.setValue('incident', incSysId);
                    alertGr.update();
                }
            }
            return incSysId;
        } catch (e) {
            gs.error('ApprovalRelayRemediate._createIncident failed: ' + e.message);
            return null;
        }
    },

    _raiseNotification: function (stall) {
        try {
            var recipients = this._config.notifyUsers;
            if (!recipients) {
                return;
            }
            var users = recipients.split(',');
            for (var i = 0; i < users.length; i++) {
                var user = users[i].trim();
                if (!user) { continue; }
                gs.eventQueue('x_sn_approval_relay.alert', null, stall.approval_number, user);
            }
        } catch (e) {
            gs.error('ApprovalRelayRemediate._raiseNotification failed: ' + e.message);
        }
    },

    // ---- Acknowledge an alert ----

    acknowledge: function (alertSysId, ackedBy) {
        var gr = new GlideRecord('x_sn_approval_relay_alert');
        if (!gr.get(alertSysId)) {
            return { ok: false, error: 'Alert not found' };
        }
        gr.setValue('state', 'acknowledged');
        gr.setValue('acked_by', ackedBy || '');
        gr.setValue('acked_on', new GlideDateTime().getDisplayValue());
        gr.update();
        return { ok: true, sys_id: alertSysId };
    },

    type: 'ApprovalRelayRemediate'
};
