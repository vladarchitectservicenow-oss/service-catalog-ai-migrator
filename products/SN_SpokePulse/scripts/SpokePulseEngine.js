// SpokePulse — IntegrationHub Spoke & Connection Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// SpokePulseEngine — risk scoring, dashboard aggregation, alerting, and AI
// orchestration. Consumes the health rows written by SpokePulseScanner and
// produces the unified dashboard, risk distribution, and remediation narratives.
// AI output is always advisory — this class never mutates any integration table.
//
// @class SpokePulseEngine
// @namespace x_snc_spk
var SpokePulseEngine = Class.create();
SpokePulseEngine.prototype = {

    HEALTH_TABLE: 'x_snc_spk_health',
    RUN_TABLE: 'x_snc_spk_scan_run',

    initialize: function () {
        this._scanner = new SpokePulseScanner();
    },

    /**
     * Run a full scan and return the resulting health summary.
     * @param {string} trigger - 'scheduled' or 'manual'
     * @returns {object} summary { run_id, items_scanned, findings, high_risk, distribution }
     */
    runAndSummarize: function (trigger) {
        var runId = this._scanner.runScan(trigger || 'manual');
        return this.getSummary(runId);
    },

    /**
     * Run a single scanner by name (delegates to the scanner engine).
     * @param {string} scanner - 'credential' | 'alias' | 'version' | 'dead_action'
     * @param {string} trigger - 'scheduled' or 'manual'
     * @returns {string} sys_id of the created scan-run record
     */
    runScanner: function (scanner, trigger) {
        return this._scanner.runScanner(scanner, trigger);
    },

    /**
     * Build the unified health summary for a scan run (or the latest run).
     * @param {string} runId - optional; defaults to the most recent completed run
     * @returns {object} summary
     */
    getSummary: function (runId) {
        if (!runId) {
            runId = this._latestRunId();
        }

        var distribution = { healthy: 0, 'at-risk': 0, broken: 0 };
        var items = [];
        var gr = new GlideRecord(this.HEALTH_TABLE);
        if (runId) {
            gr.addQuery('scan_run', runId);
        }
        gr.orderByDesc('risk_score');
        gr.setLimit(1000);
        gr.query();
        while (gr.next()) {
            var level = gr.getValue('risk_level');
            if (distribution.hasOwnProperty(level)) {
                distribution[level]++;
            }
            items.push({
                sys_id: gr.getUniqueValue(),
                item_type: gr.getValue('item_type'),
                item_name: gr.getValue('item_name'),
                risk_level: level,
                risk_score: parseInt(gr.getValue('risk_score'), 10) || 0,
                finding: this._safeParse(gr.getValue('finding'))
            });
        }

        return {
            run_id: runId,
            generated_at: new GlideDateTime().getValue(),
            distribution: distribution,
            total_items: items.length,
            items: items
        };
    },

    /**
     * Compute the aggregate risk score (0-100) for the whole integration estate.
     * Weighted: broken items dominate, at-risk items contribute proportionally.
     * @param {string} runId - optional
     * @returns {number} 0-100 aggregate risk score
     */
    getAggregateRisk: function (runId) {
        var summary = this.getSummary(runId);
        var d = summary.distribution;
        var total = summary.total_items;
        if (total === 0) {
            return 0;
        }
        // broken = 100, at-risk = 50, healthy = 0
        var weighted = (d.broken * 100) + (d['at-risk'] * 50);
        return Math.round(weighted / total);
    },

    /**
     * Generate a remediation narrative for a single high-risk finding.
     * Uses the GenAI Controller (BYOK) when available; falls back to a
     * deterministic narrative otherwise. Output is advisory only.
     * @param {string} healthSysId - sys_id of the health record
     * @returns {object} { sys_id, narrative, source, confidence }
     */
    generateRemediation: function (healthSysId) {
        var gr = new GlideRecord(this.HEALTH_TABLE);
        if (!gr.get(healthSysId)) {
            return { error: 'Health record not found: ' + healthSysId };
        }

        var itemName = gr.getValue('item_name');
        var itemType = gr.getValue('item_type');
        var riskLevel = gr.getValue('risk_level');
        var finding = this._safeParse(gr.getValue('finding'));

        var narrative = this._buildNarrative(itemType, itemName, riskLevel, finding);

        // Attempt AI enrichment via GenAI Controller (BYOK). Advisory only.
        var aiResult = this._tryGenAI(itemType, itemName, riskLevel, finding);
        if (aiResult && aiResult.narrative) {
            narrative = aiResult.narrative;
        }

        return {
            sys_id: healthSysId,
            item_name: itemName,
            item_type: itemType,
            risk_level: riskLevel,
            narrative: narrative,
            source: aiResult ? 'genai' : 'deterministic',
            confidence: aiResult ? aiResult.confidence : 100
        };
    },

    /**
     * Send an alert for high-risk findings (broken items) in a scan run.
     * @param {string} runId - optional; defaults to latest run
     * @param {string} recipient - email address; defaults to system property
     * @returns {object} { alerted, count, recipients }
     */
    alertHighRisk: function (runId, recipient) {
        if (!runId) {
            runId = this._latestRunId();
        }
        var summary = this.getSummary(runId);
        var broken = [];
        for (var i = 0; i < summary.items.length; i++) {
            if (summary.items[i].risk_level === 'broken') {
                broken.push(summary.items[i]);
            }
        }

        if (broken.length === 0) {
            return { alerted: false, count: 0, recipients: [] };
        }

        var to = recipient || gs.getProperty('x_snc_spk.alert_recipient') || '';
        if (!to) {
            return { alerted: false, count: broken.length, recipients: [], reason: 'no_recipient' };
        }

        var body = this._buildAlertBody(broken);
        var mail = new GlideEmailOutbound();
        mail.setTo(to);
        mail.setSubject('SpokePulse: ' + broken.length + ' broken integration item(s) detected');
        mail.setBody(body);
        mail.send();

        return { alerted: true, count: broken.length, recipients: [to] };
    },

    /**
     * Return scan-run history (most recent first).
     * @param {number} limit - max runs to return (default 20)
     * @returns {array} list of scan-run records
     */
    getScanHistory: function (limit) {
        var runs = [];
        var gr = new GlideRecord(this.RUN_TABLE);
        gr.orderByDesc('started_at');
        gr.setLimit(limit || 20);
        gr.query();
        while (gr.next()) {
            runs.push({
                sys_id: gr.getUniqueValue(),
                trigger: gr.getValue('trigger'),
                started_at: gr.getValue('started_at'),
                completed_at: gr.getValue('completed_at'),
                items_scanned: parseInt(gr.getValue('items_scanned'), 10) || 0,
                findings_count: parseInt(gr.getValue('findings_count'), 10) || 0,
                high_risk_count: parseInt(gr.getValue('high_risk_count'), 10) || 0,
                status: gr.getValue('status')
            });
        }
        return runs;
    },

    // ------------------------------------------------------------------
    // AI orchestration (advisory only)
    // ------------------------------------------------------------------

    _tryGenAI: function (itemType, itemName, riskLevel, finding) {
        try {
            if (typeof sn_generative_ai === 'undefined' || !sn_generative_ai.GenerativeAI) {
                return null;
            }
            var prompt = 'You are an integration health advisor. A ServiceNow ' + itemType +
                ' named "' + itemName + '" is at risk level "' + riskLevel + '". ' +
                'Detail: ' + (finding.detail || '') + ' ' +
                'Produce a concise, plain-language remediation narrative (2-3 sentences) ' +
                'with the specific steps an admin should take.';
            var ai = new sn_generative_ai.GenerativeAI();
            var result = ai.generate(prompt);
            if (result && result.text) {
                return { narrative: result.text, confidence: 85 };
            }
        } catch (e) {
            // AI is optional — fall back to deterministic narrative.
        }
        return null;
    },

    _buildNarrative: function (itemType, itemName, riskLevel, finding) {
        var detail = (finding && finding.detail) ? finding.detail : '';
        var remediation = (finding && finding.remediation) ? finding.remediation : '';
        var prefix = '[' + itemType + '] "' + itemName + '" is ' + riskLevel + '.';
        var parts = [prefix];
        if (detail) { parts.push(detail); }
        if (remediation) { parts.push('Recommended action: ' + remediation); }
        return parts.join(' ');
    },

    _buildAlertBody: function (brokenItems) {
        var lines = ['SpokePulse detected the following broken integration items:', ''];
        for (var i = 0; i < brokenItems.length; i++) {
            var it = brokenItems[i];
            lines.push((i + 1) + '. [' + it.item_type + '] ' + it.item_name + ' (risk ' + it.risk_score + ')');
        }
        lines.push('');
        lines.push('Review the SpokePulse health dashboard for remediation guidance.');
        return lines.join('\n');
    },

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    _latestRunId: function () {
        var gr = new GlideRecord(this.RUN_TABLE);
        gr.addQuery('status', 'completed');
        gr.orderByDesc('completed_at');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return '';
    },

    _safeParse: function (jsonStr) {
        if (!jsonStr) { return {}; }
        try {
            var parsed = JSON.parse(jsonStr);
            return parsed || {};
        } catch (e) {
            return { detail: String(jsonStr) };
        }
    },

    type: 'SpokePulseEngine'
};
