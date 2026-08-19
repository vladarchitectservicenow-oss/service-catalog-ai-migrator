// ClientScript Medic — ClientScriptMedicEngine (deterministic audit core)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic engine that audits every client-side script and UI Policy on an
// instance: builds a field x event conflict map, detects overlapping/dead UI
// policies, resolves field/table/script-include references against the live
// schema, and scores per-table form health. AI is NOT used here — detection is
// 100% reproducible. AI only enriches findings with advisory text (see
// ClientScriptMedicAI).
//
// @class ClientScriptMedicEngine @namespace x_snc_csm

var ClientScriptMedicEngine = Class.create();
ClientScriptMedicEngine.prototype = {

    initialize: function () {
        this._findings = [];
        this._runId = '';
        this._healthScores = []; // per-table health scores (init to avoid undefined)
        this._fieldCache = {};   // table -> { fieldName: true }
        this._tableCache = {};   // tableName -> true
        this._siCache = {};      // scriptIncludeName -> true
        this._catalogVarCache = {}; // catalog variable name -> true
        this._loadedCaches = false;
    },

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Run a full audit. Orchestrates conflict map, overlap detection, reference
     * resolution, and health scoring, persisting findings and a scan-run record.
     * Returns the run sys_id.
     */
    scanAll: function () {
        this._loadCaches();
        this._runId = this._createRun();

        this._buildConflictMap();
        this._detectOverlaps();
        this._resolveReferences();
        this._scoreForms();

        this._finalizeRun();
        return this._runId;
    },

    /**
     * Return the conflict map for a given table (or all tables when empty).
     * Returns an array of { table, field, event, scripts, policies, severity }.
     */
    getConflictMap: function (tableName) {
        var out = [];
        var gr = new GlideRecord('x_snc_csm_finding');
        gr.addQuery('finding_type', 'CONFLICT');
        if (tableName) {
            gr.addQuery('table_name', tableName);
        }
        gr.orderBy('table_name');
        gr.query();
        while (gr.next()) {
            out.push(this._findingToObject(gr));
        }
        // Rank by severity weight (CRITICAL > WARNING > INFO), not alphabetically.
        var weight = { CRITICAL: 0, WARNING: 1, INFO: 2 };
        out.sort(function (a, b) {
            var wa = weight[a.severity] !== undefined ? weight[a.severity] : 3;
            var wb = weight[b.severity] !== undefined ? weight[b.severity] : 3;
            return wa - wb;
        });
        return out;
    },

    /**
     * Return per-table health scores. Returns an array of
     * { table, score, critical, warning, info, last_run }.
     */
    getHealthScores: function () {
        var gr = new GlideRecord('x_snc_csm_scan_run');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('completed_on');
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) {
            return [];
        }
        var raw = gr.getValue('health_scores_json') || '[]';
        var parsed = [];
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            parsed = [];
        }
        return parsed;
    },

    /**
     * Return findings, optionally filtered by type and table.
     */
    getFindings: function (findingType, tableName) {
        var out = [];
        var gr = new GlideRecord('x_snc_csm_finding');
        if (findingType) {
            gr.addQuery('finding_type', findingType);
        }
        if (tableName) {
            gr.addQuery('table_name', tableName);
        }
        gr.orderByDesc('sys_created_on');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            out.push(this._findingToObject(gr));
        }
        return out;
    },

    // ------------------------------------------------------------------
    // Cache loading (cross-scope reads of OOTB tables)
    // ------------------------------------------------------------------

    _loadCaches: function () {
        if (this._loadedCaches) {
            return;
        }

        // Field names per table
        var d = new GlideRecord('sys_dictionary');
        d.addNotNullQuery('element');
        d.addNotNullQuery('name');
        d.setLimit(0);
        d.query();
        while (d.next()) {
            var tbl = d.getValue('name');
            var el = d.getValue('element');
            if (!this._fieldCache[tbl]) {
                this._fieldCache[tbl] = {};
            }
            this._fieldCache[tbl][el] = true;
        }

        // Table names
        var t = new GlideRecord('sys_db_object');
        t.addNotNullQuery('name');
        t.setLimit(0);
        t.query();
        while (t.next()) {
            this._tableCache[t.getValue('name')] = true;
        }

        // Script include names
        var s = new GlideRecord('sys_script_include');
        s.addNotNullQuery('name');
        s.setLimit(0);
        s.query();
        while (s.next()) {
            this._siCache[s.getValue('name')] = true;
        }

        // Catalog variable names (item_option_new). Catalog client scripts
        // reference variables, not table fields, so they are validated against
        // this cache instead of sys_dictionary.
        var cv = new GlideRecord('item_option_new');
        cv.addNotNullQuery('name');
        cv.setLimit(0);
        cv.query();
        while (cv.next()) {
            this._catalogVarCache[cv.getValue('name')] = true;
        }

        this._loadedCaches = true;
    },

    // ------------------------------------------------------------------
    // Scan run lifecycle
    // ------------------------------------------------------------------

    _createRun: function () {
        var gr = new GlideRecord('x_snc_csm_scan_run');
        gr.initialize();
        gr.setValue('status', 'running');
        gr.setValue('started_on', new GlideDateTime().getValue());
        gr.setValue('baseline_fingerprint', this._computeFingerprint());
        var sysId = '';
        try {
            sysId = gr.insert();
        } catch (e) {
            gs.error('ClientScriptMedic: failed to create scan run: ' + e);
        }
        return sysId;
    },

    _finalizeRun: function () {
        if (!this._runId) {
            return;
        }
        var gr = new GlideRecord('x_snc_csm_scan_run');
        if (!gr.get(this._runId)) {
            return;
        }
        gr.setValue('status', 'completed');
        gr.setValue('completed_on', new GlideDateTime().getValue());
        gr.setValue('finding_count', this._findings.length);
        gr.setValue('health_scores_json', JSON.stringify(this._healthScores));
        try {
            gr.update();
        } catch (e) {
            gs.error('ClientScriptMedic: failed to finalize scan run: ' + e);
        }
    },

    _computeFingerprint: function () {
        // Stable fingerprint of the script/policy inventory so the nightly delta
        // job can detect drift. Sorted sys_id keys only — no timestamps, so the
        // hash changes only when scripts/policies are added or removed.
        var keys = [];
        var gr = new GlideRecord('sys_script_client');
        gr.addNotNullQuery('sys_id');
        gr.setLimit(0);
        gr.query();
        while (gr.next()) {
            keys.push('cs:' + gr.getValue('sys_id'));
        }
        var up = new GlideRecord('sys_ui_policy');
        up.addNotNullQuery('sys_id');
        up.setLimit(0);
        up.query();
        while (up.next()) {
            keys.push('up:' + up.getValue('sys_id'));
        }
        keys.sort();
        return new GlideDigest().getMD5Hex(keys.join('|'));
    },

    // ------------------------------------------------------------------
    // 1. Field x Event conflict map
    // ------------------------------------------------------------------

    _buildConflictMap: function () {
        // Collect client scripts grouped by (table, field, event)
        var scriptMap = {}; // key -> [ {name, sys_id, body, type} ]
        var cs = new GlideRecord('sys_script_client');
        cs.addNotNullQuery('script');
        cs.setLimit(0);
        cs.query();
        while (cs.next()) {
            var table = cs.getValue('table') || '';
            var field = cs.getValue('field') || '';
            var type = cs.getValue('type') || '';
            var body = cs.getValue('script') || '';
            var refs = this._parseFieldRefs(body);
            // A client script may touch multiple fields; attribute to each.
            var fields = refs.length > 0 ? refs : [field];
            for (var i = 0; i < fields.length; i++) {
                var key = table + '|' + fields[i] + '|' + type;
                if (!scriptMap[key]) {
                    scriptMap[key] = [];
                }
                scriptMap[key].push({
                    name: cs.getValue('name') || '',
                    sys_id: cs.getValue('sys_id') || '',
                    body: body,
                    type: type
                });
            }
        }

        // Collect UI policy actions grouped by (table, field, event)
        var policyMap = {}; // key -> [ {name, sys_id, action, value} ]
        var upa = new GlideRecord('sys_ui_policy_action');
        upa.addNotNullQuery('ui_policy');
        upa.setLimit(0);
        upa.query();
        while (upa.next()) {
            var up = new GlideRecord('sys_ui_policy');
            if (!up.get(upa.getValue('ui_policy'))) {
                continue;
            }
            var pTable = up.getValue('table') || '';
            var pField = upa.getValue('field') || '';
            var pAction = upa.getValue('action') || '';
            var pValue = upa.getValue('value') || '';
            // UI policies fire on load and on change; attribute to both.
            var events = ['onLoad', 'onChange'];
            for (var e = 0; e < events.length; e++) {
                var key = pTable + '|' + pField + '|' + events[e];
                if (!policyMap[key]) {
                    policyMap[key] = [];
                }
                policyMap[key].push({
                    name: up.getValue('name') || '',
                    sys_id: up.getValue('sys_id') || '',
                    action: pAction,
                    value: pValue
                });
            }
        }

        // Detect conflicts within each key
        var keys = {};
        for (var k in scriptMap) {
            keys[k] = true;
        }
        for (var k2 in policyMap) {
            keys[k2] = true;
        }

        for (var key in keys) {
            var parts = key.split('|');
            var tbl = parts[0];
            var fld = parts[1];
            var evt = parts[2];
            var scripts = scriptMap[key] || [];
            var policies = policyMap[key] || [];

            // Conflict A: two client scripts both setValue the same field
            var setters = [];
            for (var a = 0; a < scripts.length; a++) {
                if (scripts[a].body.indexOf('setValue') >= 0) {
                    setters.push(scripts[a]);
                }
            }
            if (setters.length >= 2) {
                this._addFinding(tbl, fld, evt, 'CONFLICT', 'CRITICAL',
                    'Multiple client scripts call setValue on the same field/event',
                    setters[0].sys_id,
                    'Scripts: ' + this._names(setters) + '. The later script overwrites the earlier one.');
            }

            // Conflict B: a script setValue vs a policy set_value/read_only on same field
            if (setters.length >= 1 && policies.length >= 1) {
                var mutating = false;
                for (var p = 0; p < policies.length; p++) {
                    if (policies[p].action === 'set_value' || policies[p].action === 'read_only' ||
                        policies[p].action === 'mandatory') {
                        mutating = true;
                    }
                }
                if (mutating) {
                    this._addFinding(tbl, fld, evt, 'CONFLICT', 'WARNING',
                        'Client script and UI policy both mutate the same field',
                        setters[0].sys_id,
                        'A client script setValue competes with a UI policy action on this field.');
                }
            }

            // Conflict C: two UI policies with contradictory actions on same field
            var actions = {};
            for (var q = 0; q < policies.length; q++) {
                actions[policies[q].action] = true;
            }
            if (actions['set_value'] && actions['read_only']) {
                this._addFinding(tbl, fld, evt, 'CONFLICT', 'CRITICAL',
                    'UI policies apply contradictory actions to the same field',
                    policies[0].sys_id,
                    'One policy sets a value while another forces read-only on the same field.');
            }
        }
    },

    // ------------------------------------------------------------------
    // 2. UI policy overlap / dead-condition detection
    // ------------------------------------------------------------------

    _detectOverlaps: function () {
        var byTable = {}; // table -> [ {sys_id, name, conditions, active} ]
        var up = new GlideRecord('sys_ui_policy');
        up.addNotNullQuery('table');
        up.setLimit(0);
        up.query();
        while (up.next()) {
            var tbl = up.getValue('table');
            if (!byTable[tbl]) {
                byTable[tbl] = [];
            }
            byTable[tbl].push({
                sys_id: up.getValue('sys_id'),
                name: up.getValue('name'),
                conditions: up.getValue('conditions') || '',
                active: up.getValue('active')
            });
        }

        for (var table in byTable) {
            var list = byTable[table];
            for (var i = 0; i < list.length; i++) {
                // Dead condition: contradictory active=true^active=false
                if (this._isDeadCondition(list[i].conditions)) {
                    this._addFinding(table, '', 'onLoad', 'DEAD_POLICY', 'WARNING',
                        'UI policy condition can never evaluate true',
                        list[i].sys_id,
                        'Policy "' + list[i].name + '" has a self-contradictory condition.');
                }
                // Duplicate: same table + same conditions as another policy
                for (var j = i + 1; j < list.length; j++) {
                    if (list[i].conditions === list[j].conditions &&
                        list[i].conditions !== '') {
                        this._addFinding(table, '', 'onLoad', 'OVERLAP', 'WARNING',
                            'Duplicate UI policies with identical conditions',
                            list[i].sys_id,
                            'Policies "' + list[i].name + '" and "' + list[j].name +
                            '" share identical conditions and will both fire.');
                    }
                }
            }
        }

        // Actions targeting non-existent fields
        var upa = new GlideRecord('sys_ui_policy_action');
        upa.addNotNullQuery('field');
        upa.setLimit(0);
        upa.query();
        while (upa.next()) {
            var up2 = new GlideRecord('sys_ui_policy');
            if (!up2.get(upa.getValue('ui_policy'))) {
                continue;
            }
            var pTable = up2.getValue('table') || '';
            var pField = upa.getValue('field') || '';
            if (pField && !this._fieldExists(pTable, pField)) {
                this._addFinding(pTable, pField, 'onLoad', 'BROKEN_REF', 'CRITICAL',
                    'UI policy action targets a non-existent field',
                    up2.getValue('sys_id'),
                    'Field "' + pField + '" does not exist on table "' + pTable + '".');
            }
        }
    },

    _isDeadCondition: function (conditions) {
        if (!conditions) {
            return false;
        }
        // Detect contradictory pairs like active=true^active=false
        var re = /([A-Za-z0-9_]+)\s*=\s*([^^]+)\^[^^]*\1\s*=\s*([^^]+)/;
        var m = conditions.match(re);
        if (m) {
            var v1 = m[2].trim();
            var v2 = m[3].trim();
            if ((v1 === 'true' && v2 === 'false') || (v1 === 'false' && v2 === 'true')) {
                return true;
            }
        }
        return false;
    },

    // ------------------------------------------------------------------
    // 3. Reference integrity
    // ------------------------------------------------------------------

    _resolveReferences: function () {
        // Client scripts
        var cs = new GlideRecord('sys_script_client');
        cs.addNotNullQuery('script');
        cs.setLimit(0);
        cs.query();
        while (cs.next()) {
            this._checkScriptRefs(
                cs.getValue('table') || '',
                cs.getValue('script') || '',
                cs.getValue('sys_id') || '',
                cs.getValue('name') || ''
            );
        }

        // Catalog client scripts
        var ccs = new GlideRecord('catalog_script_client');
        ccs.addNotNullQuery('script');
        ccs.setLimit(0);
        ccs.query();
        while (ccs.next()) {
            this._checkScriptRefs(
                'catalog',
                ccs.getValue('script') || '',
                ccs.getValue('sys_id') || '',
                ccs.getValue('name') || ''
            );
        }
    },

    _checkScriptRefs: function (table, body, sysId, name) {
        // Table-level reference validation (uses the sys_db_object cache).
        if (table && table !== 'catalog' && !this._tableExists(table)) {
            this._addFinding(table, '', 'onLoad', 'BROKEN_REF', 'CRITICAL',
                'Client script targets a non-existent table',
                sysId,
                'Script "' + name + '" targets table "' + table + '" which does not exist.');
        }

        // Field references. Catalog client scripts reference catalog variables
        // (item_option_new), not table fields, so they are validated against a
        // separate cache to avoid guaranteed false positives.
        var fieldRefs = this._parseFieldRefs(body);
        for (var i = 0; i < fieldRefs.length; i++) {
            var f = fieldRefs[i];
            var exists = (table === 'catalog')
                ? this._catalogVarExists(f)
                : this._fieldExists(table, f);
            if (f && !exists) {
                this._addFinding(table, f, 'onLoad', 'BROKEN_REF', 'CRITICAL',
                    'Client script references a non-existent field',
                    sysId,
                    'Script "' + name + '" references field "' + f +
                    '" which does not exist on table "' + table + '".');
            }
        }

        // Script include references (GlideAjax)
        var siRefs = this._parseScriptIncludeRefs(body);
        for (var j = 0; j < siRefs.length; j++) {
            var si = siRefs[j];
            if (si && !this._siCache[si]) {
                this._addFinding(table, '', 'onLoad', 'BROKEN_REF', 'CRITICAL',
                    'Client script calls a non-existent script include',
                    sysId,
                    'Script "' + name + '" calls GlideAjax script include "' + si +
                    '" which does not exist.');
            }
        }
    },

    _parseFieldRefs: function (body) {
        var out = [];
        var re = /g_form\.(?:getControl|setValue|getReference|getValue|setReadOnly|setMandatory|setVisible|setDisplay|addOption|clearValue|getField)\s*\(\s*['"]([^'"]+)['"]/g;
        var m;
        while ((m = re.exec(body)) !== null) {
            if (out.indexOf(m[1]) < 0) {
                out.push(m[1]);
            }
        }
        return out;
    },

    _parseScriptIncludeRefs: function (body) {
        var out = [];
        // GlideAjax('ScriptIncludeName', ...)
        var re = /GlideAjax\s*\(\s*['"]([^'"]+)['"]/g;
        var m;
        while ((m = re.exec(body)) !== null) {
            if (out.indexOf(m[1]) < 0) {
                out.push(m[1]);
            }
        }
        return out;
    },

    _fieldExists: function (table, field) {
        if (!table || !field) {
            return true; // cannot validate without both
        }
        var cache = this._fieldCache[table];
        if (!cache) {
            return false;
        }
        return cache[field] === true;
    },

    _tableExists: function (table) {
        if (!table) {
            return true; // cannot validate without a table name
        }
        return this._tableCache[table] === true;
    },

    _catalogVarExists: function (name) {
        if (!name) {
            return true; // cannot validate without a name
        }
        return this._catalogVarCache[name] === true;
    },

    // ------------------------------------------------------------------
    // 4. Health scoring
    // ------------------------------------------------------------------

    _scoreForms: function () {
        var scores = {}; // table -> {critical, warning, info}
        for (var i = 0; i < this._findings.length; i++) {
            var f = this._findings[i];
            var tbl = f.table || '(global)';
            if (!scores[tbl]) {
                scores[tbl] = { critical: 0, warning: 0, info: 0 };
            }
            if (f.severity === 'CRITICAL') {
                scores[tbl].critical++;
            } else if (f.severity === 'WARNING') {
                scores[tbl].warning++;
            } else {
                scores[tbl].info++;
            }
        }

        this._healthScores = [];
        for (var table in scores) {
            var s = scores[table];
            var raw = 100 - (s.critical * 20 + s.warning * 5 + s.info * 1);
            var score = raw < 0 ? 0 : raw;
            this._healthScores.push({
                table: table,
                score: score,
                critical: s.critical,
                warning: s.warning,
                info: s.info,
                last_run: new GlideDateTime().getValue()
            });
        }
        this._healthScores.sort(function (a, b) {
            return a.score - b.score; // worst first
        });
    },

    // ------------------------------------------------------------------
    // Finding persistence
    // ------------------------------------------------------------------

    _addFinding: function (table, field, event, type, severity, title, sourceSysId, detail) {
        var gr = new GlideRecord('x_snc_csm_finding');
        gr.initialize();
        gr.setValue('run_id', this._runId);
        gr.setValue('table_name', table || '');
        gr.setValue('field_name', field || '');
        gr.setValue('event', event || '');
        gr.setValue('finding_type', type);
        gr.setValue('severity', severity);
        gr.setValue('title', title);
        gr.setValue('source_sys_id', sourceSysId || '');
        gr.setValue('detail', detail || '');
        gr.setValue('resolved', false);
        try {
            gr.insert();
        } catch (e) {
            gs.error('ClientScriptMedic: failed to insert finding: ' + e);
        }
        this._findings.push({
            table: table || '',
            field: field || '',
            event: event || '',
            type: type,
            severity: severity,
            title: title,
            source_sys_id: sourceSysId || '',
            detail: detail || ''
        });
    },

    _findingToObject: function (gr) {
        return {
            sys_id: gr.getValue('sys_id') || '',
            run_id: gr.getValue('run_id') || '',
            table: gr.getValue('table_name') || '',
            field: gr.getValue('field_name') || '',
            event: gr.getValue('event') || '',
            finding_type: gr.getValue('finding_type') || '',
            severity: gr.getValue('severity') || '',
            title: gr.getValue('title') || '',
            source_sys_id: gr.getValue('source_sys_id') || '',
            detail: gr.getValue('detail') || '',
            ai_suggestion: gr.getValue('ai_suggestion') || '',
            resolved: gr.getValue('resolved') === 'true' || gr.getValue('resolved') === true
        };
    },

    _names: function (arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            out.push(arr[i].name);
        }
        return out.join(', ');
    },

    type: 'ClientScriptMedicEngine'
};
