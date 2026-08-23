// DemoForge — Realistic Demo & Test Data Generator for ServiceNow
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// DemoForgeEngine — orchestration, consistency, idempotency, rate control,
// seeding, and clean rollback. Absorbs the design's ScenarioLoader,
// ConsistencyEngine, IdempotencyTagger, RateController, SeedRunner, and
// Cleaner responsibilities into a single Script Include.
// @class DemoForgeEngine @namespace x_demo_forge
var DemoForgeEngine = Class.create();
DemoForgeEngine.prototype = {
    // ---- Constants ----
    RUN_TABLE: 'x_demo_forge_run',
    SCENARIO_TABLE: 'x_demo_forge_scenario',
    TAG_FIELD: 'u_demo_forge_run',
    DEFAULT_BATCH_SIZE: 100,
    DEFAULT_MAX_RECORDS: 10000,

    // ---- Built-in scenario registry (seeded on first use) ----
    _SCENARIOS: [
        {
            name: 'itsm',
            description: 'Standard ITSM demo: incidents, users, assignment groups, and locations with coherent relationships.',
            default_count: 500,
            tables: {
                sys_user: { count: 'target' },
                sys_user_group: { count: 8 },
                cmn_location: { count: 12 },
                incident: { count: 'target' },
                kb_knowledge: { count: 40 }
            }
        },
        {
            name: 'security',
            description: 'Security incident drill: high-severity incidents with priority/severity spread for SOC demos.',
            default_count: 200,
            tables: {
                sys_user: { count: 'target' },
                sys_user_group: { count: 4 },
                cmn_location: { count: 8 },
                incident: { count: 'target' },
                kb_knowledge: { count: 15 }
            }
        },
        {
            name: 'cmdb',
            description: 'CMDB population: servers, laptops, and network gear with vendor/model and location relationships.',
            default_count: 300,
            tables: {
                sys_user: { count: 50 },
                sys_user_group: { count: 6 },
                cmn_location: { count: 12 },
                cmdb_ci: { count: 'target' },
                incident: { count: 100 },
                kb_knowledge: { count: 20 }
            }
        },
        {
            name: 'ai-training',
            description: 'High-variance incidents with realistic short-description and resolution text for AI agent fine-tuning.',
            default_count: 1000,
            tables: {
                sys_user: { count: 'target' },
                sys_user_group: { count: 8 },
                cmn_location: { count: 12 },
                incident: { count: 'target' },
                kb_knowledge: { count: 60 }
            }
        },
        {
            name: 'executive',
            description: 'Dashboard-showcase data tuned to populate OOTB Performance Analytics widgets for C-level demos.',
            default_count: 400,
            tables: {
                sys_user: { count: 'target' },
                sys_user_group: { count: 8 },
                cmn_location: { count: 12 },
                incident: { count: 'target' },
                kb_knowledge: { count: 30 }
            }
        }
    ],

    initialize: function(seed) {
        this._content = new DemoForgeContent(seed);
        this._runSysId = '';
        this._batchSize = this.DEFAULT_BATCH_SIZE;
        this._maxRecords = this.DEFAULT_MAX_RECORDS;
        this._stats = { created: 0, updated: 0, skipped: 0, errors: 0 };
        this._writeCount = 0;
    },

    /**
     * Set the deterministic content seed (reproducible runs).
     */
    setSeed: function(seed) {
        this._content = new DemoForgeContent(seed);
    },

    // =====================================================================
    // SCENARIO LOADER
    // =====================================================================

    /**
     * Ensure the built-in scenario registry is present in the scenario
     * table. Idempotent: inserts only scenarios whose name is absent.
     */
    ensureScenarios: function() {
        for (var i = 0; i < this._SCENARIOS.length; i++) {
            var s = this._SCENARIOS[i];
            var gr = new GlideRecord(this.SCENARIO_TABLE);
            gr.addQuery('name', s.name);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                continue;
            }
            var ins = new GlideRecord(this.SCENARIO_TABLE);
            ins.initialize();
            ins.setValue('name', s.name);
            ins.setValue('description', s.description);
            ins.setValue('definition', JSON.stringify(s));
            ins.setValue('active', true);
            ins.setValue('order', i + 1);
            ins.insert();
        }
    },

    /**
     * Load a scenario definition by name from the scenario registry table.
     * Returns a parsed object or null if not found.
     */
    loadScenario: function(name) {
        this.ensureScenarios();
        var gr = new GlideRecord(this.SCENARIO_TABLE);
        gr.addQuery('name', name);
        gr.addQuery('active', 'true');
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) {
            return null;
        }
        var def = gr.getValue('definition');
        if (!def) {
            return null;
        }
        try {
            return JSON.parse(def);
        } catch (e) {
            gs.error('DemoForge: failed to parse scenario definition for "' + name + '": ' + e);
            return null;
        }
    },

    /**
     * List all active scenario names in the registry.
     */
    listScenarios: function() {
        this.ensureScenarios();
        var names = [];
        var gr = new GlideRecord(this.SCENARIO_TABLE);
        gr.addQuery('active', 'true');
        gr.orderBy('order');
        gr.orderBy('name');
        gr.query();
        while (gr.next()) {
            names.push(gr.getValue('name'));
        }
        return names;
    },

    // =====================================================================
    // CONSISTENCY ENGINE — business-hours timestamps
    // =====================================================================

    /**
     * Return a GlideDateTime within business hours (Mon-Fri, 08:00-18:00)
     * offset by the given number of business days in the past.
     */
    businessHoursTimestamp: function(daysAgo) {
        var gdt = new GlideDateTime();
        gdt.addDaysLocalTime(-daysAgo);
        // Walk back to a weekday. ServiceNow follows the Java Calendar
        // convention: 1=Sunday .. 7=Saturday.
        var day = gdt.getDayOfWeekLocalTime();
        while (day === 1 || day === 7) {
            gdt.addDaysLocalTime(-1);
            day = gdt.getDayOfWeekLocalTime();
        }
        // Clamp to business hours 08:00-18:00.
        var hour = gdt.getHourLocalTime();
        if (hour < 8) {
            gdt.setDisplayValue(gdt.getLocalDate().getValue() + ' 08:00:00');
        } else if (hour >= 18) {
            gdt.setDisplayValue(gdt.getLocalDate().getValue() + ' 17:59:59');
        }
        return gdt;
    },

    /**
     * Return a timestamp a random number of business minutes after `start`.
     */
    businessHoursAfter: function(start, maxMinutes) {
        var gdt = new GlideDateTime(start.getValue());
        var mins = this._content._int(5, maxMinutes || 480);
        gdt.addMinutesLocalTime(mins);
        var hour = gdt.getHourLocalTime();
        if (hour >= 18) {
            gdt.setDisplayValue(gdt.getLocalDate().getValue() + ' 17:59:59');
        }
        return gdt;
    },

    // =====================================================================
    // IDEMPOTENCY TAGGER
    // =====================================================================

    /**
     * Create a run record and return its sys_id. Every seeded record is
     * tagged with this sys_id so a run can be re-seeded (upsert) or rolled
     * back cleanly.
     */
    createRun: function(scenarioName, count) {
        var gr = new GlideRecord(this.RUN_TABLE);
        gr.initialize();
        gr.setValue('scenario', scenarioName);
        gr.setValue('record_count', count);
        gr.setValue('status', 'in_progress');
        gr.setValue('started_at', new GlideDateTime().getValue());
        try {
            this._runSysId = gr.insert();
        } catch (e) {
            gs.error('DemoForge: failed to create run record: ' + e);
            this._runSysId = '';
        }
        return this._runSysId;
    },

    /**
     * Mark a run record as completed with final stats and a write audit.
     */
    completeRun: function(status) {
        if (!this._runSysId) {
            return;
        }
        var gr = new GlideRecord(this.RUN_TABLE);
        if (gr.get(this._runSysId)) {
            gr.setValue('status', status || 'completed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setValue('created_count', this._stats.created);
            gr.setValue('updated_count', this._stats.updated);
            gr.setValue('error_count', this._stats.errors);
            gr.setValue('seed_log', JSON.stringify(this._stats));
            try {
                gr.update();
            } catch (e) {
                gs.error('DemoForge: failed to update run record: ' + e);
            }
        }
    },

    // =====================================================================
    // RATE CONTROL — batched writes with backoff
    // =====================================================================

    /**
     * Set the batch size for Table API writes. Clamped to [1, 1000].
     * The engine yields (gs.sleep) after every batch of writes.
     */
    setBatchSize: function(n) {
        var v = parseInt(n, 10);
        if (isNaN(v) || v < 1) {
            v = this.DEFAULT_BATCH_SIZE;
        }
        if (v > 1000) {
            v = 1000;
        }
        this._batchSize = v;
    },

    /**
     * Set the maximum number of records to seed (safety cap).
     */
    setMaxRecords: function(n) {
        var v = parseInt(n, 10);
        if (isNaN(v) || v < 1) {
            v = this.DEFAULT_MAX_RECORDS;
        }
        this._maxRecords = v;
    },

    // =====================================================================
    // SEED RUNNER
    // =====================================================================

    /**
     * Seed a scenario. Returns a stats object.
     * @param {string} scenarioName  name of the scenario in the registry
     * @param {number} count         number of primary records to generate
     * @param {boolean} dryRun       if true, compute counts without writing
     */
    seed: function(scenarioName, count, dryRun) {
        var scenario = this.loadScenario(scenarioName);
        if (!scenario) {
            return { ok: false, error: 'Scenario not found: ' + scenarioName };
        }

        var target = parseInt(count, 10);
        if (isNaN(target) || target < 1) {
            target = scenario.default_count || 100;
        }
        if (target > this._maxRecords) {
            target = this._maxRecords;
        }

        if (dryRun) {
            return this._dryRun(scenario, target);
        }

        this._runSysId = this.createRun(scenarioName, target);
        if (!this._runSysId) {
            return { ok: false, error: 'Failed to create run record' };
        }

        try {
            this._seedUsers(scenario, target);
            this._seedGroups(scenario);
            this._seedLocations(scenario);
            this._seedCIs(scenario, target);
            this._seedIncidents(scenario, target);
            this._seedKnowledge(scenario, target);
            this.completeRun('completed');
        } catch (e) {
            gs.error('DemoForge: seed failed: ' + e);
            this.completeRun('failed');
            return { ok: false, error: String(e), stats: this._stats };
        }

        return { ok: true, run_sys_id: this._runSysId, stats: this._stats };
    },

    /**
     * Public dry-run preview: compute what a seed would create without
     * writing anything.
     */
    preview: function(scenarioName, count) {
        var scenario = this.loadScenario(scenarioName);
        if (!scenario) {
            return { ok: false, error: 'Scenario not found: ' + scenarioName };
        }
        var target = parseInt(count, 10);
        if (isNaN(target) || target < 1) {
            target = scenario.default_count || 100;
        }
        return this._dryRun(scenario, target);
    },

    /**
     * Compute what a seed would create without writing anything.
     */
    _dryRun: function(scenario, target) {
        var plan = {
            scenario: scenario.name,
            target: target,
            tables: {}
        };
        var tables = scenario.tables || {};
        for (var t in tables) {
            if (tables.hasOwnProperty(t)) {
                var spec = tables[t];
                var n = spec.count === 'target' ? target : (parseInt(spec.count, 10) || 0);
                if (t === 'cmdb_ci') {
                    // CIs are distributed across three subclasses.
                    var per = Math.floor(n / 3);
                    var rem = n % 3;
                    plan.tables['cmdb_ci_server'] = per + (rem > 0 ? 1 : 0);
                    plan.tables['cmdb_ci_computer'] = per + (rem > 1 ? 1 : 0);
                    plan.tables['cmdb_ci_netgear'] = per;
                } else {
                    plan.tables[t] = n;
                }
            }
        }
        return { ok: true, dry_run: true, plan: plan };
    },

    // ---- Per-entity seeders ----

    _seedUsers: function(scenario, target) {
        var spec = (scenario.tables && scenario.tables.sys_user) || {};
        var n = spec.count === 'target' ? target : (parseInt(spec.count, 10) || 0);
        if (n <= 0) {
            return;
        }
        var departments = this._content._departments;
        for (var i = 0; i < n; i++) {
            var first = this._content._pick(this._content._firstNames);
            var last = this._content._pick(this._content._lastNames);
            var gr = new GlideRecord('sys_user');
            gr.initialize();
            gr.setValue('first_name', first);
            gr.setValue('last_name', last);
            gr.setValue('user_name', (first + '.' + last).toLowerCase().replace(/[^a-z.]/g, '') + this._content._int(1, 99));
            gr.setValue('email', this._content.getEmail(first, last));
            gr.setValue('title', this._content.getTitle());
            gr.setValue('department', this._getOrCreateDepartment(this._content._pick(departments)));
            gr.setValue('location', this._getOrCreateLocation(this._content.getLocation()));
            gr.setValue('phone', this._content.getPhone());
            gr.setValue('active', true);
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._upsert(gr, 'sys_user', 'user_name',
                ['first_name', 'last_name', 'email', 'title', 'department', 'location', 'phone', 'active', this.TAG_FIELD]);
        }
    },

    _seedGroups: function(scenario) {
        var spec = (scenario.tables && scenario.tables.sys_user_group) || {};
        var n = parseInt(spec.count, 10) || 0;
        if (n <= 0) {
            return;
        }
        var names = ['Service Desk', 'Network Operations', 'Security Operations', 'Application Support',
            'Database Administration', 'Infrastructure', 'End User Computing', 'Change Management'];
        for (var i = 0; i < n && i < names.length; i++) {
            var gr = new GlideRecord('sys_user_group');
            gr.initialize();
            gr.setValue('name', names[i]);
            gr.setValue('description', 'DemoForge assignment group for ' + names[i]);
            gr.setValue('active', true);
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._upsert(gr, 'sys_user_group', 'name', ['description', 'active', this.TAG_FIELD]);
        }
    },

    _seedLocations: function(scenario) {
        var spec = (scenario.tables && scenario.tables.cmn_location) || {};
        var n = parseInt(spec.count, 10) || 0;
        if (n <= 0) {
            return;
        }
        var locs = this._content._locations;
        for (var i = 0; i < n && i < locs.length; i++) {
            var gr = new GlideRecord('cmn_location');
            gr.initialize();
            gr.setValue('name', locs[i]);
            gr.setValue('city', locs[i].split(',')[0]);
            gr.setValue('country', this._content.getCountry(locs[i]));
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._upsert(gr, 'cmn_location', 'name', ['city', 'country', this.TAG_FIELD]);
        }
    },

    _seedCIs: function(scenario, target) {
        var spec = (scenario.tables && scenario.tables.cmdb_ci) || {};
        var n = spec.count === 'target' ? target : (parseInt(spec.count, 10) || 0);
        if (n <= 0) {
            return;
        }
        var classes = ['cmdb_ci_server', 'cmdb_ci_computer', 'cmdb_ci_netgear'];
        for (var i = 0; i < n; i++) {
            var cls = this._content._pick(classes);
            var gr = new GlideRecord(cls);
            gr.initialize();
            gr.setValue('name', this._ciName(cls));
            gr.setValue('manufacturer', this._getOrCreateCompany(this._content.getVendor()));
            gr.setValue('model_id', this._getOrCreateModel(this._ciModel(cls)));
            gr.setValue('operational_status', '1');
            gr.setValue('install_status', '1');
            gr.setValue('location', this._getOrCreateLocation(this._content.getLocation()));
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._upsert(gr, cls, 'name',
                ['manufacturer', 'model_id', 'operational_status', 'install_status', 'location', this.TAG_FIELD]);
        }
    },

    _ciName: function(cls) {
        var prefix = cls === 'cmdb_ci_server' ? 'SRV' : (cls === 'cmdb_ci_computer' ? 'WS' : 'NET');
        return prefix + '-' + this._content._int(100, 999) + '-' + this._content._int(10, 99);
    },

    _ciModel: function(cls) {
        if (cls === 'cmdb_ci_server') {
            return this._content.getServerModel();
        }
        if (cls === 'cmdb_ci_computer') {
            return this._content.getLaptopModel();
        }
        return this._content.getNetworkModel();
    },

    _seedIncidents: function(scenario, target) {
        var spec = (scenario.tables && scenario.tables.incident) || {};
        var n = spec.count === 'target' ? target : (parseInt(spec.count, 10) || 0);
        if (n <= 0) {
            return;
        }
        var priorities = ['1', '2', '3', '4'];
        var states = ['1', '2', '3', '6', '7'];
        for (var i = 0; i < n; i++) {
            var opened = this.businessHoursTimestamp(this._content._int(0, 30));
            var gr = new GlideRecord('incident');
            gr.initialize();
            gr.setValue('short_description', this._content.getShortDescription());
            gr.setValue('description', this._content.getShortDescription() + '. Reported by ' + this._content.getName() + '.');
            gr.setValue('category', this._content._pick(this._content._incidentCategories));
            gr.setValue('priority', this._content._pick(priorities));
            gr.setValue('state', this._content._pick(states));
            gr.setValue('opened_at', opened.getValue());
            gr.setValue('caller_id', this._randomUserSysId());
            gr.setValue('assignment_group', this._randomGroupSysId());
            if (this._content._rand() > 0.3) {
                gr.setValue('close_notes', this._content.getResolutionNotes());
                gr.setValue('resolved_at', this.businessHoursAfter(opened, 480).getValue());
            }
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._safeInsert(gr, 'incident');
        }
    },

    _seedKnowledge: function(scenario, target) {
        var spec = (scenario.tables && scenario.tables.kb_knowledge) || {};
        var n = spec.count === 'target' ? target : (parseInt(spec.count, 10) || 0);
        if (n <= 0) {
            return;
        }
        for (var i = 0; i < n; i++) {
            var title = this._content.getKbTitle();
            var gr = new GlideRecord('kb_knowledge');
            gr.initialize();
            gr.setValue('short_description', title);
            gr.setValue('text', this._content.getKbBody(title));
            gr.setValue('workflow_state', 'published');
            gr.setValue('author', this._randomUserSysId());
            gr.setValue(this.TAG_FIELD, this._runSysId);
            this._upsert(gr, 'kb_knowledge', 'short_description',
                ['text', 'workflow_state', 'author', this.TAG_FIELD]);
        }
    },

    // ---- Helpers ----

    _randomUserSysId: function() {
        var gr = new GlideRecord('sys_user');
        gr.addQuery(this.TAG_FIELD, this._runSysId);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return '';
    },

    _randomGroupSysId: function() {
        var gr = new GlideRecord('sys_user_group');
        gr.addQuery(this.TAG_FIELD, this._runSysId);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return '';
    },

    /**
     * Resolve a location by name, creating it (tagged) if absent.
     * Returns the cmn_location sys_id.
     */
    _getOrCreateLocation: function(name) {
        var gr = new GlideRecord('cmn_location');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        gr.initialize();
        gr.setValue('name', name);
        gr.setValue('city', name.split(',')[0]);
        gr.setValue('country', this._content.getCountry(name));
        gr.setValue(this.TAG_FIELD, this._runSysId);
        return gr.insert();
    },

    /**
     * Resolve a department by name, creating it if absent.
     * Returns the cmn_department sys_id.
     */
    _getOrCreateDepartment: function(name) {
        var gr = new GlideRecord('cmn_department');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        gr.initialize();
        gr.setValue('name', name);
        return gr.insert();
    },

    /**
     * Resolve a company (vendor) by name, creating it if absent.
     * Returns the core_company sys_id.
     */
    _getOrCreateCompany: function(name) {
        var gr = new GlideRecord('core_company');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        gr.initialize();
        gr.setValue('name', name);
        return gr.insert();
    },

    /**
     * Resolve a hardware model by name, creating it if absent.
     * Returns the cmdb_model sys_id.
     */
    _getOrCreateModel: function(name) {
        var gr = new GlideRecord('cmdb_model');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        gr.initialize();
        gr.setValue('name', name);
        return gr.insert();
    },

    /**
     * Insert a record with a guard against unhandled exceptions.
     */
    _safeInsert: function(gr, tableName) {
        try {
            var sysId = gr.insert();
            if (sysId) {
                this._stats.created++;
            } else {
                this._stats.skipped++;
            }
            this._throttle();
            return sysId;
        } catch (e) {
            this._stats.errors++;
            gs.error('DemoForge: insert failed on ' + tableName + ': ' + e);
            return '';
        }
    },

    /**
     * Upsert a record keyed by `matchField`. If a record with the same key
     * exists, its listed fields are updated in place; otherwise a new record
     * is inserted. This makes re-seeding idempotent (no duplicates).
     */
    _upsert: function(gr, tableName, matchField, fields) {
        var matchValue = gr.getValue(matchField);
        if (!matchValue) {
            return this._safeInsert(gr, tableName);
        }
        var existing = new GlideRecord(tableName);
        existing.addQuery(matchField, matchValue);
        existing.setLimit(1);
        existing.query();
        if (existing.next()) {
            var sysId = existing.getUniqueValue();
            var upd = new GlideRecord(tableName);
            if (upd.get(sysId)) {
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    var v = gr.getValue(f);
                    if (v) {
                        upd.setValue(f, v);
                    }
                }
                try {
                    upd.update();
                    this._stats.updated++;
                    this._throttle();
                    return sysId;
                } catch (e) {
                    this._stats.errors++;
                    gs.error('DemoForge: update failed on ' + tableName + ': ' + e);
                    return '';
                }
            }
        }
        return this._safeInsert(gr, tableName);
    },

    /**
     * Rate control: yield after every `_batchSize` writes.
     */
    _throttle: function() {
        this._writeCount++;
        if (this._writeCount % this._batchSize === 0) {
            gs.sleep(10);
        }
    },

    // =====================================================================
    // CLEANER — rollback a run
    // =====================================================================

    /**
     * Delete every record tagged with the given run sys_id across all
     * seeded tables. Returns a stats object.
     */
    clean: function(runSysId) {
        if (!runSysId) {
            return { ok: false, error: 'run_sys_id is required' };
        }
        var tables = ['incident', 'kb_knowledge', 'cmdb_ci_server', 'cmdb_ci_computer', 'cmdb_ci_netgear',
            'sys_user', 'sys_user_group', 'cmn_location'];
        var stats = { deleted: 0, errors: 0 };
        for (var i = 0; i < tables.length; i++) {
            var gr = new GlideRecord(tables[i]);
            gr.addQuery(this.TAG_FIELD, runSysId);
            gr.query();
            while (gr.next()) {
                try {
                    if (gr.deleteRecord()) {
                        stats.deleted++;
                    }
                } catch (e) {
                    stats.errors++;
                    gs.error('DemoForge: delete failed on ' + tables[i] + ': ' + e);
                }
            }
        }
        // Delete the run record itself.
        var runGr = new GlideRecord(this.RUN_TABLE);
        if (runGr.get(runSysId)) {
            try {
                runGr.deleteRecord();
            } catch (e) {
                gs.error('DemoForge: failed to delete run record: ' + e);
            }
        }
        return { ok: true, stats: stats };
    },

    type: 'DemoForgeEngine'
};
