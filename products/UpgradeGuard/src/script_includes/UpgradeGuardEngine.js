// UpgradeGuard — Instance Scanner, Impact Cross-Reference, and Risk Scoring Engine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scans the ServiceNow instance for components, cross-references against
// release note entries, and computes risk scores per component.
// @class UpgradeGuardEngine @namespace x_upgradeguardsn

var UpgradeGuardEngine = Class.create();
UpgradeGuardEngine.prototype = {

    /**
     * Initialize with a release family target (e.g., "Washington", "Vancouver")
     * @param {string} releaseFamily - target release to analyze against
     */
    initialize: function(releaseFamily) {
        this.releaseFamily = releaseFamily || '';
        this.runId = gs.generateGUID();
        this.components = [];
        this.results = [];
    },

    /**
     * Scan the instance for all relevant components.
     * Discovers: Script Includes, Business Rules, Client Scripts, UI Policies,
     * Scheduled Jobs, REST Endpoints, Custom Tables, Plugins, Integrations.
     * @return {Array} array of component objects
     */
    scanInstance: function() {
        this._scanScriptIncludes();
        this._scanBusinessRules();
        this._scanClientScripts();
        this._scanUIPolicies();
        this._scanScheduledJobs();
        this._scanRestEndpoints();
        this._scanCustomTables();
        this._scanPlugins();
        this._scanIntegrations();
        return this.components;
    },

    /**
     * Cross-reference scanned components against release note entries.
     * @param {Array} releaseNotes - array of release note entry objects
     * @return {Array} array of impact result objects
     */
    crossReference: function(releaseNotes) {
        if (!releaseNotes || releaseNotes.length === 0) {
            return [];
        }
        this.results = [];
        for (var i = 0; i < this.components.length; i++) {
            var comp = this.components[i];
            for (var j = 0; j < releaseNotes.length; j++) {
                var note = releaseNotes[j];
                var match = this._matchComponent(comp, note);
                if (match) {
                    var result = this._buildImpactResult(comp, note, match);
                    this.results.push(result);
                }
            }
        }
        return this.results;
    },

    /**
     * Compute risk scores for all impact results.
     * Score = severity_weight * usage_weight * change_type_weight (0-100).
     * @param {Array} impactResults - array of impact result objects
     * @return {Array} array of impact results with risk_score populated
     */
    computeRiskScores: function(impactResults) {
        if (!impactResults || impactResults.length === 0) {
            return [];
        }
        for (var i = 0; i < impactResults.length; i++) {
            var r = impactResults[i];
            r.risk_score = this._calculateRiskScore(r);
            r.severity = this._mapScoreToSeverity(r.risk_score);
            r.risk_factors = this._buildRiskFactors(r);
        }
        return impactResults;
    },

    /**
     * Persist analysis results to the database.
     * @param {Array} impactResults - scored impact results
     * @return {string} analysis run ID
     */
    persistResults: function(impactResults) {
        var now = new GlideDateTime();
        for (var i = 0; i < impactResults.length; i++) {
            var r = impactResults[i];
            var gr = new GlideRecord('x_upgradeguardsn_analysis');
            gr.initialize();
            gr.setValue('component_type', r.component_type || '');
            gr.setValue('component_name', r.component_name || '');
            gr.setValue('component_sys_id', r.component_sys_id || '');
            gr.setValue('scope', r.scope || '');
            gr.setValue('module', r.module || '');
            gr.setValue('source_code', r.source_code || '');
            gr.setValue('usage_count', r.usage_count || 0);
            gr.setValue('last_modified', r.last_modified || '');
            gr.setValue('release_family', this.releaseFamily);
            gr.setValue('change_type', r.change_type || '');
            gr.setValue('affected_api', r.affected_api || '');
            gr.setValue('release_note_url', r.release_note_url || '');
            gr.setValue('release_note_summary', r.release_note_summary || '');
            gr.setValue('migration_guide_url', r.migration_guide_url || '');
            gr.setValue('risk_score', r.risk_score || 0);
            gr.setValue('severity', r.severity || '');
            gr.setValue('risk_factors', r.risk_factors || '');
            gr.setValue('migration_steps', r.migration_steps || '');
            gr.setValue('analysis_run_id', this.runId);
            gr.setValue('analysis_date', now.toString());
            gr.setValue('status', 'completed');
            try {
                gr.insert();
            } catch (e) {
                gs.error('UpgradeGuardEngine.persistResults: insert failed for ' +
                    r.component_name + ' — ' + e.message);
            }
        }
        return this.runId;
    },

    /**
     * Full pipeline: scan → cross-reference → score → persist.
     * @param {Array} releaseNotes - release note entries
     * @return {string} analysis run ID
     */
    runFullAnalysis: function(releaseNotes) {
        this.scanInstance();
        var impacts = this.crossReference(releaseNotes);
        var scored = this.computeRiskScores(impacts);
        return this.persistResults(scored);
    },

    // ── Private: Scanning ──

    _scanScriptIncludes: function() {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'script_include',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('name')),
                source_code: gr.getValue('script') || '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanBusinessRules: function() {
        var gr = new GlideRecord('sys_script');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'business_rule',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('collection') || gr.getValue('name')),
                source_code: gr.getValue('script') || '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanClientScripts: function() {
        var gr = new GlideRecord('sys_script_client');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'client_script',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('table') || gr.getValue('name')),
                source_code: gr.getValue('script') || '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanUIPolicies: function() {
        var gr = new GlideRecord('sys_ui_policy');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'ui_policy',
                component_name: gr.getValue('short_description'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('table') || ''),
                source_code: '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanScheduledJobs: function() {
        var gr = new GlideRecord('sysauto_script');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'scheduled_job',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('name')),
                source_code: gr.getValue('script') || '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanRestEndpoints: function() {
        var gr = new GlideRecord('sys_ws_definition');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'rest_endpoint',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('name')),
                source_code: '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
        // Also scan sys_ws_operation for REST endpoint script content
        var opGr = new GlideRecord('sys_ws_operation');
        opGr.addQuery('sys_scope', '!=', 'global');
        opGr.setLimit(200);
        opGr.query();
        while (opGr.next()) {
            this.components.push({
                component_type: 'rest_endpoint',
                component_name: opGr.getValue('name'),
                component_sys_id: opGr.getUniqueValue(),
                scope: opGr.getValue('sys_scope') || '',
                module: this._classifyModule(opGr.getValue('name')),
                source_code: opGr.getValue('script') || '',
                usage_count: 0,
                last_modified: opGr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanCustomTables: function() {
        var gr = new GlideRecord('sys_db_object');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.addQuery('super_class.name', '!=', 'sys_metadata');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'custom_table',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('name')),
                source_code: '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    _scanPlugins: function() {
        var gr = new GlideRecord('v_plugin');
        gr.addQuery('active', true);
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'plugin',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: 'global',
                module: this._classifyModule(gr.getValue('name')),
                source_code: '',
                usage_count: 0,
                last_modified: ''
            });
        }
    },

    _scanIntegrations: function() {
        var gr = new GlideRecord('sys_rest_message');
        gr.addQuery('sys_scope', '!=', 'global');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            this.components.push({
                component_type: 'integration',
                component_name: gr.getValue('name'),
                component_sys_id: gr.getUniqueValue(),
                scope: gr.getValue('sys_scope') || '',
                module: this._classifyModule(gr.getValue('name')),
                source_code: '',
                usage_count: 0,
                last_modified: gr.getValue('sys_updated_on') || ''
            });
        }
    },

    // ── Private: Cross-Reference ──

    _matchComponent: function(comp, note) {
        var score = 0;
        // Table name match
        if (note.affected_tables && note.affected_tables.length > 0) {
            for (var t = 0; t < note.affected_tables.length; t++) {
                if (comp.component_name.toLowerCase().indexOf(note.affected_tables[t].toLowerCase()) !== -1) {
                    score += 3;
                }
            }
        }
        // API name match
        if (note.affected_apis && note.affected_apis.length > 0) {
            for (var a = 0; a < note.affected_apis.length; a++) {
                if (comp.source_code && comp.source_code.indexOf(note.affected_apis[a]) !== -1) {
                    score += 5;
                }
            }
        }
        // Module match
        if (note.module && comp.module === note.module) {
            score += 1;
        }
        // Keyword match in source code
        if (note.keywords && note.keywords.length > 0 && comp.source_code) {
            for (var k = 0; k < note.keywords.length; k++) {
                if (comp.source_code.toLowerCase().indexOf(note.keywords[k].toLowerCase()) !== -1) {
                    score += 2;
                }
            }
        }
        return score > 0 ? { match_score: score } : null;
    },

    _buildImpactResult: function(comp, note, match) {
        return {
            component_type: comp.component_type,
            component_name: comp.component_name,
            component_sys_id: comp.component_sys_id,
            scope: comp.scope,
            module: comp.module,
            source_code: comp.source_code,
            usage_count: comp.usage_count,
            last_modified: comp.last_modified,
            release_family: this.releaseFamily,
            change_type: note.change_type || 'neutral',
            affected_api: note.affected_apis ? note.affected_apis.join(', ') : '',
            release_note_url: note.url || '',
            release_note_summary: note.summary || '',
            migration_guide_url: note.migration_guide_url || '',
            match_score: match.match_score,
            risk_score: 0,
            severity: '',
            risk_factors: '',
            migration_steps: ''
        };
    },

    // ── Private: Risk Scoring ──

    _calculateRiskScore: function(result) {
        var severityWeight = this._getSeverityWeight(result.change_type);
        var usageWeight = this._getUsageWeight(result.component_type, result.usage_count);
        var matchWeight = Math.min(result.match_score || 1, 10);
        var raw = severityWeight * usageWeight * matchWeight;
        return Math.min(Math.round(raw), 100);
    },

    _getSeverityWeight: function(changeType) {
        switch (changeType) {
            case 'breaking': return 10;
            case 'additive': return 3;
            default: return 1;
        }
    },

    _getUsageWeight: function(componentType, usageCount) {
        var baseWeight = 1;
        switch (componentType) {
            case 'script_include': baseWeight = 3; break;
            case 'business_rule': baseWeight = 3; break;
            case 'scheduled_job': baseWeight = 2; break;
            case 'rest_endpoint': baseWeight = 2; break;
            case 'integration': baseWeight = 2; break;
            default: baseWeight = 1;
        }
        var usageMultiplier = 1;
        if (usageCount > 100) usageMultiplier = 3;
        else if (usageCount > 10) usageMultiplier = 2;
        return baseWeight * usageMultiplier;
    },

    _mapScoreToSeverity: function(score) {
        if (score >= 70) return 'critical';
        if (score >= 40) return 'high';
        if (score >= 15) return 'medium';
        return 'low';
    },

    _buildRiskFactors: function(result) {
        var factors = [];
        if (result.change_type === 'breaking') {
            factors.push('Breaking change — requires migration');
        }
        if (result.component_type === 'script_include') {
            factors.push('Script Include — affects all dependent code');
        }
        if (result.component_type === 'business_rule') {
            factors.push('Business Rule — affects record operations');
        }
        if (result.match_score >= 5) {
            factors.push('High API overlap — multiple affected APIs detected');
        }
        if (result.usage_count > 100) {
            factors.push('High usage — widespread impact if broken');
        }
        return factors.join('; ');
    },

    // ── Private: Utilities ──

    _classifyModule: function(name) {
        if (!name) return 'other';
        var n = name.toLowerCase();
        if (n.indexOf('incident') !== -1 || n.indexOf('change') !== -1 ||
            n.indexOf('problem') !== -1 || n.indexOf('request') !== -1 ||
            n.indexOf('task') !== -1) return 'itsm';
        if (n.indexOf('case') !== -1 || n.indexOf('customer') !== -1 ||
            n.indexOf('csm') !== -1) return 'csm';
        if (n.indexOf('hr') !== -1 || n.indexOf('employee') !== -1) return 'hr';
        if (n.indexOf('sec') !== -1 || n.indexOf('security') !== -1 ||
            n.indexOf('vuln') !== -1) return 'secops';
        if (n.indexOf('cmdb') !== -1 || n.indexOf('discovery') !== -1 ||
            n.indexOf('event') !== -1 || n.indexOf('itom') !== -1) return 'itom';
        if (n.indexOf('sys_') !== -1 || n.indexOf('glide') !== -1 ||
            n.indexOf('portal') !== -1 || n.indexOf('ui') !== -1) return 'platform';
        return 'other';
    },

    type: 'UpgradeGuardEngine'
};
