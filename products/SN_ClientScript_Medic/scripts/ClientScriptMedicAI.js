// ClientScript Medic — ClientScriptMedicAI (advisory suggestion generator)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Advisory-only AI layer. Wraps the Generative AI Controller to produce
// human-readable remediation suggestions for findings already flagged by the
// deterministic engine. AI never detects conflicts, never modifies scripts,
// and never gates the health score. If no BYOK provider is configured, it
// degrades gracefully to a rule-based template and marks the finding
// ai_suggestion = NOT_CONFIGURED.
//
// @class ClientScriptMedicAI @namespace x_snc_csm

var ClientScriptMedicAI = Class.create();
ClientScriptMedicAI.prototype = {

    initialize: function () {
        this._aiAvailable = false;
        this._checked = false;
    },

    /**
     * Generate an advisory suggestion for a single finding record.
     * Returns the suggestion string (or a rule-based fallback).
     */
    suggestFix: function (findingGr) {
        var type = findingGr.getValue('finding_type') || '';
        var title = findingGr.getValue('title') || '';
        var detail = findingGr.getValue('detail') || '';
        var table = findingGr.getValue('table_name') || '';
        var field = findingGr.getValue('field_name') || '';

        if (this._isAIAvailable()) {
            var suggestion = this._callGenerativeAI(type, title, detail, table, field);
            if (suggestion) {
                return suggestion;
            }
        }
        return this._ruleBasedSuggestion(type, table, field);
    },

    /**
     * Enrich all findings for a run with advisory suggestions.
     */
    enrichRun: function (runId) {
        var gr = new GlideRecord('x_snc_csm_finding');
        gr.addQuery('run_id', runId);
        gr.query();
        while (gr.next()) {
            var suggestion = this.suggestFix(gr);
            gr.setValue('ai_suggestion', suggestion);
            try {
                gr.update();
            } catch (e) {
                gs.error('ClientScriptMedic: failed to update ai_suggestion: ' + e);
            }
        }
    },

    // ------------------------------------------------------------------
    // AI availability (BYOK capability check)
    // ------------------------------------------------------------------

    _isAIAvailable: function () {
        if (this._checked) {
            return this._aiAvailable;
        }
        this._checked = true;
        try {
            // Generative AI Controller is plugin-dependent. If the class is
            // absent (vanilla PDI), degrade gracefully.
            if (typeof sn_generative_ai === 'undefined' ||
                typeof sn_generative_ai.GenerativeAI === 'undefined') {
                this._aiAvailable = false;
                return false;
            }
            this._aiAvailable = true;
        } catch (e) {
            this._aiAvailable = false;
        }
        return this._aiAvailable;
    },

    _callGenerativeAI: function (type, title, detail, table, field) {
        try {
            var prompt = this._buildPrompt(type, title, detail, table, field);
            var genAI = new sn_generative_ai.GenerativeAI();
            var result = genAI.generate(prompt);
            if (result && result.text) {
                return result.text;
            }
            return '';
        } catch (e) {
            gs.warn('ClientScriptMedic: GenerativeAI call failed, using rule-based fallback: ' + e);
            return '';
        }
    },

    _buildPrompt: function (type, title, detail, table, field) {
        return 'You are a ServiceNow platform expert. A client-side script audit ' +
            'found the following issue. Explain it in plain language and suggest a ' +
            'concrete remediation. Do not modify any code.\n\n' +
            'Finding type: ' + type + '\n' +
            'Title: ' + title + '\n' +
            'Table: ' + (table || '(n/a)') + '\n' +
            'Field: ' + (field || '(n/a)') + '\n' +
            'Detail: ' + detail;
    },

    // ------------------------------------------------------------------
    // Rule-based fallback (no AI)
    // ------------------------------------------------------------------

    _ruleBasedSuggestion: function (type, table, field) {
        var base = 'NOT_CONFIGURED — ';
        switch (type) {
            case 'CONFLICT':
                return base + 'Review the conflicting scripts/policies on ' +
                    (field ? 'field "' + field + '"' : 'this field') +
                    ' and consolidate into a single source of truth. Prefer a UI Policy ' +
                    'for declarative field control and remove redundant client-script setValue calls.';
            case 'BROKEN_REF':
                return base + 'Rename the broken reference to a valid field/script-include, ' +
                    'or remove the dead code. Verify the target exists on ' +
                    (table || 'the target table') + ' before re-enabling.';
            case 'OVERLAP':
                return base + 'Merge the duplicate UI policies into one, or differentiate ' +
                    'their conditions so only the intended policy fires.';
            case 'DEAD_POLICY':
                return base + 'Delete the dead policy or correct its condition so it can ' +
                    'evaluate true when intended.';
            case 'PERF':
                return base + 'Defer non-critical work out of onLoad, cache g_form lookups, ' +
                    'and batch GlideAjax calls to reduce form load weight.';
            default:
                return base + 'Review the finding manually and apply the appropriate remediation.';
        }
    },

    type: 'ClientScriptMedicAI'
};
