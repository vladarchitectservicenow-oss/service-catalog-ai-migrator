// SN Release Impact Digest — RIDInventoryScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Enumerates the instance's actual usage surface: active plugins, custom tables,
// business rules, client scripts, UI policies, scheduled jobs, REST endpoints,
// Flow Designer flows, and scripted API usage in the last 90 days.
// Outputs a structured JSON inventory — the "fingerprint" of this instance.
//
// @class RIDInventoryScanner
// @namespace x_snc_rid
var RIDInventoryScanner = Class.create();
RIDInventoryScanner.prototype = {

    initialize: function() {
        this._inventory = {
            generated_at: new GlideDateTime().getDisplayValue(),
            scope: 'x_snc_rid',
            plugins: [],
            custom_tables: [],
            business_rules: [],
            client_scripts: [],
            ui_policies: [],
            scheduled_jobs: [],
            rest_endpoints: [],
            flows: [],
            api_usage: []
        };
    },

    /**
     * Run full inventory scan. Returns JSON string.
     * @param {boolean} [includeApiUsage=true] — whether to scan sys_audit for API usage (expensive)
     * @return {string} JSON inventory
     */
    scan: function(includeApiUsage) {
        if (includeApiUsage === undefined) { includeApiUsage = true; }

        this._scanPlugins();
        this._scanCustomTables();
        this._scanBusinessRules();
        this._scanClientScripts();
        this._scanUIPolicies();
        this._scanScheduledJobs();
        this._scanRestEndpoints();
        this._scanFlows();

        if (includeApiUsage) {
            this._scanApiUsage();
        }

        this._inventory.summary = {
            total_plugins: this._inventory.plugins.length,
            total_custom_tables: this._inventory.custom_tables.length,
            total_business_rules: this._inventory.business_rules.length,
            total_client_scripts: this._inventory.client_scripts.length,
            total_ui_policies: this._inventory.ui_policies.length,
            total_scheduled_jobs: this._inventory.scheduled_jobs.length,
            total_rest_endpoints: this._inventory.rest_endpoints.length,
            total_flows: this._inventory.flows.length,
            total_api_usage_entries: this._inventory.api_usage.length
        };

        return JSON.stringify(this._inventory);
    },

    /**
     * Scan active plugins with versions.
     */
    _scanPlugins: function() {
        var gr = new GlideRecord('sys_plugins');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.plugins.push({
                id: gr.getValue('source') || '',
                name: gr.getValue('name') || '',
                version: gr.getValue('version') || '',
                description: gr.getValue('description') || ''
            });
        }
    },

    /**
     * Scan custom tables (scoped, excluding OOTB).
     */
    _scanCustomTables: function() {
        var gr = new GlideRecord('sys_db_object');
        gr.addNotNullQuery('name');
        gr.query();
        while (gr.next()) {
            var name = gr.getValue('name') || '';
            if (name.indexOf('sys_') === 0 || name.indexOf('ts_') === 0) { continue; }
            this._inventory.custom_tables.push({
                name: name,
                label: gr.getValue('label') || '',
                super_class: gr.getValue('super_class') || '',
                is_extendable: gr.getValue('is_extendable') === 'true'
            });
        }
    },

    /**
     * Scan active business rules.
     */
    _scanBusinessRules: function() {
        var gr = new GlideRecord('sys_script');
        gr.addQuery('active', true);
        // Filter to business rules only. sys_script can hold other script types
        // (e.g. sys_script_include references) on some ServiceNow versions.
        // The discriminator is the presence of a non-empty `collection` field
        // combined with the `sys_scope` filter for our application scope.
        gr.addNotNullQuery('collection');
        gr.query();
        while (gr.next()) {
            this._inventory.business_rules.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                table: gr.getValue('collection') || '',
                when: gr.getValue('when') || '',
                order: parseInt(gr.getValue('order') || '0', 10)
            });
        }
    },

    /**
     * Scan active client scripts.
     */
    _scanClientScripts: function() {
        var gr = new GlideRecord('sys_script_client');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.client_scripts.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                table: gr.getValue('table') || '',
                type: gr.getValue('type') || '',
                ui_type: gr.getValue('ui_type') || '0'
            });
        }
    },

    /**
     * Scan active UI policies.
     */
    _scanUIPolicies: function() {
        var gr = new GlideRecord('sys_ui_policy');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.ui_policies.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('short_description') || '',
                table: gr.getValue('table') || '',
                on_load: gr.getValue('on_load') === 'true',
                reverse_if_false: gr.getValue('reverse_if_false') === 'true'
            });
        }
    },

    /**
     * Scan active scheduled jobs.
     */
    _scanScheduledJobs: function() {
        var gr = new GlideRecord('sysauto_script');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.scheduled_jobs.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                run_type: gr.getValue('run_type') || '',
                run_day: gr.getValue('run_day') || '',
                run_time: gr.getValue('run_time') || ''
            });
        }
    },

    /**
     * Scan REST endpoints (scripted REST APIs).
     */
    _scanRestEndpoints: function() {
        var gr = new GlideRecord('sys_ws_definition');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.rest_endpoints.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                base_path: gr.getValue('base_path') || '',
                is_versioned: gr.getValue('is_versioned') === 'true'
            });
        }
    },

    /**
     * Scan Flow Designer flows.
     */
    _scanFlows: function() {
        var gr = new GlideRecord('sys_hub_flow');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            this._inventory.flows.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name') || '',
                description: gr.getValue('description') || '',
                category: gr.getValue('category') || ''
            });
        }
    },

    /**
     * Scan scripted API usage from sys_audit (last 90 days).
     * Looks for GlideRecord, GlideSystem, GlideDateTime, and other API calls.
     */
    _scanApiUsage: function() {
        var ninetyDaysAgo = new GlideDateTime();
        ninetyDaysAgo.addDaysUTC(-90);

        var gr = new GlideRecord('sys_audit');
        gr.addQuery('tablename', 'sys_script_include');
        gr.addQuery('fieldname', 'script');
        gr.addQuery('sys_created_on', '>=', ninetyDaysAgo.getValue());
        // Cap the audit scan to 2000 records per call to avoid hammering large
        // audit tables on heavily customized instances. Callers needing more
        // history can re-invoke with a custom window or use the offset-based
        // pagination built into GlideRecord (not exposed here by design to
        // keep the scanner stateless and idempotent).
        gr.setLimit(2000);
        gr.query();

        var apiPatterns = [
            { name: 'GlideRecord', pattern: /new GlideRecord\(/g },
            { name: 'GlideAggregate', pattern: /new GlideAggregate\(/g },
            { name: 'GlideDateTime', pattern: /new GlideDateTime\(/g },
            { name: 'GlideSystem', pattern: /gs\./g },
            { name: 'GlideSPSearchable', pattern: /GlideSPSearchable/g },
            { name: 'GlideSearchable', pattern: /GlideSearchable/g },
            { name: 'RESTMessageV2', pattern: /sn_ws\.RESTMessageV2/g },
            { name: 'SOAPMessageV2', pattern: /sn_ws\.SOAPMessageV2/g },
            { name: 'JSON', pattern: /JSON\(\)/g },
            { name: 'XMLDocument2', pattern: /XMLDocument2/g },
            { name: 'ArrayUtil', pattern: /ArrayUtil/g },
            { name: 'GlideStringUtil', pattern: /GlideStringUtil/g }
        ];

        var usageMap = {};
        while (gr.next()) {
            var script = gr.getValue('new_value') || gr.getValue('old_value') || '';
            for (var i = 0; i < apiPatterns.length; i++) {
                var api = apiPatterns[i];
                var matches = script.match(api.pattern);
                if (matches) {
                    if (!usageMap[api.name]) { usageMap[api.name] = 0; }
                    usageMap[api.name] += matches.length;
                }
            }
        }

        for (var key in usageMap) {
            this._inventory.api_usage.push({
                api: key,
                call_count: usageMap[key]
            });
        }

        this._inventory.api_usage.sort(function(a, b) {
            return b.call_count - a.call_count;
        });
    },

    type: 'RIDInventoryScanner'
};
