// WhereUsed Radar — WurReport
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting, remediation, and batch/diff orchestration. Builds the ranked
// impact report, the dependency graph projection, the remediation workbench
// (findings + curated fix catalog), and the batch/update-set assessment.
// Deterministic — no AI dependency. AI fix-suggestion generation is layered
// on top by the optional Now Assist integration and degrades to the curated
// fix catalog when no GenAI Controller is configured.
//
// @class WurReport @namespace x_sn_wur

var WurReport = Class.create();
WurReport.prototype = {

    SCAN_TABLE: 'x_sn_wur_scan',
    REFERENCE_TABLE: 'x_sn_wur_reference',

    // Curated fix catalog for the most common reference-breakage patterns.
    // Maps a matched pattern to a human-readable remediation hint. This is the
    // deterministic fallback when no GenAI Controller is configured.
    FIX_CATALOG: {
        'GlideRecord':        'Update the GlideRecord table name to the new table, or add a compatibility alias if the table was renamed.',
        'new GlideRecord':    'Update the GlideRecord table name to the new table, or add a compatibility alias if the table was renamed.',
        'GlideRecordSecure':  'Update the GlideRecordSecure table name to the new table, or add a compatibility alias if the table was renamed.',
        'gr.get':             'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gr.setValue':        'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gr.addQuery':        'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gr.insert':          'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gr.update':          'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gr.deleteRecord':    'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'current.get':        'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'current.setValue':   'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'current.addQuery':   'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'gs.getProperty':     'Verify the system property still exists; if renamed, update the property key or add a fallback default.',
        'gs.setProperty':     'Verify the system property still exists; if renamed, update the property key or add a fallback default.',
        'g_form.getValue':    'Update the client script to reference the new field name, or restore the field if the removal was unintended.',
        'g_form.setValue':    'Update the client script to reference the new field name, or restore the field if the removal was unintended.',
        'g_form.addOption':   'Update the client script to reference the new field name, or restore the field if the removal was unintended.',
        'g_user.hasRole':     'Verify the role still exists; if renamed, update the role name in the script.',
        'GlideAggregate':     'Update the GlideAggregate table name to the new table, or add a compatibility alias if the table was renamed.',
        'GlideElement':       'Replace the removed field with its successor field, or restore the field if the removal was unintended.',
        'dot_walk':           'Verify the dot-walked field path still resolves; if a segment was renamed, update the path.',
        'dynamic':            'Dynamic reference — the target name is built at runtime. Manually verify the resolved name against the new schema.'
    },

    initialize: function () {
        this._scanner = new WurScanner();
    },

    // ---------------------------------------------------------------------
    // Public: build the ranked impact report for a scan run.
    // Returns { scan, impact, findings: [...] } sorted by risk severity.
    // ---------------------------------------------------------------------
    buildImpactReport: function (scanId) {
        var scan = this._getScan(scanId);
        if (!scan) { return null; }
        var findings = this._getFindings(scanId);
        var impact = this._parseJson(scan.impact_json, null);
        if (!impact) {
            impact = this._scanner.computeImpact(findings);
        }
        // Rank: BREAK first, then WARN, then SAFE; within class, by line.
        findings.sort(function (a, b) {
            var rank = { BREAK: 0, WARN: 1, SAFE: 2 };
            var ra = rank[a.risk_class] !== undefined ? rank[a.risk_class] : 3;
            var rb = rank[b.risk_class] !== undefined ? rank[b.risk_class] : 3;
            if (ra !== rb) { return ra - rb; }
            return (a.line_number || 0) - (b.line_number || 0);
        });
        return {
            scan_id: scanId,
            target_type: scan.target_type,
            target_name: scan.target_name,
            status: scan.status,
            started_at: scan.started_at,
            completed_at: scan.completed_at,
            impact: impact,
            findings: findings
        };
    },

    // ---------------------------------------------------------------------
    // Public: build the remediation workbench — findings joined with the
    // curated fix catalog (or AI-generated fix when available).
    // ---------------------------------------------------------------------
    buildRemediationWorkbench: function (scanId) {
        var report = this.buildImpactReport(scanId);
        if (!report) { return null; }
        var workbench = [];
        for (var i = 0; i < report.findings.length; i++) {
            var f = report.findings[i];
            if (f.risk_class === 'SAFE') { continue; }
            workbench.push({
                source_type: f.source_type,
                source_name: f.source_name,
                source_sys_id: f.source_sys_id,
                line_number: f.line_number,
                risk_class: f.risk_class,
                confidence: f.confidence,
                matched_pattern: f.matched_pattern,
                snippet: f.snippet,
                suggested_fix: this.FIX_CATALOG[f.matched_pattern] || 'Manually review this reference against the new schema.'
            });
        }
        return workbench;
    },

    // ---------------------------------------------------------------------
    // Public: build the dependency graph projection for a scan run.
    // ---------------------------------------------------------------------
    buildDependencyGraph: function (scanId) {
        var findings = this._getFindings(scanId);
        return this._scanner.buildDependencyGraph(findings);
    },

    // ---------------------------------------------------------------------
    // Public: batch assessment — scan a list of objects and return a ranked
    // summary across all of them (for update-set / promotion assessment).
    // ---------------------------------------------------------------------
    assessBatch: function (targets) {
        var results = [];
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var findings = this._scanner.scanTarget(t.target_type, t.target_name);
            var impact = this._scanner.computeImpact(findings);
            results.push({
                target_type: t.target_type,
                target_name: t.target_name,
                impact: impact
            });
        }
        // Rank the batch by descending risk score.
        results.sort(function (a, b) { return b.impact.score - a.impact.score; });
        return results;
    },

    // ---------------------------------------------------------------------
    // Public: cross-instance / cross-update-set diff preview. Compares two
    // sets of impact results and flags objects whose risk increased.
    // ---------------------------------------------------------------------
    diffImpact: function (baseline, candidate) {
        var diff = [];
        var baselineMap = {};
        for (var i = 0; i < baseline.length; i++) {
            var b = baseline[i];
            baselineMap[b.target_type + ':' + b.target_name] = b.impact;
        }
        for (var j = 0; j < candidate.length; j++) {
            var c = candidate[j];
            var key = c.target_type + ':' + c.target_name;
            var before = baselineMap[key];
            var after = c.impact;
            if (!before) {
                diff.push({
                    target_type: c.target_type,
                    target_name: c.target_name,
                    change: 'new',
                    before_score: 0,
                    after_score: after.score,
                    delta: after.score
                });
            } else if (after.score > before.score) {
                diff.push({
                    target_type: c.target_type,
                    target_name: c.target_name,
                    change: 'increased',
                    before_score: before.score,
                    after_score: after.score,
                    delta: after.score - before.score
                });
            }
        }
        diff.sort(function (a, b) { return b.delta - a.delta; });
        return diff;
    },

    // ---------------------------------------------------------------------
    // Public: export a report as Markdown (for change-approval evidence).
    // ---------------------------------------------------------------------
    exportMarkdown: function (scanId) {
        var report = this.buildImpactReport(scanId);
        if (!report) { return null; }
        var lines = [];
        lines.push('# WhereUsed Radar — Impact Report');
        lines.push('');
        lines.push('**Target:** ' + report.target_type + ' `' + report.target_name + '`');
        lines.push('**Risk score:** ' + report.impact.score + '/100 (' + report.impact.verdict + ')');
        lines.push('**Findings:** ' + report.impact.total +
            ' (BREAK ' + report.impact.break_count +
            ', WARN ' + report.impact.warn_count +
            ', SAFE ' + report.impact.safe_count + ')');
        lines.push('');
        lines.push('## Ranked Findings');
        lines.push('');
        lines.push('| # | Risk | Source | Line | Pattern | Snippet |');
        lines.push('|---|------|--------|------|---------|---------|');
        for (var i = 0; i < report.findings.length; i++) {
            var f = report.findings[i];
            var snippet = (f.snippet || '').replace(/\|/g, '\\|');
            lines.push('| ' + (i + 1) + ' | ' + f.risk_class + ' | ' +
                f.source_type + ' `' + f.source_name + '` | ' +
                (f.line_number || '') + ' | ' + f.matched_pattern + ' | ' +
                snippet + ' |');
        }
        lines.push('');
        lines.push('*Generated by WhereUsed Radar (x_sn_wur), AGPL-3.0, Vladimir Kapustin.*');
        return lines.join('\n');
    },

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------
    _getScan: function (scanId) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanId)) { return null; }
        return {
            target_type: gr.getValue('target_type'),
            target_name: gr.getValue('target_name'),
            status: gr.getValue('status'),
            started_at: gr.getValue('started_at'),
            completed_at: gr.getValue('completed_at'),
            impact_json: gr.getValue('impact_json')
        };
    },

    _getFindings: function (scanId) {
        var findings = [];
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.addQuery('scan', scanId);
        gr.query();
        while (gr.next()) {
            findings.push({
                source_type: gr.getValue('source_type'),
                source_name: gr.getValue('source_name'),
                source_sys_id: gr.getValue('source_sys_id'),
                target_type: gr.getValue('target_type'),
                target_name: gr.getValue('target_name'),
                line_number: parseInt(gr.getValue('line_number'), 10) || 0,
                risk_class: gr.getValue('risk_class'),
                confidence: gr.getValue('confidence'),
                matched_pattern: gr.getValue('matched_pattern'),
                snippet: gr.getValue('snippet')
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

    type: 'WurReport'
};
