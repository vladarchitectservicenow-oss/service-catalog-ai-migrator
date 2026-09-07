// ApprovalRelay — Stalled & Orphaned Approval Detector with Auto-Remediation
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// ApprovalRelayEngine — deterministic stalled-approval scanner and five-bucket
// root-cause classifier. Reads sysapproval_approver / sysapproval_group /
// sys_user / sys_user_group / sys_user_grmember / sys_user_delegate and
// assigns every stalled approval to exactly one root cause.
//
// Detection and classification are deterministic GlideRecord/GlideAggregate
// logic. AI is a read-only explainer layered on top — it never classifies a
// stall and never mutates approval state.
//
// @class ApprovalRelayEngine
// @namespace x_sn_approval_relay
var ApprovalRelayEngine = Class.create();
ApprovalRelayEngine.prototype = {

    initialize: function () {
        this._config = this._loadConfig();
    },

    // ---- Configuration (system properties, no config table) ----

    _loadConfig: function () {
        return {
            stallHours: parseInt(gs.getProperty('x_sn_approval_relay.stall_hours', '48'), 10),
            orphanedEnabled: gs.getProperty('x_sn_approval_relay.orphaned_enabled', 'true') === 'true',
            noDelegationEnabled: gs.getProperty('x_sn_approval_relay.no_delegation_enabled', 'true') === 'true',
            deadGroupEnabled: gs.getProperty('x_sn_approval_relay.dead_group_enabled', 'true') === 'true',
            deadEndEnabled: gs.getProperty('x_sn_approval_relay.dead_end_enabled', 'true') === 'true',
            silentEnabled: gs.getProperty('x_sn_approval_relay.silent_enabled', 'true') === 'true',
            awayLoginHours: parseInt(gs.getProperty('x_sn_approval_relay.away_login_hours', '72'), 10)
        };
    },

    // ---- Public entry point: scan all stalled approvals ----

    scanStalled: function () {
        var results = [];
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-this._config.stallHours * 3600);

        // Individual approver records still in 'requested' state past the cutoff.
        var gr = new GlideRecord('sysapproval_approver');
        gr.addQuery('state', 'requested');
        gr.addQuery('sys_created_on', '<', cutoff.getDisplayValue());
        gr.orderBy('sys_created_on');
        gr.query();
        while (gr.next()) {
            var stall = this.classifyStall(gr);
            if (stall) {
                this._persistStall(stall);
                results.push(stall);
            }
        }

        // Group approval records still in 'requested' state past the cutoff.
        var ggr = new GlideRecord('sysapproval_group');
        ggr.addQuery('state', 'requested');
        ggr.addQuery('sys_created_on', '<', cutoff.getDisplayValue());
        ggr.orderBy('sys_created_on');
        ggr.query();
        while (ggr.next()) {
            var gstall = this.classifyGroupStall(ggr);
            if (gstall) {
                this._persistStall(gstall);
                results.push(gstall);
            }
        }

        return results;
    },

    // ---- Five-bucket classifier (individual approver) ----

    classifyStall: function (approvalGr) {
        var approverSysId = approvalGr.getValue('approver') || '';
        var approvalSysId = approvalGr.getUniqueValue();
        var approvalNumber = this._approvalNumber(approvalGr);

        // Bucket 4 — Dead-end chain: empty or non-resolving approver reference.
        // An approval with no approver is a broken chain, not a silent approver.
        if (this._config.deadEndEnabled && (!approverSysId || !this._userExists(approverSysId))) {
            return this._buildStall(approvalSysId, approvalNumber, approverSysId, 'dead_end_chain', {
                reason: approverSysId
                    ? 'Approver reference does not resolve to an existing sys_user record'
                    : 'Approval has no approver reference (empty approver field)',
                approver_sys_id: approverSysId
            });
        }

        // Bucket 1 — Orphaned approver: user exists but is inactive/terminated.
        if (this._config.orphanedEnabled && approverSysId && this._isOrphaned(approverSysId)) {
            return this._buildStall(approvalSysId, approvalNumber, approverSysId, 'orphaned_approver', {
                reason: 'Approver user record is inactive or terminated',
                approver_sys_id: approverSysId
            });
        }

        // Bucket 2 — No delegation: active user, away (stale login), no active delegate.
        if (this._config.noDelegationEnabled && approverSysId && this._isAway(approverSysId) && !this._hasDelegation(approverSysId)) {
            return this._buildStall(approvalSysId, approvalNumber, approverSysId, 'no_delegation', {
                reason: 'Approver is away (stale last login) with no active delegation',
                approver_sys_id: approverSysId
            });
        }

        // Bucket 5 — Silent approver: active, responsive-capable, but no action.
        if (this._config.silentEnabled) {
            return this._buildStall(approvalSysId, approvalNumber, approverSysId, 'silent_approver', {
                reason: 'Approver is active but has not acted on the approval',
                approver_sys_id: approverSysId
            });
        }

        // All applicable buckets disabled — do not classify this record.
        return null;
    },

    // ---- Five-bucket classifier (group approval) ----

    classifyGroupStall: function (groupGr) {
        var groupSysId = groupGr.getValue('group') || '';
        var approvalSysId = groupGr.getUniqueValue();
        var approvalNumber = this._approvalNumber(groupGr);

        // Bucket 4 — Dead-end chain: empty or non-resolving group reference.
        // An approval with no group is a broken chain, not a silent approver.
        if (this._config.deadEndEnabled && (!groupSysId || !this._groupExists(groupSysId))) {
            return this._buildStall(approvalSysId, approvalNumber, '', 'dead_end_chain', {
                reason: groupSysId
                    ? 'Group reference does not resolve to an existing sys_user_group record'
                    : 'Approval has no group reference (empty group field)',
                group_sys_id: groupSysId
            });
        }

        // Bucket 3 — Dead group: group exists but has zero active members.
        if (this._config.deadGroupEnabled && groupSysId && this._isDeadGroup(groupSysId)) {
            return this._buildStall(approvalSysId, approvalNumber, '', 'dead_group', {
                reason: 'Approval group has zero active members',
                group_sys_id: groupSysId
            });
        }

        // Bucket 5 — Silent approver: group is healthy but no member has acted.
        if (this._config.silentEnabled) {
            return this._buildStall(approvalSysId, approvalNumber, '', 'silent_approver', {
                reason: 'Approval group is healthy but no member has acted',
                group_sys_id: groupSysId
            });
        }

        // All applicable buckets disabled — do not classify this record.
        return null;
    },

    // ---- Bucket predicates ----

    // Derive a human-readable approval number. sysapproval_approver and
    // sysapproval_group have no 'number' field; the parent task (referenced by
    // 'sysapproval') carries the display number. Fall back to the parent sys_id
    // and finally to the approval record's own sys_id.
    _approvalNumber: function (approvalGr) {
        var taskSysId = approvalGr.getValue('sysapproval') || '';
        if (taskSysId) {
            var taskGr = new GlideRecord('task');
            if (taskGr.get(taskSysId)) {
                return taskGr.getValue('number') || taskSysId;
            }
            return taskSysId;
        }
        return approvalGr.getUniqueValue();
    },

    _userExists: function (userSysId) {
        var gr = new GlideRecord('sys_user');
        return gr.get(userSysId);
    },

    _groupExists: function (groupSysId) {
        var gr = new GlideRecord('sys_user_group');
        return gr.get(groupSysId);
    },

    _isOrphaned: function (userSysId) {
        var gr = new GlideRecord('sys_user');
        if (!gr.get(userSysId)) {
            return false;
        }
        return gr.getValue('active') === 'false' || gr.getValue('active') === false;
    },

    _isAway: function (userSysId) {
        var gr = new GlideRecord('sys_user');
        if (!gr.get(userSysId)) {
            return false;
        }
        var lastLogin = gr.getValue('last_login_time') || gr.getValue('last_login') || '';
        if (!lastLogin) {
            // No login ever recorded — treat as away (never active on the platform).
            return true;
        }
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-this._config.awayLoginHours * 3600);
        var last = new GlideDateTime(lastLogin);
        return last.getNumericValue() < cutoff.getNumericValue();
    },

    _hasDelegation: function (userSysId) {
        var now = new GlideDateTime();
        var gr = new GlideRecord('sys_user_delegate');
        gr.addQuery('user', userSysId);
        gr.addQuery('starts', '<=', now.getDisplayValue());
        gr.addQuery('ends', '>=', now.getDisplayValue());
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    _isDeadGroup: function (groupSysId) {
        var agg = new GlideAggregate('sys_user_grmember');
        agg.addQuery('group', groupSysId);
        agg.addQuery('user.active', 'true');
        agg.addAggregate('COUNT');
        agg.query();
        if (agg.next()) {
            return parseInt(agg.getAggregate('COUNT'), 10) === 0;
        }
        // No aggregate row returned — the group has no active members (dead group).
        return true;
    },

    // ---- Stall record builder ----

    _buildStall: function (approvalSysId, approvalNumber, approverSysId, bucket, evidence) {
        var approverName = '';
        if (approverSysId) {
            var ugr = new GlideRecord('sys_user');
            if (ugr.get(approverSysId)) {
                approverName = ugr.getValue('name') || ugr.getValue('user_name') || approverSysId;
            }
        }
        return {
            approval: approvalSysId,
            approval_number: approvalNumber,
            approver: approverSysId,
            approver_name: approverName,
            bucket: bucket,
            evidence_json: JSON.stringify(evidence),
            classified_on: new GlideDateTime().getDisplayValue()
        };
    },

    // ---- Persistence ----

    _persistStall: function (stall) {
        try {
            // Dedup: skip if an open stall already exists for this approval + bucket.
            var existing = new GlideRecord('x_sn_approval_relay_stall');
            existing.addQuery('approval', stall.approval);
            existing.addQuery('bucket', stall.bucket);
            existing.addQuery('state', 'open');
            existing.setLimit(1);
            existing.query();
            if (existing.hasNext()) {
                return;
            }

            var gr = new GlideRecord('x_sn_approval_relay_stall');
            gr.initialize();
            gr.setValue('approval', stall.approval);
            gr.setValue('approval_number', stall.approval_number);
            gr.setValue('approver', stall.approver);
            gr.setValue('approver_name', stall.approver_name);
            gr.setValue('bucket', stall.bucket);
            gr.setValue('evidence_json', stall.evidence_json ? stall.evidence_json.substring(0, 4000) : '');
            gr.setValue('classified_on', stall.classified_on);
            gr.setValue('state', 'open');
            stall.sys_id = gr.insert();
        } catch (e) {
            gs.error('ApprovalRelayEngine._persistStall failed for approval ' + stall.approval + ': ' + e.message);
        }
    },

    // ---- Read helpers for REST / AI explainer ----

    getStalls: function (workflowSysId) {
        var results = [];
        var gr = new GlideRecord('x_sn_approval_relay_stall');
        gr.addQuery('state', 'open');
        if (workflowSysId) {
            gr.addQuery('approval.sysapproval', workflowSysId);
        }
        gr.orderByDesc('classified_on');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            results.push(this._stallToObject(gr));
        }
        return results;
    },

    getStall: function (stallSysId) {
        var gr = new GlideRecord('x_sn_approval_relay_stall');
        if (!gr.get(stallSysId)) {
            return null;
        }
        return this._stallToObject(gr);
    },

    _stallToObject: function (gr) {
        return {
            sys_id: gr.getUniqueValue(),
            approval: gr.getValue('approval'),
            approval_number: gr.getValue('approval_number'),
            approver: gr.getValue('approver'),
            approver_name: gr.getValue('approver_name'),
            bucket: gr.getValue('bucket'),
            evidence_json: gr.getValue('evidence_json'),
            classified_on: gr.getValue('classified_on'),
            remediated_on: gr.getValue('remediated_on'),
            state: gr.getValue('state')
        };
    },

    type: 'ApprovalRelayEngine'
};
