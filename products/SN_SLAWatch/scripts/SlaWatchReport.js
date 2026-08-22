// SLAWatch — SlaWatchReport: persistence, digest, and optional AI narrative
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Consolidates the reporting layer: finding persistence, ranked digest
// generation, and the optional Now Assist breach-impact narrative.
// AI is layered on top of the deterministic engine and is never load-bearing.
//
// @class SlaWatchReport @namespace x_sn_slawatch
var SlaWatchReport = Class.create();
SlaWatchReport.prototype = {
    initialize: function () {
        this._findingTable = 'x_sn_slawatch_finding';
        this._scanTable = 'x_sn_slawatch_scan';
    },

    /**
     * Persist a list of finding objects (from SlaWatchEngine) to the finding table.
     * @param {Array} findings  array of finding objects
     * @return {number} number of findings persisted
     */
    persistFindings: function (findings) {
        var count = 0;
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var gr = new GlideRecord(this._findingTable);
            gr.initialize();
            gr.setValue('scan', f.scan_sys_id || '');
            gr.setValue('sla', f.sla_sys_id || '');
            gr.setValue('sla_name', f.sla_name || '');
            gr.setValue('sla_table', f.sla_table || '');
            gr.setValue('category', f.category || '');
            gr.setValue('severity', f.severity || 'low');
            gr.setValue('message', f.message || '');
            gr.setValue('field', f.field || '');
            gr.setValue('field_value', f.field_value || '');
            gr.setValue('detail', f.detail || '');
            gr.setValue('status', 'open');
            try {
                if (gr.insert()) {
                    count++;
                }
            } catch (e) {
                gs.error('SlaWatchReport.persistFindings: insert failed for ' + f.category + ': ' + e.message);
            }
        }
        return count;
    },

    /**
     * Build a ranked digest of the top breach-risk SLAs.
     * @param {number} limit  max number of entries
     * @return {Array} ranked list of { sla_name, sla_table, score, severity }
     */
    getRankedDigest: function (limit) {
        var limit = limit || 10;
        var out = [];
        var gr = new GlideRecord(this._findingTable);
        gr.addQuery('category', 'score');
        gr.query();
        while (gr.next()) {
            out.push({
                sla_name: gr.getValue('sla_name'),
                sla_table: gr.getValue('sla_table'),
                score: parseInt(gr.getValue('detail') || '0', 10),
                severity: gr.getValue('severity')
            });
        }
        // Numeric sort (descending) — the `detail` field stores scores as
        // strings, so a DB orderByDesc would sort lexicographically ("90" > "100").
        out.sort(function (a, b) { return b.score - a.score; });
        return out.slice(0, limit);
    },

    /**
     * Build a plain-language executive summary of the current scan.
     * @param {string} scanSysId  scan record sys_id
     * @return {string} summary text
     */
    getExecutiveSummary: function (scanSysId) {
        var gr = new GlideRecord(this._scanTable);
        if (!gr.get(scanSysId)) {
            return 'No scan found.';
        }
        var slaCount = parseInt(gr.getValue('sla_count') || '0', 10);
        var findingCount = parseInt(gr.getValue('finding_count') || '0', 10);
        var highRisk = parseInt(gr.getValue('high_risk_count') || '0', 10);
        var summary = 'SLAWatch scanned ' + slaCount + ' SLA definitions and found ' +
            findingCount + ' findings, of which ' + highRisk + ' are high-risk.';
        if (highRisk > 0) {
            summary += ' Immediate remediation is recommended for the top offenders.';
        } else {
            summary += ' No high-risk conditions detected.';
        }
        return summary;
    },

    /**
     * Optional Now Assist breach-impact narrative for a single high-risk finding.
     * Deterministic fallback is returned when no GenAI Controller is configured.
     * @param {string} findingSysId  finding record sys_id
     * @return {string} narrative text
     */
    getBreachImpactNarrative: function (findingSysId) {
        var gr = new GlideRecord(this._findingTable);
        if (!gr.get(findingSysId)) {
            return 'Finding not found.';
        }
        var slaName = gr.getValue('sla_name') || 'this SLA';
        var category = gr.getValue('category') || '';
        var message = gr.getValue('message') || '';

        // Deterministic fallback — always available, no LLM dependency.
        var narrative = 'SLA "' + slaName + '" is flagged as ' + category +
            '. ' + message + '. This condition can cause the SLA to breach silently ' +
            'or fail to attach, exposing the organization to contractual penalty and ' +
            'audit findings. Review and remediate before the next reporting period.';

        // Optional AI upgrade via Now Assist (BYOK). Never load-bearing.
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenerativeAI) {
                var genAI = new sn_generative_ai.GenerativeAI();
                var prompt = 'Explain in plain language, for a contract manager, why this ' +
                    'ServiceNow SLA is at risk and what the fix does. SLA: ' + slaName +
                    '. Finding: ' + message + '. Keep it under 80 words.';
                var aiResult = genAI.generateText(prompt);
                if (aiResult && aiResult.text) {
                    narrative = aiResult.text;
                }
            }
        } catch (e) {
            gs.warn('SlaWatchReport.getBreachImpactNarrative: AI unavailable, using deterministic fallback: ' + e.message);
        }
        return narrative;
    },

    type: 'SlaWatchReport'
};
