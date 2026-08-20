// ACL Sentinel — AclSentinelReport
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting engine for ACL Sentinel. Produces Markdown/JSON/CSV reports
// from scan findings, per-table least-privilege scores, and cross-env
// drift summaries. Also generates plain-language remediation narratives
// (deterministic templates — no LLM dependency).
// @class AclSentinelReport @namespace x_sn_acl_sentinel

var AclSentinelReport = Class.create();
AclSentinelReport.prototype = {

    initialize: function () {
        this._findingTable = 'x_sn_acl_sentinel_finding';
        this._scanTable = 'x_sn_acl_sentinel_scan';
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
            over_permissive_count: parseInt(gr.getValue('over_permissive_count') || '0', 10),
            orphan_count: parseInt(gr.getValue('orphan_count') || '0', 10),
            conflict_count: parseInt(gr.getValue('conflict_count') || '0', 10),
            access_denied_count: parseInt(gr.getValue('access_denied_count') || '0', 10),
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
                acl_name: gr.getValue('acl_name'),
                table_name: gr.getValue('table_name'),
                operation: gr.getValue('operation'),
                reason: gr.getValue('reason'),
                suggestion: gr.getValue('suggestion'),
                severity: gr.getValue('severity'),
                status: gr.getValue('status')
            });
        }
        return findings;
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
     * @param {Object} scores - per-table scores
     * @return {string} markdown
     */
    _toMarkdown: function (scan, findings, scores) {
        var out = [];
        out.push('# ACL Sentinel — Scan Report');
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
        out.push('| Over-permissive | ' + (scan.over_permissive_count || 0) + ' |');
        out.push('| Orphan / dead | ' + (scan.orphan_count || 0) + ' |');
        out.push('| Conflict | ' + (scan.conflict_count || 0) + ' |');
        out.push('| Access-denied | ' + (scan.access_denied_count || 0) + ' |');
        out.push('');
        out.push('## Least-Privilege Scores');
        out.push('');
        var tableNames = [];
        for (var t in scores) {
            if (scores.hasOwnProperty(t)) {
                tableNames.push(t);
            }
        }
        tableNames.sort(function (a, b) {
            return scores[a] - scores[b];
        });
        if (tableNames.length === 0) {
            out.push('_No tables scored._');
        } else {
            out.push('| Table | Score |');
            out.push('|-------|-------|');
            for (var i = 0; i < tableNames.length; i++) {
                out.push('| ' + tableNames[i] + ' | ' + scores[tableNames[i]] + ' |');
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
                out.push('### [' + f.severity + '] ' + f.category + ' — ' + (f.acl_name || f.table_name || 'unknown'));
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
        var rows = ['severity,category,acl_name,table_name,operation,reason,suggestion,status'];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            rows.push([
                this._csvEscape(f.severity),
                this._csvEscape(f.category),
                this._csvEscape(f.acl_name),
                this._csvEscape(f.table_name),
                this._csvEscape(f.operation),
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
        var table = finding.table_name || 'unknown table';
        var narratives = {
            over_permissive: 'The ACL on "' + table + '" grants broader access than necessary. ' +
                'This widens the attack surface and will likely surface as a least-privilege finding in a SOX or ISO 27001 audit. ' +
                'Tightening it to a named role with an explicit condition reduces risk without breaking legitimate access.',
            orphan: 'The ACL on "' + table + '" is no longer effective — it either references a table that does not exist or is fully shadowed by another rule. ' +
                'It adds noise to the ACL surface and obscures the real policy. Retiring it is zero-risk and improves clarity.',
            conflict: 'Two ACLs on "' + table + '" have contradictory role requirements, making access resolution non-deterministic. ' +
                'This is the classic cause of "why can this user see this field?" tickets. Merging them into a single least-privilege rule resolves the ambiguity.',
            access_denied: 'A real user was denied access on "' + table + '" by an active ACL. ' +
                'This is actual breakage, not a static smell. Review the rule against the intended policy and adjust it to restore access without over-granting.'
        };
        return narratives[cat] || 'Review the finding and apply the suggested remediation.';
    },

    type: 'AclSentinelReport'
};
