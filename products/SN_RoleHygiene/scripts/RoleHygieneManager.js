// RoleHygiene — RoleHygieneManager
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Orchestration and persistence layer. Runs the deterministic engine, persists
// findings to the scoped finding table, captures entitlement snapshots, and
// generates the compliance-ready report. This is the only Script Include with
// write access to scoped tables.
//
// @class RoleHygieneManager @namespace x_snc_role_hygiene
var RoleHygieneManager = Class.create();
RoleHygieneManager.prototype = {

    initialize: function () {
        this.FINDING_TABLE = 'x_snc_role_hygiene_finding';
        this.CONFIG_TABLE = 'x_snc_role_hygiene_config';
        this.engine = new RoleHygieneEngine();
    },

    /**
     * Run a full audit pass: dormancy, creep, and SoD in one sweep. Persists
     * findings and returns a summary object for the caller (REST endpoint or
     * scheduled job).
     *
     * @param {object} [opts] - optional overrides { threshold_days, clear_previous }
     * @returns {object} { run_sys_id, dormant, creep, sod, findings_created }
     */
    runFullAudit: function (opts) {
        opts = opts || {};
        var thresholdDays = opts.threshold_days || this._getSetting('dormancy_threshold_days', 90);
        var sodRules = this._getSodRules();
        var entitlements = this._getEntitlements();

        var runId = this._createRunRecord('full');

        var dormant = this.engine.detectDormantAccounts(thresholdDays);
        var priorSnapshot = this._getPriorSnapshot();
        var creep = this.engine.analyzeCreep(entitlements, priorSnapshot);
        var sod = this.engine.findSodConflicts(sodRules, entitlements);

        // Persist findings.
        var created = 0;
        if (opts.clear_previous) {
            this._clearFindings();
        }
        created += this._persistFindings('dormant', dormant, runId);
        created += this._persistFindings('creep', creep, runId);
        created += this._persistFindings('sod', sod, runId);

        // Store current entitlements as the new baseline snapshot.
        this._storeSnapshot(entitlements, runId);

        return {
            run_sys_id: runId,
            dormant: dormant.length,
            creep: creep.length,
            sod: sod.length,
            findings_created: created
        };
    },

    /**
     * Produce a compliance-ready report: every finding with timestamped evidence,
     * the rule that fired, and drift score.
     *
     * @param {string} [runSysId] - filter to a specific run, or null for latest
     * @returns {Array} list of report rows
     */
    generateReport: function (runSysId) {
        var rows = [];
        var gr = new GlideRecord(this.FINDING_TABLE);
        // Only real findings (dormant/creep/sod) belong in a compliance report;
        // internal run/snapshot/remediation bookkeeping rows are excluded.
        gr.addQuery('type', 'IN', 'dormant,creep,sod');
        if (runSysId) {
            gr.addQuery('run', runSysId);
        }
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1000);
        gr.query();

        while (gr.next()) {
            rows.push({
                finding_sys_id: gr.getUniqueValue(),
                type: gr.getValue('type'),
                user_sys_id: gr.getValue('user'),
                user_name: gr.getValue('user_name'),
                evidence: gr.getValue('evidence'),
                rule_fired: gr.getValue('rule_fired'),
                drift_score: gr.getValue('drift_score'),
                detected_on: gr.getValue('sys_created_on')
            });
        }

        return rows;
    },

    /**
     * Create a human-approval remediation task. Never silently fixes security
     * state — always routes through the approval-gated workflow.
     *
     * @param {object} req - { finding_sys_id, action: 'deactivate'|'remove_role'|'sod_exception', justification }
     * @returns {object} { task_sys_id, status }
     */
    createRemediationTask: function (req) {
        if (!req || !req.finding_sys_id || !req.action) {
            return { task_sys_id: '', status: 'rejected', reason: 'missing_required_fields' };
        }
        var allowed = ['deactivate', 'remove_role', 'sod_exception'];
        if (allowed.indexOf(req.action) === -1) {
            return { task_sys_id: '', status: 'rejected', reason: 'invalid_action' };
        }

        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('type', 'remediation');
        gr.addQuery('finding_ref', req.finding_sys_id);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return { task_sys_id: gr.getUniqueValue(), status: 'exists' };
        }

        var task = new GlideRecord(this.FINDING_TABLE);
        task.initialize();
        task.setValue('type', 'remediation');
        task.setValue('finding_ref', req.finding_sys_id);
        task.setValue('rule_fired', 'remediation:' + req.action);
        task.setValue('evidence', req.justification || '');
        task.setValue('state', 'pending_approval');
        try {
            var sysId = task.insert();
            return { task_sys_id: sysId, status: 'created' };
        } catch (e) {
            return { task_sys_id: '', status: 'error', reason: String(e) };
        }
    },

    // ---- persistence helpers ---------------------------------------------

    _persistFindings: function (type, list, runId) {
        var created = 0;
        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            var stats = {
                dormant: (type === 'dormant' ? 1 : 0),
                creep_added: (type === 'creep' ? f.added_roles.length : 0),
                sod_violations: (type === 'sod' ? f.violated_pairs.length : 0)
            };
            var gr = new GlideRecord(this.FINDING_TABLE);
            gr.initialize();
            gr.setValue('type', type);
            gr.setValue('run', runId);
            gr.setValue('user', f.user_sys_id || '');
            gr.setValue('user_name', f.user_name || '');
            gr.setValue('risk_class', f.risk_class || '');
            gr.setValue('drift_score', this.engine.scoreDrift(stats));

            if (type === 'creep') {
                gr.setValue('rule_fired', 'privilege_creep');
                gr.setValue('evidence', JSON.stringify({
                    added_roles: f.added_roles,
                    department: f.department,
                    outlier: f.outlier
                }));
            } else if (type === 'sod') {
                gr.setValue('rule_fired', 'sod_conflict');
                gr.setValue('evidence', JSON.stringify({
                    violated_pairs: f.violated_pairs,
                    blast_radius: f.blast_radius
                }));
            } else {
                gr.setValue('rule_fired', 'dormant_account');
                gr.setValue('evidence', JSON.stringify({
                    days_inactive: f.days_inactive,
                    last_login: f.last_login,
                    open_ticket_count: f.open_ticket_count
                }));
            }

            try {
                gr.insert();
                created++;
            } catch (e) {
                // Log and continue — a single failed insert must not abort the run.
                gs.error('RoleHygiene: failed to persist ' + type + ' finding for ' + (f.user_sys_id || '') + ': ' + e);
            }
        }
        return created;
    },

    _storeSnapshot: function (entitlements, runId) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.initialize();
        gr.setValue('type', 'snapshot');
        gr.setValue('run', runId);
        gr.setValue('rule_fired', 'entitlement_snapshot');
        gr.setValue('evidence', JSON.stringify(entitlements));
        try {
            gr.insert();
        } catch (e) {
            gs.error('RoleHygiene: failed to store snapshot: ' + e);
        }
    },

    _getPriorSnapshot: function () {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('type', 'snapshot');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            try {
                return JSON.parse(gr.getValue('evidence'));
            } catch (e) {
                return [];
            }
        }
        return [];
    },

    _getEntitlements: function () {
        var out = [];
        var gr = new GlideRecord('sys_user_has_role');
        gr.query();
        while (gr.next()) {
            out.push({
                user_sys_id: gr.getValue('user') || '',
                role_sys_id: gr.getValue('role') || '',
                role_name: gr.getDisplayValue('role') || '',
                user_name: gr.getDisplayValue('user') || '',
                department: gr.getDisplayValue('user.department') || ''
            });
        }
        return out;
    },

    _getSodRules: function () {
        var rules = [];
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.addQuery('type', 'sod_rule');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            rules.push({
                name: gr.getValue('name') || '',
                role_a_sys_id: gr.getValue('role_a') || '',
                role_b_sys_id: gr.getValue('role_b') || '',
                description: gr.getValue('description') || ''
            });
        }
        return rules;
    },

    _getSetting: function (name, defaultValue) {
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.addQuery('type', 'setting');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var v = gr.getValue('value');
            if (v) {
                var n = parseInt(v, 10);
                return isNaN(n) ? defaultValue : n;
            }
        }
        return defaultValue;
    },

    _createRunRecord: function (mode) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.initialize();
        gr.setValue('type', 'run');
        gr.setValue('rule_fired', 'audit_run');
        gr.setValue('evidence', JSON.stringify({ mode: mode, triggered_by: gs.getUserName() }));
        try {
            return gr.insert();
        } catch (e) {
            gs.error('RoleHygiene: failed to create run record: ' + e);
            return '';
        }
    },

    _clearFindings: function () {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('type', 'IN', 'dormant,creep,sod');
        gr.query();
        while (gr.next()) {
            gr.deleteRecord();
        }
    },

    type: 'RoleHygieneManager'
};
