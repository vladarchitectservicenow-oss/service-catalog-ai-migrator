// SN Assignment Rule Auditor — AssignmentRuleHelper
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Helper: AI explainability, baseline management, simulation history,
// session persistence, and data export utilities.
// @class AssignmentRuleHelper @namespace sn_assignment_rule_auditor

var AssignmentRuleHelper = Class.create();
AssignmentRuleHelper.prototype = {
    initialize: function() {
        this.engine = new AssignmentRuleEngine();
    },

    /**
     * Generate a natural-language explanation for a conflict using GenAI Controller.
     * Falls back to a deterministic template if GenAI is unavailable.
     * @param {string} conflictSysId — sys_id of the conflict scan result
     * @returns {string} explanation text
     */
    explainConflict: function(conflictSysId) {
        var gr = new GlideRecord('x_sn_ara_scan_result');
        if (!gr.get(conflictSysId) || gr.getValue('type') !== 'conflict') {
            return 'Conflict not found.';
        }

        var detail = JSON.parse(gr.getValue('detail_json') || '{}');
        var explanation = this._buildConflictExplanation(detail);

        // Attempt GenAI Controller enrichment
        try {
            var genAiPrompt = this._buildGenAiPrompt(detail);
            var genAiResult = sn_im.GlideGenAI.generate(genAiPrompt, { max_tokens: 500 });
            if (genAiResult && genAiResult !== '') {
                explanation = genAiResult;
            }
        } catch (e) {
            gs.warn('AssignmentRuleHelper: GenAI unavailable, using template explanation: ' + e.message);
        }

        // Save explanation back to the record
        try {
            gr.setValue('explanation', explanation);
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.warn('AssignmentRuleHelper: failed to save explanation: ' + e.message);
        }

        return explanation;
    },

    /**
     * Generate a health summary for a table or all tables.
     * @param {string} [tableName] — optional, null for all tables
     * @returns {object} health summary
     */
    getHealthSummary: function(tableName) {
        var gr = new GlideRecord('x_sn_ara_scan_result');
        gr.addQuery('type', 'health_snapshot');
        if (tableName) gr.addQuery('table_name', tableName);
        gr.addQuery('active', true);
        gr.orderByDesc('scanned_at');
        gr.setLimit(1);
        gr.query();

        if (!gr.next()) {
            return { error: 'No scan data available. Run a scan first.', tables: [] };
        }

        var latestRunId = gr.getValue('scan_run_id');
        var tables = [];

        var tblGr = new GlideRecord('x_sn_ara_scan_result');
        tblGr.addQuery('type', 'health_snapshot');
        tblGr.addQuery('scan_run_id', latestRunId);
        tblGr.addQuery('active', true);
        tblGr.query();
        while (tblGr.next()) {
            var detail = JSON.parse(tblGr.getValue('detail_json') || '{}');
            tables.push({
                table_name: tblGr.getValue('table_name'),
                health_score: tblGr.getValue('score') || 0,
                conflicts: detail.total_conflicts || 0,
                dead_rules: detail.total_dead_rules || 0,
                stale_conditions: detail.total_stale_conditions || 0,
                scanned_at: tblGr.getValue('scanned_at')
            });
        }

        return {
            scan_run_id: latestRunId,
            scanned_at: gr.getValue('scanned_at'),
            tables: tables,
            overall_health: tables.length > 0
                ? Math.round(tables.reduce(function(sum, t) { return sum + t.health_score; }, 0) / tables.length)
                : 0
        };
    },

    /**
     * Get conflicts for a table from the latest scan.
     * @param {string} tableName
     * @returns {Array} conflict objects
     */
    getConflicts: function(tableName) {
        return this._getResultsByType(tableName, 'conflict');
    },

    /**
     * Get dead rules for a table from the latest scan.
     * @param {string} tableName
     * @returns {Array} dead rule objects
     */
    getDeadRules: function(tableName) {
        return this._getResultsByType(tableName, 'dead_rule');
    },

    /**
     * Get stale conditions for a table from the latest scan.
     * @param {string} tableName
     * @returns {Array} stale condition objects
     */
    getStaleConditions: function(tableName) {
        return this._getResultsByType(tableName, 'stale_condition');
    },

    // ─── Baseline Management ─────────────────────────────────────────

    /**
     * Create a baseline snapshot of current routing health.
     * @param {string} name — baseline name
     * @param {string} [createdBy] — user sys_id
     * @returns {string} baseline sys_id
     */
    createBaseline: function(name, createdBy) {
        var summary = this.getHealthSummary(null);
        try {
            var gr = new GlideRecord('x_sn_ara_session');
            gr.initialize();
            gr.setValue('type', 'baseline');
            gr.setValue('name', name);
            gr.setValue('status', 'active');
            gr.setValue('data_json', JSON.stringify(summary));
            gr.setValue('summary_json', JSON.stringify({
                overall_health: summary.overall_health,
                table_count: summary.tables.length,
                total_conflicts: summary.tables.reduce(function(s, t) { return s + t.conflicts; }, 0),
                total_dead_rules: summary.tables.reduce(function(s, t) { return s + t.dead_rules; }, 0),
                total_stale_conditions: summary.tables.reduce(function(s, t) { return s + t.stale_conditions; }, 0)
            }));
            gr.setValue('created_by', createdBy || gs.getUserID());
            gr.setValue('created_at', new GlideDateTime().getValue());
            gr.setValue('active', true);
            return gr.insert();
        } catch (e) {
            gs.error('AssignmentRuleHelper: failed to create baseline: ' + e.message);
            return null;
        }
    },

    /**
     * Compare current health against a baseline and detect drift.
     * @param {string} baselineSysId
     * @returns {object} drift report
     */
    compareBaseline: function(baselineSysId) {
        var baselineGr = new GlideRecord('x_sn_ara_session');
        if (!baselineGr.get(baselineSysId) || baselineGr.getValue('type') !== 'baseline') {
            return { error: 'Baseline not found.' };
        }

        var baselineData = JSON.parse(baselineGr.getValue('data_json') || '{}');
        var currentData = this.getHealthSummary(null);

        var drift = {
            baseline_name: baselineGr.getValue('name'),
            baseline_date: baselineGr.getValue('created_at'),
            baseline_health: baselineData.overall_health || 0,
            current_health: currentData.overall_health,
            health_delta: currentData.overall_health - (baselineData.overall_health || 0),
            new_tables: [],
            removed_tables: [],
            table_drifts: []
        };

        var baselineTables = {};
        (baselineData.tables || []).forEach(function(t) { baselineTables[t.table_name] = t; });
        var currentTables = {};
        (currentData.tables || []).forEach(function(t) { currentTables[t.table_name] = t; });

        for (var tbl in currentTables) {
            if (!currentTables.hasOwnProperty(tbl)) continue;
            if (!baselineTables[tbl]) {
                drift.new_tables.push(tbl);
            } else {
                var delta = currentTables[tbl].health_score - baselineTables[tbl].health_score;
                if (Math.abs(delta) > 0) {
                    drift.table_drifts.push({
                        table_name: tbl,
                        baseline_score: baselineTables[tbl].health_score,
                        current_score: currentTables[tbl].health_score,
                        delta: delta
                    });
                }
            }
        }
        for (var bt in baselineTables) {
            if (!baselineTables.hasOwnProperty(bt)) continue;
            if (!currentTables[bt]) drift.removed_tables.push(bt);
        }

        return drift;
    },

    // ─── Simulation History ──────────────────────────────────────────

    /**
     * Save a simulation scenario for regression testing.
     * @param {string} tableName
     * @param {object} fieldValues
     * @param {object} result — from engine.simulate()
     * @param {string} [name] — scenario name
     * @returns {string} session sys_id
     */
    saveSimulation: function(tableName, fieldValues, result, name) {
        try {
            var gr = new GlideRecord('x_sn_ara_session');
            gr.initialize();
            gr.setValue('type', 'simulation');
            gr.setValue('table_name', tableName);
            gr.setValue('name', name || 'Simulation ' + new GlideDateTime().getValue());
            gr.setValue('status', 'completed');
            gr.setValue('data_json', JSON.stringify({ input: fieldValues, result: result }));
            gr.setValue('summary_json', JSON.stringify({
                winning_rule: result.winning_rule ? result.winning_rule.name : 'none',
                assigned_group: result.assigned_group,
                matched_count: result.matched_rules.length
            }));
            gr.setValue('created_by', gs.getUserID());
            gr.setValue('created_at', new GlideDateTime().getValue());
            gr.setValue('active', true);
            return gr.insert();
        } catch (e) {
            gs.error('AssignmentRuleHelper: failed to save simulation: ' + e.message);
            return null;
        }
    },

    /**
     * Get simulation history for a table.
     * @param {string} [tableName] — optional, null for all
     * @param {number} [limit] — default 20
     * @returns {Array} simulation records
     */
    getSimulationHistory: function(tableName, limit) {
        var results = [];
        var gr = new GlideRecord('x_sn_ara_session');
        gr.addQuery('type', 'simulation');
        if (tableName) gr.addQuery('table_name', tableName);
        gr.addQuery('active', true);
        gr.orderByDesc('created_at');
        gr.setLimit(limit || 20);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                table_name: gr.getValue('table_name'),
                summary: JSON.parse(gr.getValue('summary_json') || '{}'),
                created_at: gr.getValue('created_at')
            });
        }
        return results;
    },

    /**
     * Get baseline history.
     * @param {number} [limit] — default 20
     * @returns {Array} baseline records
     */
    getBaselines: function(limit) {
        var results = [];
        var gr = new GlideRecord('x_sn_ara_session');
        gr.addQuery('type', 'baseline');
        gr.addQuery('active', true);
        gr.orderByDesc('created_at');
        gr.setLimit(limit || 20);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                type: gr.getValue('type'),
                status: gr.getValue('status'),
                summary: JSON.parse(gr.getValue('summary_json') || '{}'),
                created_by: gr.getValue('created_by'),
                created_at: gr.getValue('created_at')
            });
        }
        return results;
    },

    // ─── Cleanup ─────────────────────────────────────────────────────

    /**
     * Purge scan results older than the specified days.
     * @param {number} daysToKeep — default 90
     * @returns {number} count of deleted records
     */
    purgeOldResults: function(daysToKeep) {
        var cutoff = new GlideDateTime();
        cutoff.addDays(-(daysToKeep || 90));

        var count = 0;
        var gr = new GlideRecord('x_sn_ara_scan_result');
        gr.addQuery('scanned_at', '<', cutoff.getValue());
        gr.query();
        while (gr.next()) {
            try {
                gr.setWorkflow(false);
                gr.deleteRecord();
                count++;
            } catch (e) {
                gs.warn('AssignmentRuleHelper: failed to delete scan result ' + gr.getUniqueValue() + ': ' + e.message);
            }
        }
        return count;
    },

    // ─── Private Helpers ─────────────────────────────────────────────

    _getResultsByType: function(tableName, type) {
        var results = [];
        var latestRunId = this._getLatestRunId();
        if (!latestRunId) return results;

        var gr = new GlideRecord('x_sn_ara_scan_result');
        gr.addQuery('type', type);
        gr.addQuery('table_name', tableName);
        gr.addQuery('scan_run_id', latestRunId);
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                detail: JSON.parse(gr.getValue('detail_json') || '{}'),
                severity: gr.getValue('severity'),
                explanation: gr.getValue('explanation') || '',
                scanned_at: gr.getValue('scanned_at')
            });
        }
        return results;
    },

    _getLatestRunId: function() {
        var gr = new GlideRecord('x_sn_ara_scan_result');
        gr.addQuery('type', 'health_snapshot');
        gr.addQuery('active', true);
        gr.orderByDesc('scanned_at');
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr.getValue('scan_run_id') : null;
    },

    _buildConflictExplanation: function(detail) {
        var parts = [];
        parts.push('Conflict detected between "' + (detail.rule_a_name || 'Unknown') + '"');
        parts.push('(order ' + (detail.rule_a_order || '?') + ', routes to ' + (detail.rule_a_group || 'unknown') + ')');
        parts.push('and "' + (detail.rule_b_name || 'Unknown') + '"');
        parts.push('(order ' + (detail.rule_b_order || '?') + ', routes to ' + (detail.rule_b_group || 'unknown') + ').');
        parts.push('Overlapping conditions: ' + (detail.overlapping_conditions || 'none') + '.');
        parts.push('Severity: ' + (detail.severity || 'unknown') + '.');
        if (detail.winning_rule) {
            parts.push('The winning rule is ' + detail.winning_rule + ' (higher priority).');
        }
        return parts.join(' ');
    },

    _buildGenAiPrompt: function(detail) {
        return 'Explain this ServiceNow assignment rule conflict in plain English for an ITSM administrator. ' +
               'Rule A: "' + (detail.rule_a_name || 'Unknown') + '" (order ' + (detail.rule_a_order || '?') +
               ', routes to ' + (detail.rule_a_group || 'unknown') + '). ' +
               'Rule B: "' + (detail.rule_b_name || 'Unknown') + '" (order ' + (detail.rule_b_order || '?') +
               ', routes to ' + (detail.rule_b_group || 'unknown') + '). ' +
               'Overlapping conditions: ' + (detail.overlapping_conditions || 'none') + '. ' +
               'Explain which rule wins, why, and the business impact. Keep it under 200 words.';
    },

    type: 'AssignmentRuleHelper'
};
