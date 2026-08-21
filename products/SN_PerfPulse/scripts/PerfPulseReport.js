// PerfPulse — PerfPulseReport
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting engine for PerfPulse. Produces Markdown/JSON/CSV reports from
// scan findings and per-component performance scores. Also generates
// plain-language remediation narratives (deterministic templates — no LLM
// dependency).
// @class PerfPulseReport @namespace x_vkap_perf_pulse

var PerfPulseReport = Class.create();
PerfPulseReport.prototype = {

    initialize: function () {
        this._findingTable = 'x_vkap_perf_pulse_finding';
        this._scanTable = 'x_vkap_perf_pulse_scan';
    },

    /**
     * Build a full report for a scan in the requested format.
     * @param {string} scanId - scan sys_id
     * @param {string} format - 'markdown' | 'json' | 'csv'
     * @return {string} report body
     */
    buildReport: function (scanId, format) {
        var scan = this._getScan(scanId);
        var findings = this._getFindings(scanId);
        var scores = this._parseScores(scan.scores_json);
        if (format === 'json') {
            return JSON.stringify({
                scan: scan,
                findings: findings,
                scores: scores
            });
        }
        if (format === 'csv') {
            return this._toCsv(findings);
        }
        return this._toMarkdown(scan, findings, scores);
    },

    /**
     * Fetch a scan record as a plain object.
     * @param {string} scanId - scan sys_id
     * @return {Object} scan record
     */
    _getScan: function (scanId) {
        var gr = new GlideRecord(this._scanTable);
        if (!gr.get(scanId)) {
            return {};
        }
        return {
            sys_id: gr.getUniqueValue(),
            type: gr.getValue('type'),
            source_env: gr.getValue('source_env'),
            status: gr.getValue('status'),
            started_at: gr.getValue('started_at'),
            completed_at: gr.getValue('completed_at'),
            business_rule_count: parseInt(gr.getValue('business_rule_count') || '0', 10),
            slow_query_count: parseInt(gr.getValue('slow_query_count') || '0', 10),
            n_plus_one_count: parseInt(gr.getValue('n_plus_one_count') || '0', 10),
            client_script_count: parseInt(gr.getValue('client_script_count') || '0', 10),
            acl_cost_count: parseInt(gr.getValue('acl_cost_count') || '0', 10),
            transaction_count: parseInt(gr.getValue('transaction_count') || '0', 10),
            scores_json: gr.getValue('scores_json') || '{}'
        };
    },

    /**
     * Fetch findings for a scan as an array of plain objects.
     * @param {string} scanId - scan sys_id
     * @return {Array} finding records
     */
    _getFindings: function (scanId) {
        var findings = [];
        var gr = new GlideRecord(this._findingTable);
        gr.addQuery('scan', scanId);
        gr.orderBy('severity');
        gr.orderByDesc('sys_created_on');
        gr.query();
        while (gr.next()) {
            findings.push({
                sys_id: gr.getUniqueValue(),
                category: gr.getValue('category'),
                component_name: gr.getValue('component_name'),
                table_name: gr.getValue('table_name'),
                reason: gr.getValue('reason'),
                suggestion: gr.getValue('suggestion'),
                severity: gr.getValue('severity'),
                status: gr.getValue('status')
            });
        }
        return findings;
    },

    /**
     * Fetch a single finding by sys_id.
     * @param {string} findingId - finding sys_id
     * @return {Object|null} finding record or null
     */
    getFinding: function (findingId) {
        var gr = new GlideRecord(this._findingTable);
        if (!gr.get(findingId)) {
            return null;
        }
        return {
            sys_id: gr.getUniqueValue(),
            category: gr.getValue('category'),
            component_name: gr.getValue('component_name'),
            table_name: gr.getValue('table_name'),
            reason: gr.getValue('reason'),
            suggestion: gr.getValue('suggestion'),
            severity: gr.getValue('severity'),
            status: gr.getValue('status')
        };
    },

    /**
     * Parse a scores JSON string into an object.
     * @param {string} json - scores JSON
     * @return {Object} scores map
     */
    _parseScores: function (json) {
        try {
            return JSON.parse(json || '{}');
        } catch (e) {
            return {};
        }
    },

    /**
     * Render findings as a Markdown report.
     * @param {Object} scan - scan record
     * @param {Array} findings - finding records
     * @param {Object} scores - per-component scores
     * @return {string} markdown
     */
    _toMarkdown: function (scan, findings, scores) {
        var out = [];
        out.push('# PerfPulse — Performance Scan Report');
        out.push('');
        out.push('**Environment:** ' + (scan.source_env || 'local'));
        out.push('**Scan type:** ' + (scan.type || 'full'));
        out.push('**Status:** ' + (scan.status || 'unknown'));
        out.push('**Started:** ' + (scan.started_at || ''));
        out.push('**Completed:** ' + (scan.completed_at || ''));
        out.push('');
        out.push('## Summary');
        out.push('');
        out.push('| Category | Count |');
        out.push('|----------|-------|');
        out.push('| Business rules | ' + (scan.business_rule_count || 0) + ' |');
        out.push('| Slow queries | ' + (scan.slow_query_count || 0) + ' |');
        out.push('| N+1 patterns | ' + (scan.n_plus_one_count || 0) + ' |');
        out.push('| Client scripts | ' + (scan.client_script_count || 0) + ' |');
        out.push('| ACL evaluation cost | ' + (scan.acl_cost_count || 0) + ' |');
        out.push('| Transaction hotspots | ' + (scan.transaction_count || 0) + ' |');
        out.push('');
        out.push('## Top Offenders (lowest scores first)');
        out.push('');
        var names = [];
        for (var t in scores) {
            if (scores.hasOwnProperty(t)) {
                names.push(t);
            }
        }
        names.sort(function (a, b) {
            return scores[a] - scores[b];
        });
        if (names.length === 0) {
            out.push('_No components scored._');
        } else {
            out.push('| Component | Score |');
            out.push('|-----------|-------|');
            var limit = Math.min(names.length, 20);
            for (var i = 0; i < limit; i++) {
                out.push('| ' + names[i] + ' | ' + scores[names[i]] + ' |');
            }
        }
        out.push('');
        out.push('## Findings');
        out.push('');
        if (findings.length === 0) {
            out.push('_No findings._');
        } else {
            for (var j = 0; j < findings.length; j++) {
                var f = findings[j];
                out.push('### [' + f.severity + '] ' + f.category + ' — ' + (f.component_name || f.table_name || 'unknown'));
                out.push('');
                out.push('- **Reason:** ' + f.reason);
                out.push('- **Suggestion:** ' + f.suggestion);
                out.push('');
            }
        }
        return out.join('\n');
    },

    /**
     * Render findings as CSV.
     * @param {Array} findings - finding records
     * @return {string} CSV body
     */
    _toCsv: function (findings) {
        var rows = ['severity,category,component_name,table_name,reason,suggestion,status'];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            rows.push([
                this._csvEscape(f.severity),
                this._csvEscape(f.category),
                this._csvEscape(f.component_name),
                this._csvEscape(f.table_name),
                this._csvEscape(f.reason),
                this._csvEscape(f.suggestion),
                this._csvEscape(f.status)
            ].join(','));
        }
        return rows.join('\n');
    },

    /**
     * Escape a CSV field.
     * @param {string} value - raw value
     * @return {string} escaped value
     */
    _csvEscape: function (value) {
        var s = value === null || value === undefined ? '' : String(value);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    },

    /**
     * Generate a plain-language remediation narrative for a finding.
     * Deterministic template — no LLM dependency.
     * @param {Object} finding - finding record
     * @return {string} narrative
     */
    remediationNarrative: function (finding) {
        var cat = finding.category || 'unknown';
        var name = finding.component_name || finding.table_name || 'unknown component';
        var narratives = {
            business_rule: 'The business rule "' + name + '" is doing expensive work on every transaction. ' +
                'A full-table scan or missing setLimit() multiplies database round-trips and directly slows the user-facing operation. ' +
                'Adding a filter and a setLimit() bound is a low-risk change that typically removes the bottleneck entirely.',
            slow_query: 'The field "' + name + '" is queried without an index or with a leading-wildcard LIKE. ' +
                'This forces a full table scan on every lookup. Adding an index (or a text index for search) is a declarative change with immediate payoff.',
            n_plus_one: 'The script include "' + name + '" runs a query inside a loop. ' +
                'This is the classic N+1 anti-pattern: N records trigger N+1 round-trips. ' +
                'Hoisting the query out of the loop or batching lookups into a single IN-clause query removes the multiplicative cost.',
            client_script: 'The client script "' + name + '" blocks the browser with synchronous work. ' +
                'Synchronous GlideAjax and DOM-in-loop patterns freeze the UI and degrade perceived performance. ' +
                'Switching to asynchronous callbacks and batched DOM updates restores responsiveness.',
            acl_cost: 'The table "' + name + '" carries a heavy ACL evaluation tax. ' +
                'Every access pays the cost of evaluating many rules, several of them scripted. ' +
                'Consolidating rules and replacing scripted conditions with declarative ones reduces per-access overhead.',
            transaction: 'A real slow transaction was traced to "' + name + '". ' +
                'This is actual runtime evidence, not a static smell. ' +
                'Review the correlated component against the static findings and apply the suggested remediation.'
        };
        return narratives[cat] || 'Review the finding and apply the suggested remediation.';
    },

    type: 'PerfPulseReport'
};
