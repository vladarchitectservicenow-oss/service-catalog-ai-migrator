// CatalogForge — CatalogForgeEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic core of the CatalogForge scoped application.
// Turns a structured service definition (JSON intake + optional plain-language
// description) into a complete, consistent catalog-item graph: typed variables,
// choice-list seeds, variable-set wiring, UI-policy/order rules, and a starter
// record-producer flow configuration.
//
// This Script Include is PURE computation — it never writes to scoped tables,
// never writes to OOTB catalog tables, and never mutates platform records.
// Persistence and the commit layer are the responsibility of CatalogForgeWriter.
//
// All logic is ES5-compatible (Rhino): no arrow functions, no let/const,
// no template literals, no Object.values, no for...of.
//
// @class CatalogForgeEngine @namespace x_sncf
var CatalogForgeEngine = Class.create();
CatalogForgeEngine.prototype = {

    ENGINE_VERSION: '1.0.0',

    // ----------------------------------------------------------------------
    // Type mapping tables (deterministic, curated)
    // ----------------------------------------------------------------------
    // Maps normalized field names to (type, reference_table). The key is the
    // snake_case field name (see _normalizeFieldName) so "Requested For",
    // "requested_for", and "Requested For (User)" all collapse to the same key.
    NAME_TYPE_MAP: {
        'requested_for':     { type: 'reference', ref: 'sys_user' },
        'requested_by':      { type: 'reference', ref: 'sys_user' },
        'requester':         { type: 'reference', ref: 'sys_user' },
        'assigned_to':       { type: 'reference', ref: 'sys_user' },
        'assignee':          { type: 'reference', ref: 'sys_user' },
        'cost_center':       { type: 'reference', ref: 'cmn_cost_center' },
        'department':        { type: 'reference', ref: 'cmn_department' },
        'location':          { type: 'reference', ref: 'cmn_location' },
        'company':           { type: 'reference', ref: 'core_company' },
        'manager':           { type: 'reference', ref: 'sys_user' },
        'date':              { type: 'glide_date' },
        'due_date':          { type: 'glide_date' },
        'needed_by':         { type: 'glide_date' },
        'required_by':       { type: 'glide_date' },
        'start_date':        { type: 'glide_date' },
        'end_date':          { type: 'glide_date' },
        'serial_number':     { type: 'string' },
        'justification':     { type: 'string' },
        'comments':          { type: 'string' },
        'description':       { type: 'string' },
        'notes':             { type: 'string' },
        'quantity':          { type: 'integer' },
        'count':             { type: 'integer' },
        'amount':            { type: 'decimal' },
        'priority':          { type: 'choice' },
        'urgency':           { type: 'choice' },
        'impact':            { type: 'choice' },
        'hardware':          { type: 'choice' },
        'hardware_tier':     { type: 'choice' },
        'tier':              { type: 'choice' },
        'device_type':       { type: 'choice' },
        'employee_type':     { type: 'choice' },
        'access_level':      { type: 'choice' },
        'approval':          { type: 'boolean' },
        'approved':          { type: 'boolean' },
        'needs_approval':    { type: 'boolean' },
        'active':            { type: 'boolean' },
        'enabled':           { type: 'boolean' },
        'email':             { type: 'string' },
        'phone_number':      { type: 'string' }
    },

    // Curated choice-list seed library. Key = snake_case field name.
    CHOICE_SEED_LIBRARY: {
        'priority':       ['4 - Low', '3 - Moderate', '2 - High', '1 - Critical'],
        'urgency':        ['3 - Low', '2 - Medium', '1 - High'],
        'impact':         ['3 - Low', '2 - Medium', '1 - High'],
        'hardware':       ['Laptop', 'Desktop', 'Monitor', 'Docking Station'],
        'hardware_tier':  ['Standard', 'Power', 'Ultra'],
        'tier':           ['Standard', 'Premium', 'Executive'],
        'device_type':    ['Laptop', 'Desktop', 'Mobile', 'Peripheral'],
        'employee_type':  ['Full-time', 'Contractor', 'Intern', 'Vendor'],
        'access_level':   ['Read-only', 'Editor', 'Administrator']
    },

    // Reusable variable clusters. A cluster is emitted as a variable set when
    // two or more of its members appear in the inferred variable list.
    VARIABLE_SETS: {
        'Employee Information': ['requested_for', 'cost_center', 'department', 'manager', 'company'],
        'Hardware Specification': ['hardware_tier', 'hardware', 'device_type', 'serial_number'],
        'Access & Approval': ['access_level', 'approval', 'needs_approval', 'justification']
    },

    initialize: function () {
    },

    // ----------------------------------------------------------------------
    // INTAKE PARSER
    // Accepts a JSON string (structured intake) or a plain-language string.
    // Returns { ok, intake } with normalized fields.
    // ----------------------------------------------------------------------
    parseIntake: function (raw) {
        var text = (raw === undefined || raw === null) ? '' : String(raw).trim();
        if (!text) {
            return { ok: false, error: 'EMPTY_INTAKE', message: 'No service definition provided' };
        }

        // If it looks like JSON, parse it.
        if (text.charAt(0) === '{') {
            var obj = this._safeParse(text);
            if (obj === null) {
                return { ok: false, error: 'BAD_JSON', message: 'Intake JSON could not be parsed' };
            }
            return this._normalizeIntake(obj, text);
        }

        // Plain-language fallback: treat the whole string as the description.
        return this._normalizeIntake({ description: text }, text);
    },

    _normalizeIntake: function (obj, rawText) {
        var intake = {
            name: (obj.name || obj.service_name || obj.title || '').toString().trim(),
            description: (obj.description || obj.service_description || '').toString().trim(),
            category: (obj.category || '').toString().trim(),
            short_description: (obj.short_description || '').toString().trim(),
            type: (obj.type || 'item').toString().trim(),           // 'item' | 'record_producer'
            requested_variables: obj.variables || obj.requested_variables || null,
            raw: rawText
        };

        if (!intake.name && !intake.description) {
            return { ok: false, error: 'NO_NAME_OR_DESC', message: 'Provide a service name or a plain-language description' };
        }

        return { ok: true, intake: intake };
    },

    // ----------------------------------------------------------------------
    // VARIABLE-TYPE INFERENCE
    // Maps a service definition onto a typed variable list. Three sources:
    //   1. Explicit requested_variables (highest precedence).
    //   2. Curated name→type mapping (NAME_TYPE_MAP).
    //   3. A plain-language description scan for known field keywords.
    // ----------------------------------------------------------------------
    inferVariables: function (intake) {
        var variables = [];
        var seen = {};

        // 1. Explicit variables win.
        if (intake.requested_variables && this._isArray(intake.requested_variables)) {
            var req = intake.requested_variables;
            for (var i = 0; i < req.length; i++) {
                var v = req[i];
                if (!v || typeof v !== 'object') { continue; }
                var name = this._normalizeFieldName(v.name || v.label || ('field_' + (i + 1)));
                var mapped = this._mapField(name, v);
                if (!seen[name]) {
                    seen[name] = true;
                    variables.push(mapped);
                }
            }
        }

        // 2. Name→type map on the description keywords (only if not already
        //    captured above). Scan the description for known field tokens.
        var desc = (intake.description || '') + ' ' + (intake.name || '');
        var tokens = this._scanFieldTokens(desc);
        for (var t = 0; t < tokens.length; t++) {
            var token = tokens[t];
            var norm = this._normalizeFieldName(token);
            if (!seen[norm]) {
                seen[norm] = true;
                variables.push(this._mapField(token, null));
            }
        }

        // 3. Always ensure requested_for is present for record producers —
        //    it is the single most common variable and a catalog without it
        //    is almost always a mistake.
        if (!seen['requested_for']) {
            variables.unshift({
                name: 'requested_for',
                label: 'Requested For',
                type: 'reference',
                reference_table: 'sys_user',
                mandatory: true,
                read_only: false,
                choices: [],
                default_value: 'javascript:gs.getUserID()',
                variable_set: 'Employee Information',
                order: 0
            });
            seen['requested_for'] = true;
        }

        // Assign order.
        for (var o = 0; o < variables.length; o++) {
            variables[o].order = (o + 1) * 10;
        }

        return { ok: true, variables: variables };
    },

    _mapField: function (rawName, override) {
        var name = this._normalizeFieldName(rawName);
        var label = this._humanize(rawName);
        var entry = this.NAME_TYPE_MAP[name];
        var type = entry ? entry.type : 'string';
        var refTable = entry ? (entry.ref || '') : '';

        if (override) {
            if (override.type) { type = override.type; }
            if (override.reference_table || override.reference) {
                refTable = override.reference_table || override.reference;
            }
            if (override.label) { label = override.label; }
        }

        return {
            name: name,
            label: label,
            type: type,
            reference_table: refTable,
            mandatory: override ? (override.mandatory === true) : (name === 'requested_for'),
            read_only: override ? (override.read_only === true) : false,
            choices: [],
            default_value: override ? (override.default_value || '') : '',
            variable_set: this._assignVariableSet(name),
            order: 0
        };
    },

    _assignVariableSet: function (name) {
        for (var setName in this.VARIABLE_SETS) {
            if (!this.VARIABLE_SETS.hasOwnProperty(setName)) { continue; }
            var members = this.VARIABLE_SETS[setName];
            for (var i = 0; i < members.length; i++) {
                if (members[i] === name) { return setName; }
            }
        }
        return '';
    },

    // ----------------------------------------------------------------------
    // CHOICE-LIST SEEDING
    // Populates choice lists for choice-typed variables from the curated
    // library, with org-specific overrides merged on top.
    // ----------------------------------------------------------------------
    seedChoices: function (variables, overrides) {
        var ovr = overrides || {};
        for (var i = 0; i < variables.length; i++) {
            var v = variables[i];
            if (v.type !== 'choice') { continue; }
            var lib = this.CHOICE_SEED_LIBRARY[v.name] || [];
            var custom = ovr[v.name] || [];
            var merged = lib.slice();
            for (var c = 0; c < custom.length; c++) {
                if (merged.indexOf(custom[c]) === -1) { merged.push(custom[c]); }
            }
            v.choices = merged;
        }
        return variables;
    },

    // ----------------------------------------------------------------------
    // VARIABLE-SET WIRING
    // Collapses variables sharing a variable_set into a single item_option_new_set
    // reference so the catalog does not duplicate inline options. Returns a
    // list of { set_name, members: [variable names] }.
    // ----------------------------------------------------------------------
    wireVariableSets: function (variables) {
        var sets = {};
        var order = [];
        for (var i = 0; i < variables.length; i++) {
            var v = variables[i];
            if (!v.variable_set) { continue; }
            if (!sets[v.variable_set]) {
                sets[v.variable_set] = [];
                order.push(v.variable_set);
            }
            sets[v.variable_set].push(v.name);
        }

        var result = [];
        for (var s = 0; s < order.length; s++) {
            var setName = order[s];
            if (sets[setName].length >= 2) {
                result.push({ set_name: setName, members: sets[setName] });
            }
        }
        return result;
    },

    // ----------------------------------------------------------------------
    // UI-POLICY & ORDER GENERATION
    // Emits sys_ui_policy records (visibility/mandatory) and computes option
    // order. Policies are keyed off the catalog's conditional patterns:
    //   - "show X only when Y = value"  → visibility policy
    //   - "require X when Y = value"    → mandatory policy
    // Deterministic rules are derived from the type graph + a small pattern
    // table; richer rules arrive via intake.ui_policies (if supplied).
    // ----------------------------------------------------------------------
    generatePolicies: function (variables, intake) {
        var policies = [];
        var byName = {};
        for (var i = 0; i < variables.length; i++) { byName[variables[i].name] = variables[i]; }

        // Serial number is only meaningful for hardware choices.
        if (byName['serial_number']) {
            var hw = byName['hardware'] || byName['hardware_tier'] || byName['device_type'];
            if (hw && hw.type === 'choice' && hw.choices.length > 0) {
                var trigger = hw.choices[0];   // first choice value (e.g. "Laptop")
                policies.push({
                    name: 'Show Serial Number for ' + trigger,
                    type: 'visibility',
                    target: 'serial_number',
                    condition_field: hw.name,
                    condition_operator: 'equals',
                    condition_value: trigger,
                    mandatory: false,
                    order: 100
                });
            }
        }

        // Justification becomes mandatory when impact is High/Critical.
        if (byName['justification']) {
            var imp = byName['impact'] || byName['urgency'];
            if (imp && imp.type === 'choice') {
                policies.push({
                    name: 'Require Justification for High Impact',
                    type: 'mandatory',
                    target: 'justification',
                    condition_field: imp.name,
                    condition_operator: 'one_of',
                    condition_value: ['1 - High', '2 - High'],
                    mandatory: true,
                    order: 200
                });
            }
        }

        // Intake-supplied explicit policies (highest fidelity).
        if (intake.ui_policies && this._isArray(intake.ui_policies)) {
            for (var p = 0; p < intake.ui_policies.length; p++) {
                var ip = intake.ui_policies[p];
                if (ip && ip.target) {
                    policies.push({
                        name: ip.name || ('Policy ' + (policies.length + 1)),
                        type: ip.type || 'visibility',
                        target: this._normalizeFieldName(ip.target),
                        condition_field: this._normalizeFieldName(ip.condition_field || ''),
                        condition_operator: ip.condition_operator || 'equals',
                        condition_value: ip.condition_value || '',
                        mandatory: ip.type === 'mandatory',
                        order: 300 + (p * 10)
                    });
                }
            }
        }

        return policies;
    },

    // ----------------------------------------------------------------------
    // FLOW CONFIGURATION
    // Emits a starter record-producer flow config. For record producers the
    // target table is inferred; for standard items a two-step submit flow.
    // ----------------------------------------------------------------------
    configureFlow: function (intake, variables) {
        var isProducer = (intake.type === 'record_producer');
        var flow = {
            kind: isProducer ? 'record_producer' : 'catalog_item',
            name: (intake.name || intake.description || 'Untitled Service'),
            short_description: intake.short_description || intake.description || '',
            category: intake.category || 'Catalog',
            variables: [],
            steps: []
        };

        for (var i = 0; i < variables.length; i++) {
            flow.variables.push({
                name: variables[i].name,
                type: variables[i].type,
                mandatory: variables[i].mandatory,
                reference_table: variables[i].reference_table,
                default_value: variables[i].default_value
            });
        }

        if (isProducer) {
            flow.target_table = intake.target_table || 'incident';
            flow.steps.push({ order: 1, name: 'Submit', type: 'record_producer_submit' });
        } else {
            flow.steps.push({ order: 1, name: 'Submit Request', type: 'submit' });
            flow.steps.push({ order: 2, name: 'Fulfillment', type: 'fulfillment' });
        }

        return flow;
    },

    // ----------------------------------------------------------------------
    // PROPOSE — the full deterministic pipeline.
    // Returns the complete proposed item graph ready for preview.
    // ----------------------------------------------------------------------
    propose: function (rawIntake, dbOverrides) {
        var parsed = this.parseIntake(rawIntake);
        if (!parsed.ok) { return parsed; }
        var intake = parsed.intake;

        var inferred = this.inferVariables(intake);
        this.seedChoices(inferred.variables, this._mergeOverrides(intake.choice_overrides, dbOverrides));

        var graph = {
            ok: true,
            intake: intake,
            variables: inferred.variables,
            variable_sets: this.wireVariableSets(inferred.variables),
            policies: this.generatePolicies(inferred.variables, intake),
            flow: this.configureFlow(intake, inferred.variables),
            engine_version: this.ENGINE_VERSION,
            variable_count: inferred.variables.length
        };

        graph.fingerprint = this._fingerprint(graph);
        return graph;
    },

    _mergeOverrides: function (intakeOverrides, dbOverrides) {
        var merged = {};
        var a = intakeOverrides || {};
        var b = dbOverrides || {};
        var k;
        for (k in a) {
            if (a.hasOwnProperty(k)) { merged[k] = (Object.prototype.toString.call(a[k]) === '[object Array]') ? a[k].slice() : a[k]; }
        }
        for (k in b) {
            if (!b.hasOwnProperty(k)) { continue; }
            var vals = b[k];
            if (!merged[k]) { merged[k] = []; }
            for (var i = 0; i < vals.length; i++) {
                if (merged[k].indexOf(vals[i]) === -1) { merged[k].push(vals[i]); }
            }
        }
        return merged;
    },

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------
    _normalizeFieldName: function (name) {
        var s = String(name || '').toLowerCase();
        // CamelCase boundaries first (fooBar → foo Bar), then separators.
        s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        s = s.replace(/[^a-z0-9]+/g, ' ').trim();
        s = s.replace(/\s+/g, '_');
        return s;
    },

    _humanize: function (name) {
        var s = String(name || '').replace(/[_-]+/g, ' ');
        s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) { return ''; }
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    _scanFieldTokens: function (text) {
        // Look for known field names appearing in the description. Both the
        // text and each key are reduced to their alphanumeric form so that
        // "hardware tier", "Hardware Tier", and "hardware_tier" all match the
        // canonical key "hardware_tier".
        var found = [];
        var keys = [];
        for (var k in this.NAME_TYPE_MAP) {
            if (this.NAME_TYPE_MAP.hasOwnProperty(k)) { keys.push(k); }
        }
        var normText = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var normKey = key.replace(/[^a-z0-9]/g, '');
            if (normText.indexOf(normKey) !== -1 && found.indexOf(key) === -1) {
                found.push(key);
            }
        }
        return found;
    },

    _isArray: function (v) {
        return Object.prototype.toString.call(v) === '[object Array]';
    },

    _safeParse: function (text) {
        try {
            var obj = JSON.parse(text);
            return obj;
        } catch (e) {
            return null;
        }
    },

    // Portable FNV-1a 32-bit hash (stable across instances; avoids
    // GlideStringUtil.hashCode() which is non-standard in scoped apps).
    _fnv1a: function (str) {
        var hash = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
        }
        return ('00000000' + hash.toString(16)).slice(-8);
    },

    _fingerprint: function (graph) {
        var sig = graph.engine_version + '|' + (graph.intake.name || '') + '|';
        for (var i = 0; i < graph.variables.length; i++) {
            var v = graph.variables[i];
            sig += v.name + ':' + v.type + ':' + v.reference_table;
            if (v.choices && v.choices.length) {
                sig += '[' + v.choices.join(',') + ']';
            }
            sig += ';';
        }
        for (var p = 0; p < graph.policies.length; p++) {
            var pol = graph.policies[p];
            var cv = pol.condition_value;
            if (Object.prototype.toString.call(cv) === '[object Array]') { cv = cv.join('+'); }
            sig += '|P:' + pol.target + ':' + pol.type + ':' + pol.condition_field + ':' + pol.condition_operator + ':' + cv;
        }
        for (var s = 0; s < graph.variable_sets.length; s++) {
            sig += '|S:' + graph.variable_sets[s].set_name + ':' + graph.variable_sets[s].members.join(',');
        }
        if (graph.flow) {
            sig += '|F:' + graph.flow.kind + ':' + (graph.flow.target_table || '');
        }
        return 'fnv1a_' + this._fnv1a(sig);
    }
};
