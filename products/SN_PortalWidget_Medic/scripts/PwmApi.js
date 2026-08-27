// PortalWidget Medic — PwmApi
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Reporting, dependency-graph, and REST-facing facade for PortalWidget Medic.
// Builds the widget→page→portal dependency graph from sp_instance / sp_page /
// sp_portal, and renders audit reports (Markdown / JSON / CSV) from the scoped
// result tables. Exposes the public methods the Scripted REST endpoints call.

var PwmApi = Class.create();
PwmApi.prototype = {
    initialize: function() {
        this.FINDING_TABLE = 'x_sn_pwm_finding';
        this.HEALTH_TABLE = 'x_sn_pwm_health';
    },

    /**
     * Trigger a full (or incremental) scan via the engine.
     * @param {boolean} incremental
     * @returns {object} scan stats
     */
    runScan: function(incremental) {
        var engine = new PwmEngine();
        return engine.scanAllWidgets(incremental === true);
    },

    /**
     * Build the widget→page→portal dependency graph.
     * @returns {object} {nodes: [...], edges: [...]}
     */
    buildDependencyGraph: function() {
        var nodes = {};
        var edges = [];

        var inst = new GlideRecord('sp_instance');
        inst.addQuery('widget', '!=', '');
        inst.query();
        while (inst.next()) {
            var widgetId = inst.getValue('widget') + '';
            var pageId = inst.getValue('sp_page') + '';
            var portalId = inst.getValue('sp_portal') + '';

            if (widgetId) {
                nodes['w:' + widgetId] = { id: 'w:' + widgetId, type: 'widget', name: this._widgetName(widgetId) };
            }
            if (pageId) {
                nodes['p:' + pageId] = { id: 'p:' + pageId, type: 'page', name: this._pageName(pageId) };
            }
            if (portalId) {
                nodes['o:' + portalId] = { id: 'o:' + portalId, type: 'portal', name: this._portalName(portalId) };
            }

            if (widgetId && pageId) {
                edges.push({ source: 'w:' + widgetId, target: 'p:' + pageId });
            }
            if (pageId && portalId) {
                edges.push({ source: 'p:' + pageId, target: 'o:' + portalId });
            }
        }

        var nodeList = [];
        for (var k in nodes) {
            if (nodes.hasOwnProperty(k)) { nodeList.push(nodes[k]); }
        }

        return { nodes: nodeList, edges: edges };
    },

    /**
     * Query findings with optional filters.
     * @param {object} filters - {severity, finding_type, widget_id, limit}
     * @returns {Array} finding records as plain objects
     */
    getFindings: function(filters) {
        filters = filters || {};
        var out = [];
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('record_type', 'finding');
        if (filters.severity) { gr.addQuery('severity', filters.severity); }
        if (filters.finding_type) { gr.addQuery('finding_type', filters.finding_type); }
        if (filters.widget_id) { gr.addQuery('widget_id', filters.widget_id); }
        gr.addQuery('resolved', false);
        gr.setLimit(filters.limit ? parseInt(filters.limit, 10) : 100);
        gr.query();
        while (gr.next()) {
            out.push({
                sys_id: gr.getUniqueValue(),
                widget_id: gr.getValue('widget_id'),
                widget_name: gr.getValue('widget_name'),
                finding_type: gr.getValue('finding_type'),
                severity: gr.getValue('severity'),
                confidence: gr.getValue('confidence'),
                detail: gr.getValue('detail'),
                remediation: gr.getValue('remediation'),
                first_seen: gr.getValue('first_seen'),
                last_seen: gr.getValue('last_seen')
            });
        }

        var SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };
        out.sort(function(a, b) {
            return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
        });
        return out;
    },

    /**
     * Query the health dashboard (top offenders by breach-risk score).
     * @param {number} limit
     * @returns {Array} health records as plain objects
     */
    getHealth: function(limit) {
        var out = [];
        var gr = new GlideRecord(this.HEALTH_TABLE);
        gr.orderByDesc('breach_risk_score');
        gr.setLimit(limit ? parseInt(limit, 10) : 50);
        gr.query();
        while (gr.next()) {
            out.push({
                sys_id: gr.getUniqueValue(),
                widget_id: gr.getValue('widget_id'),
                widget_name: gr.getValue('widget_name'),
                widget_scope: gr.getValue('widget_scope'),
                breach_risk_score: parseInt(gr.getValue('breach_risk_score') || '0', 10),
                total_findings: parseInt(gr.getValue('total_findings') || '0', 10),
                critical_findings: parseInt(gr.getValue('critical_findings') || '0', 10),
                orphaned: gr.getValue('orphaned') === 'true' || gr.getValue('orphaned') === '1',
                duplicate: gr.getValue('duplicate') === 'true' || gr.getValue('duplicate') === '1',
                acl_exposed: gr.getValue('acl_exposed') === 'true' || gr.getValue('acl_exposed') === '1',
                status: gr.getValue('status'),
                last_scanned: gr.getValue('last_scanned')
            });
        }
        return out;
    },

    /**
     * Return the latest scan-run status (record_type = 'scan').
     * @returns {object} {has_scan, sys_id, status, scanned_at, stats}
     */
    getScanStatus: function() {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('record_type', 'scan');
        gr.orderByDesc('scanned_at');
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) {
            return { has_scan: false, status: null, scanned_at: null, stats: null };
        }
        var detailJson = gr.getValue('detail_json') || '';
        var stats = null;
        try { stats = JSON.parse(detailJson); } catch (e) { stats = null; }
        return {
            has_scan: true,
            sys_id: gr.getUniqueValue(),
            status: gr.getValue('status'),
            scanned_at: gr.getValue('scanned_at'),
            stats: stats
        };
    },

    /**
     * Render an audit report in the requested format.
     * @param {string} format - 'json' | 'csv' | 'markdown'
     * @returns {string} report body
     */
    generateReport: function(format) {
        var findings = this.getFindings({});
        var health = this.getHealth(200);

        if (format === 'json') {
            return JSON.stringify({ generated: new GlideDateTime().toString(), findings: findings, health: health });
        }
        if (format === 'csv') {
            return this._toCsv(findings);
        }
        return this._toMarkdown(findings, health);
    },

    /**
     * Convert findings to CSV.
     */
    _toCsv: function(findings) {
        var header = 'widget_id,widget_name,finding_type,severity,confidence,detail,remediation,first_seen,last_seen';
        var lines = [header];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            lines.push([
                this._csvEscape(f.widget_id), this._csvEscape(f.widget_name),
                this._csvEscape(f.finding_type), this._csvEscape(f.severity),
                this._csvEscape(f.confidence), this._csvEscape(f.detail),
                this._csvEscape(f.remediation), this._csvEscape(f.first_seen),
                this._csvEscape(f.last_seen)
            ].join(','));
        }
        return lines.join('\n');
    },

    /**
     * Convert findings + health to a Markdown report.
     */
    _toMarkdown: function(findings, health) {
        var lines = [];
        lines.push('# PortalWidget Medic — Audit Report');
        lines.push('');
        lines.push('Generated: ' + new GlideDateTime().toString());
        lines.push('');
        lines.push('## Top Offenders (by breach-risk score)');
        lines.push('');
        lines.push('| Widget | Scope | Score | Findings | Critical | Orphaned | Duplicate | ACL Exposed |');
        lines.push('|---|---|---|---|---|---|---|---|');
        for (var i = 0; i < health.length; i++) {
            var h = health[i];
            lines.push('| ' + h.widget_name + ' | ' + h.widget_scope + ' | ' + h.breach_risk_score +
                ' | ' + h.total_findings + ' | ' + h.critical_findings +
                ' | ' + (h.orphaned ? 'yes' : 'no') + ' | ' + (h.duplicate ? 'yes' : 'no') +
                ' | ' + (h.acl_exposed ? 'yes' : 'no') + ' |');
        }
        lines.push('');
        lines.push('## Findings');
        lines.push('');
        for (var j = 0; j < findings.length; j++) {
            var f = findings[j];
            lines.push('### ' + f.widget_name + ' — ' + f.finding_type + ' (' + f.severity + ')');
            lines.push('- **Detail:** ' + f.detail);
            lines.push('- **Remediation:** ' + f.remediation);
            lines.push('- **Confidence:** ' + f.confidence);
            lines.push('');
        }
        return lines.join('\n');
    },

    /**
     * CSV field escaping.
     */
    _csvEscape: function(v) {
        if (v === null || v === undefined) { return ''; }
        var s = String(v);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    },

    _widgetName: function(id) {
        var gr = new GlideRecord('sp_widget');
        if (gr.get(id)) { return gr.getValue('name') || id; }
        return id;
    },

    _pageName: function(id) {
        var gr = new GlideRecord('sp_page');
        if (gr.get(id)) { return gr.getValue('title') || id; }
        return id;
    },

    _portalName: function(id) {
        var gr = new GlideRecord('sp_portal');
        if (gr.get(id)) { return gr.getValue('title') || id; }
        return id;
    },

    type: 'PwmApi'
};
