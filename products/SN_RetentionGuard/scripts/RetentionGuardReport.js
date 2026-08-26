// RetentionGuard — RetentionGuardReport
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting, forecasting, and legal-hold management for RetentionGuard.
// Produces the per-run compliance audit report (policy-to-action traceability),
// growth/cost projections, and manages legal-hold records. Pure deterministic
// logic — no AI dependency.
//
// @class RetentionGuardReport @namespace x_snc_retention_guard

var RetentionGuardReport = Class.create();
RetentionGuardReport.prototype = {

    POLICY_TABLE: 'x_snc_retention_guard_policy',
    RUN_TABLE: 'x_snc_retention_guard_run',

    // Estimated bytes-per-row by table class, used for storage cost projection.
    ROW_SIZE_ESTIMATE: {
        'sys_audit': 512,
        'syslog': 256,
        'sys_email': 2048,
        'sys_attachment': 4096,
        'sys_journal_field': 1024
    },
    DEFAULT_ROW_SIZE: 512,

    // Cost per GB per month (USD) — conservative platform storage estimate.
    COST_PER_GB_MONTH: 0.25,

    initialize: function () {},

    /**
     * Build a compliance audit report for a run. Returns a structured object
     * with policy-to-action traceability: every table action is linked back to
     * its policy and framework. Exportable as JSON/HTML/PDF by the caller.
     */
    buildAuditReport: function (runId) {
        var run = this._getRun(runId);
        if (!run) { return null; }

        var results = this._parseJson(run.detail_json, []);
        var report = {
            report_id: runId,
            generated_at: new GlideDateTime().getValue(),
            run_started_at: run.started_at,
            run_completed_at: run.completed_at,
            dry_run: run.status === 'dry_run',
            totals: {
                rows_processed: parseInt(run.rows_processed, 10) || 0,
                rows_skipped: parseInt(run.rows_skipped, 10) || 0
            },
            actions: []
        };

        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var policy = this._getPolicyForTable(r.table_name);
            report.actions.push({
                table_name: r.table_name,
                action: r.action,
                framework: policy ? policy.framework : 'custom',
                retention_days: policy ? policy.retention_days : null,
                status: r.status,
                reason: r.reason || null,
                rows_processed: r.rows_processed || 0,
                rows_skipped: r.rows_skipped || 0,
                rows_failed: r.rows_failed || 0,
                cutoff: r.cutoff || null
            });
        }

        return report;
    },

    /**
     * Generate a plain-language compliance statement summarizing the report.
     * Deterministic template — no LLM required (AI narrative is optional and
     * layered on top by the caller when a GenAI Controller is configured).
     */
    buildComplianceStatement: function (report) {
        if (!report) { return 'No report available.'; }
        var held = 0;
        var purged = 0;
        var archived = 0;
        for (var i = 0; i < report.actions.length; i++) {
            var a = report.actions[i];
            if (a.status === 'blocked') { held++; }
            else if (a.action === 'purge') { purged++; }
            else if (a.action === 'archive') { archived++; }
        }
        var mode = report.dry_run ? 'dry-run (no data was modified)' : 'live execution';
        return 'RetentionGuard ' + mode + ' processed ' + report.totals.rows_processed +
            ' records across ' + report.actions.length + ' tables (' + purged +
            ' purge, ' + archived + ' archive, ' + held + ' legal-hold blocked). ' +
            report.totals.rows_skipped + ' records were skipped for referential integrity.';
    },

    /**
     * Growth forecast: extrapolate current row counts into projected storage
     * cost over 12/24/36 months. Returns a projection object with per-table
     * and aggregate cost figures.
     */
    forecastGrowth: function (inventory) {
        var projection = {
            generated_at: new GlideDateTime().getValue(),
            tables: [],
            totals: { rows_now: 0, gb_now: 0, cost_12m: 0, cost_24m: 0, cost_36m: 0 }
        };

        for (var i = 0; i < inventory.length; i++) {
            var item = inventory[i];
            var rowSize = this.ROW_SIZE_ESTIMATE[item.table_name] || this.DEFAULT_ROW_SIZE;
            var gbNow = (item.rows * rowSize) / (1024 * 1024 * 1024);
            var growthRate = this._growthRate(item.table_name, item.rows);

            var tableProj = {
                table_name: item.table_name,
                rows_now: item.rows,
                gb_now: this._round(gbNow, 3),
                growth_rate_pct: this._round(growthRate, 2),
                cost_12m: this._round(gbNow * (1 + growthRate) * 12 * this.COST_PER_GB_MONTH, 2),
                cost_24m: this._round(gbNow * (1 + growthRate * 2) * 24 * this.COST_PER_GB_MONTH, 2),
                cost_36m: this._round(gbNow * (1 + growthRate * 3) * 36 * this.COST_PER_GB_MONTH, 2)
            };
            projection.tables.push(tableProj);

            projection.totals.rows_now += item.rows;
            projection.totals.gb_now += gbNow;
            projection.totals.cost_12m += tableProj.cost_12m;
            projection.totals.cost_24m += tableProj.cost_24m;
            projection.totals.cost_36m += tableProj.cost_36m;
        }

        projection.totals.gb_now = this._round(projection.totals.gb_now, 3);
        projection.totals.cost_12m = this._round(projection.totals.cost_12m, 2);
        projection.totals.cost_24m = this._round(projection.totals.cost_24m, 2);
        projection.totals.cost_36m = this._round(projection.totals.cost_36m, 2);
        return projection;
    },

    /**
     * Compute growth rate by comparing the latest two growth snapshots for a
     * table. Returns a fractional rate (0.0 = no growth). Falls back to 0 when
     * insufficient snapshot history exists.
     */
    _growthRate: function (tableName, currentRows) {
        var gr = new GlideRecord(this.RUN_TABLE);
        gr.addQuery('type', 'growth');
        gr.addQuery('table_name', tableName);
        gr.orderByDesc('started_at');
        gr.setLimit(2);
        gr.query();

        var snapshots = [];
        while (gr.next()) {
            snapshots.push(parseInt(gr.getValue('rows_before'), 10) || 0);
        }
        if (snapshots.length < 2) { return 0; }
        var older = snapshots[1];
        var newer = snapshots[0];
        if (older <= 0) { return 0; }
        return (newer - older) / older;
    },

    /**
     * Policy drift detection: flag tables whose growth rate exceeds what their
     * retention schedule can absorb. Returns an array of drift warnings.
     */
    detectDrift: function (inventory) {
        var warnings = [];
        for (var i = 0; i < inventory.length; i++) {
            var item = inventory[i];
            var policy = this._getPolicyForTable(item.table_name);
            if (!policy) { continue; }
            var growthRate = this._growthRate(item.table_name, item.rows);
            // A table growing faster than ~5% per cycle is drifting.
            if (growthRate > 0.05) {
                warnings.push({
                    table_name: item.table_name,
                    growth_rate_pct: this._round(growthRate * 100, 2),
                    retention_days: policy.retention_days,
                    severity: growthRate > 0.15 ? 'high' : 'medium'
                });
            }
        }
        return warnings;
    },

    /**
     * Legal-hold management. Holds are stored as JSON on the policy record.
     * addHold / removeHold mutate the holds_json array idempotently.
     */
    addHold: function (tableName, reason, heldBy) {
        var policy = this._getPolicyRecord(tableName);
        if (!policy) { return false; }
        var holds = this._parseJson(policy.getValue('holds_json'), []);
        for (var i = 0; i < holds.length; i++) {
            if (holds[i].table_name === tableName && holds[i].active !== false) {
                return true; // already held
            }
        }
        holds.push({
            table_name: tableName,
            reason: reason || '',
            held_by: heldBy || '',
            held_at: new GlideDateTime().getValue(),
            active: true
        });
        policy.setValue('holds_json', JSON.stringify(holds));
        policy.setWorkflow(false);
        policy.update();
        return true;
    },

    removeHold: function (tableName) {
        var policy = this._getPolicyRecord(tableName);
        if (!policy) { return false; }
        var holds = this._parseJson(policy.getValue('holds_json'), []);
        var changed = false;
        for (var i = 0; i < holds.length; i++) {
            if (holds[i].table_name === tableName && holds[i].active !== false) {
                holds[i].active = false;
                holds[i].released_at = new GlideDateTime().getValue();
                changed = true;
            }
        }
        if (changed) {
            policy.setValue('holds_json', JSON.stringify(holds));
            policy.setWorkflow(false);
            policy.update();
        }
        return changed;
    },

    listHolds: function () {
        var result = [];
        var gr = new GlideRecord(this.POLICY_TABLE);
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            var holds = this._parseJson(gr.getValue('holds_json'), []);
            for (var i = 0; i < holds.length; i++) {
                if (holds[i].active !== false) {
                    result.push({
                        table_name: gr.getValue('table_name'),
                        reason: holds[i].reason,
                        held_by: holds[i].held_by,
                        held_at: holds[i].held_at
                    });
                }
            }
        }
        return result;
    },

    _getRun: function (runId) {
        var gr = new GlideRecord(this.RUN_TABLE);
        if (!gr.get(runId)) { return null; }
        return {
            status: gr.getValue('status'),
            started_at: gr.getValue('started_at'),
            completed_at: gr.getValue('completed_at'),
            rows_processed: gr.getValue('rows_processed'),
            rows_skipped: gr.getValue('rows_skipped'),
            detail_json: gr.getValue('detail_json')
        };
    },

    _getPolicyForTable: function (tableName) {
        var gr = new GlideRecord(this.POLICY_TABLE);
        gr.addQuery('table_name', tableName);
        gr.addQuery('active', true);
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) { return null; }
        return {
            framework: gr.getValue('framework'),
            retention_days: parseInt(gr.getValue('retention_days'), 10) || 0
        };
    },

    _getPolicyRecord: function (tableName) {
        var gr = new GlideRecord(this.POLICY_TABLE);
        gr.addQuery('table_name', tableName);
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) { return null; }
        return gr;
    },

    _parseJson: function (raw, fallback) {
        if (!raw) { return fallback; }
        try {
            var parsed = JSON.parse(raw);
            return parsed || fallback;
        } catch (e) {
            return fallback;
        }
    },

    _round: function (value, decimals) {
        var factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    },

    type: 'RetentionGuardReport'
};
