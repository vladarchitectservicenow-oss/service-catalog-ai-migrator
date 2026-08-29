// BR Medic — BrmReport
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting, remediation workbench, and export. Builds the ranked anti-pattern
// report, the per-script health dashboard, the remediation workbench (findings
// joined with a curated fix catalog), and Markdown/CSV export for change
// approval. Deterministic — no AI dependency. AI fix-suggestion generation is
// layered on top by the optional Now Assist integration and degrades to the
// curated fix catalog when no GenAI Controller is configured.
//
// @class BrmReport @namespace x_brmedic

var BrmReport = Class.create();
BrmReport.prototype = {

    SCAN_TABLE: 'x_brmedic_scan',
    FINDING_TABLE: 'x_brmedic_finding',

    // Curated fix catalog for the five anti-pattern classes. This is the
    // deterministic fallback when no GenAI Controller is configured.
    FIX_CATALOG: {
        n_plus_one: 'Hoist the GlideRecord query out of the loop: collect the keys in the first pass, then issue a single addQuery("sys_id", "IN", keys) query. For aggregates, replace the per-iteration query with a single GlideAggregate grouped by the join key.',
        unindexed_where: 'Add a database index on the filtered field (sys_dictionary -> Indexes), or restructure the query to lead with an indexed field. For composite indexes, ensure the filtered field is the leading column.',
        sync_heavy_op: 'Convert the business rule to async (when = async), or move the expensive work (email, event, aggregate) to a scheduled job / flow that runs off the transaction.',
        recursion: 'Guard the write with a condition that prevents re-triggering (e.g. check a flag field, or use setWorkflow(false) on the current record before update), or move the write to an async rule.',
        missing_gating: 'Add a condition that limits when the rule fires (e.g. changes to a specific field), and gate the expensive body with gs.hasRole() so it only runs for the intended audience.'
    },

    initialize: function () {
        this._scanner = new BrmScanner();
    },

    // ---------------------------------------------------------------------
    // Public: build the ranked anti-pattern report for a scan run.
    // Returns { scan, findings: [...] } sorted by impact score descending.
    // ---------------------------------------------------------------------
    buildReport: function (scanId) {
        var scan = this._getScan(scanId);
        if (!scan) { return null; }
        var findings = this._getFindings(scanId);
        findings.sort(function (a, b) { return b.impact_score - a.impact_score; });
        return {
            scan_id: scanId,
            scan_type: scan.scan_type,
            status: scan.status,
            started_at: scan.started_at,
            completed_at: scan.completed_at,
            findings_count: findings.length,
            critical_count: scan.critical_count,
            high_count: scan.high_count,
            medium_count: scan.medium_count,
            low_count: scan.low_count,
            findings: findings
        };
    },

    // ---------------------------------------------------------------------
    // Public: build the per-script health dashboard (aggregate score per
    // script, sorted by total impact).
    // ---------------------------------------------------------------------
    buildHealthDashboard: function (scanId) {
        var scan = this._getScan(scanId);
        if (!scan) { return null; }
        var health = this._parseJson(scan.health_json, []);
        if (!health || health.length === 0) {
            // Recompute from findings if the JSON column is empty.
            var findings = this._getFindings(scanId);
            health = this._scanner._computeScriptHealth(findings);
        }
        return {
            scan_id: scanId,
            scripts: health
        };
    },

    // ---------------------------------------------------------------------
    // Public: build the remediation workbench — findings joined with the
    // curated fix catalog, with dismiss/acknowledge state.
    // ---------------------------------------------------------------------
    buildWorkbench: function (scanId) {
        var report = this.buildReport(scanId);
        if (!report) { return null; }
        var workbench = [];
        for (var i = 0; i < report.findings.length; i++) {
            var f = report.findings[i];
            workbench.push({
                finding_sys_id: f.sys_id,
                anti_pattern: f.anti_pattern,
                severity: f.severity,
                source_type: f.source_type,
                source_name: f.source_name,
                table_name: f.table_name,
                line_number: f.line_number,
                snippet: f.snippet,
                detail: f.detail,
                impact_score: f.impact_score,
                status: f.status,
                suggested_fix: this.FIX_CATALOG[f.anti_pattern] || 'Manually review this finding against the current script.'
            });
        }
        return workbench;
    },

    // ---------------------------------------------------------------------
    // Public: acknowledge/dismiss a finding (human-in-the-loop remediation).
    // ---------------------------------------------------------------------
    setFindingStatus: function (findingSysId, newStatus) {
        var valid = { open: 1, acknowledged: 1, dismissed: 1, fixed: 1 };
        if (!valid[newStatus]) { return false; }
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (!gr.get(findingSysId)) { return false; }
        gr.setValue('status', newStatus);
        gr.setValue('status_updated_at', new GlideDateTime().getValue());
        gr.setValue('status_updated_by', gs.getUserName());
        gr.setWorkflow(false);
        try {
            gr.update();
            return true;
        } catch (e) {
            gs.error('BrmReport: failed to update finding status: ' + e.message);
            return false;
        }
    },

    // ---------------------------------------------------------------------
    // Public: export the ranked report as Markdown (change-approval evidence).
    // ---------------------------------------------------------------------
    exportMarkdown: function (scanId) {
        var report = this.buildReport(scanId);
        if (!report) { return null; }
        var lines = [];
        lines.push('# BR Medic — Anti-Pattern Report');
        lines.push('');
        lines.push('**Scan:** ' + report.scan_id + ' (' + report.scan_type + ')');
        lines.push('**Status:** ' + report.status);
        lines.push('**Findings:** ' + report.findings_count +
            ' (critical ' + report.critical_count +
            ', high ' + report.high_count +
            ', medium ' + report.medium_count +
            ', low ' + report.low_count + ')');
        lines.push('');
        lines.push('## Ranked Findings');
        lines.push('');
        lines.push('| # | Severity | Anti-Pattern | Source | Table | Line | Score | Snippet |');
        lines.push('|---|----------|--------------|--------|-------|------|-------|---------|');
        for (var i = 0; i < report.findings.length; i++) {
            var f = report.findings[i];
            var snippet = (f.snippet || '').replace(/\|/g, '\\|');
            lines.push('| ' + (i + 1) + ' | ' + f.severity + ' | ' + f.anti_pattern + ' | ' +
                f.source_type + ' `' + f.source_name + '` | ' + (f.table_name || '') + ' | ' +
                (f.line_number || '') + ' | ' + f.impact_score + ' | ' + snippet + ' |');
        }
        lines.push('');
        lines.push('*Generated by BR Medic (x_brmedic), AGPL-3.0, Vladimir Kapustin.*');
        return lines.join('\n');
    },

    // ---------------------------------------------------------------------
    // Public: export the ranked report as CSV.
    // ---------------------------------------------------------------------
    exportCsv: function (scanId) {
        var report = this.buildReport(scanId);
        if (!report) { return null; }
        var rows = ['severity,anti_pattern,source_type,source_name,table_name,line_number,impact_score,status,snippet'];
        for (var i = 0; i < report.findings.length; i++) {
            var f = report.findings[i];
            rows.push([
                this._csvCell(f.severity),
                this._csvCell(f.anti_pattern),
                this._csvCell(f.source_type),
                this._csvCell(f.source_name),
                this._csvCell(f.table_name),
                f.line_number || '',
                f.impact_score,
                this._csvCell(f.status),
                this._csvCell(f.snippet)
            ].join(','));
        }
        return rows.join('\n');
    },

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------
    _getScan: function (scanId) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanId)) { return null; }
        return {
            scan_type: gr.getValue('scan_type'),
            status: gr.getValue('status'),
            started_at: gr.getValue('started_at'),
            completed_at: gr.getValue('completed_at'),
            critical_count: parseInt(gr.getValue('critical_count'), 10) || 0,
            high_count: parseInt(gr.getValue('high_count'), 10) || 0,
            medium_count: parseInt(gr.getValue('medium_count'), 10) || 0,
            low_count: parseInt(gr.getValue('low_count'), 10) || 0,
            health_json: gr.getValue('health_json')
        };
    },

    _getFindings: function (scanId) {
        var findings = [];
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('scan', scanId);
        gr.query();
        while (gr.next()) {
            findings.push({
                sys_id: gr.getUniqueValue(),
                anti_pattern: gr.getValue('anti_pattern'),
                severity: gr.getValue('severity'),
                source_type: gr.getValue('source_type'),
                source_name: gr.getValue('source_name'),
                source_sys_id: gr.getValue('source_sys_id'),
                table_name: gr.getValue('table_name'),
                line_number: parseInt(gr.getValue('line_number'), 10) || 0,
                snippet: gr.getValue('snippet'),
                detail: gr.getValue('detail'),
                impact_score: parseInt(gr.getValue('impact_score'), 10) || 0,
                status: gr.getValue('status')
            });
        }
        return findings;
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

    // ---------------------------------------------------------------------
    // CSV cell escaping: quote the value, escape embedded double-quotes, and
    // neutralize spreadsheet formula injection (cells beginning with =, +, -,
    // or @ are prefixed with a single quote).
    // ---------------------------------------------------------------------
    _csvCell: function (value) {
        var s = (value == null) ? '' : String(value);
        s = s.replace(/"/g, '""');
        if (/^[=+\-@]/.test(s)) {
            s = "'" + s;
        }
        return '"' + s + '"';
    },

    type: 'BrmReport'
};
