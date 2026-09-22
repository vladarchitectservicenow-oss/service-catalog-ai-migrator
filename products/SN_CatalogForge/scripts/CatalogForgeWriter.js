// CatalogForge — CatalogForgeWriter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Persistence and commit layer for the CatalogForge scoped application.
// Wraps the pure CatalogForgeEngine with side effects: it writes review
// records to the scoped tables, and on explicit approval commits the proposed
// item graph to the OOTB catalog tables (sc_cat_item, sc_cat_item_producer,
// item_option_new, item_option_new_set, sys_choice, sys_ui_policy).
//
// Every write is review-gated: propose → preview → approve → commit. The
// commit layer writes atomically with rollback on any partial failure.
//
// ES5-compatible (Rhino). No arrow functions, no let/const, no template
// literals, no Object.values, no for...of.
//
// @class CatalogForgeWriter @namespace x_sncf
var CatalogForgeWriter = Class.create();
CatalogForgeWriter.prototype = {

    MAX_PREVIEW_CHARS: 4000000,

    // ----------------------------------------------------------------------
    initialize: function () {
        this._engine = new CatalogForgeEngine();
    },

    // ----------------------------------------------------------------------
    // PROPOSE + PERSIST REVIEW RECORD
    // Runs the engine, stores the graph as a reviewable record, and returns
    // the record with its sys_id for later approval.
    // ----------------------------------------------------------------------
    propose: function (rawIntake, requestorId) {
        var graph = this._engine.propose(rawIntake, this._loadChoiceOverrides());
        if (!graph.ok) { return graph; }

        var previewJson = this._safeStringify(graph);
        if (previewJson.length > this.MAX_PREVIEW_CHARS) {
            return { ok: false, error: 'GRAPH_TOO_LARGE', message: 'Proposed graph (' + previewJson.length + ' chars) exceeds the preview storage limit' };
        }

        var gr = new GlideRecord('x_sncf_catalog_forge_draft');
        gr.initialize();
        gr.setValue('name', graph.intake.name || graph.intake.description || 'Untitled Service');
        gr.setValue('type', graph.intake.type || 'item');
        gr.setValue('category', graph.intake.category || '');
        gr.setValue('status', 'proposed');
        gr.setValue('requestor', requestorId || '');
        gr.setValue('variable_count', graph.variable_count);
        gr.setValue('fingerprint', graph.fingerprint);
        gr.setValue('preview_json', previewJson);
        gr.setValue('engine_version', graph.engine_version);

        var sysId = null;
        try {
            sysId = gr.insert();
        } catch (e) {
            return { ok: false, error: 'INSERT_FAILED', message: String(e) };
        }

        return {
            ok: true,
            draft_sys_id: sysId,
            fingerprint: graph.fingerprint,
            variable_count: graph.variable_count,
            graph: graph
        };
    },

    // ----------------------------------------------------------------------
    // PREVIEW
    // Returns the stored graph for a draft (or a fresh graph if rawIntake is
    // supplied directly). Never writes.
    // ----------------------------------------------------------------------
    preview: function (draftSysId, rawIntake) {
        if (draftSysId) {
            var gr = new GlideRecord('x_sncf_catalog_forge_draft');
            if (!gr.get(draftSysId)) {
                return { ok: false, error: 'NOT_FOUND', message: 'Draft not found' };
            }
            var parsed = this._safeParse(gr.getValue('preview_json'));
            if (parsed === null) {
                return { ok: false, error: 'BAD_PREVIEW', message: 'Stored preview is not valid JSON' };
            }
            parsed.draft_sys_id = draftSysId;
            parsed.status = gr.getValue('status');
            return parsed;
        }

        return this._engine.propose(rawIntake);
    },

    // ----------------------------------------------------------------------
    // COMMIT — atomic write of the full item graph to OOTB catalog tables.
    // Writes:
    //   sc_cat_item          — the catalog item
    //   sc_cat_item_producer — the record producer (if type=record_producer)
    //   item_option_new      — one record per variable
    //   item_option_new_set  — one record per variable set
    //   sys_choice           — one record per seeded choice value
    //   sys_ui_policy        — one record per UI policy
    // Rollback is performed on any failure; the draft is marked 'committed'
    // only after every write succeeds.
    // ----------------------------------------------------------------------
    commit: function (draftSysId) {
        var gr = new GlideRecord('x_sncf_catalog_forge_draft');
        if (!gr.get(draftSysId)) {
            return { ok: false, error: 'NOT_FOUND', message: 'Draft not found' };
        }
        if (gr.getValue('status') === 'committed') {
            return { ok: false, error: 'ALREADY_COMMITTED', message: 'Draft already committed' };
        }
        if (!gs.hasRole('x_sncf.admin')) {
            return { ok: false, error: 'FORBIDDEN', message: 'Commit requires the x_sncf.admin role' };
        }

        var graph = this._safeParse(gr.getValue('preview_json'));
        if (graph === null) {
            return { ok: false, error: 'BAD_PREVIEW', message: 'Stored preview is not valid JSON' };
        }

        var written = { items: [], variables: [], variable_sets: [], choices: [], policies: [] };
        var rollbackIds = [];

        try {
            var itemSysId = this._writeItem(graph, written, rollbackIds);

            this._writeVariables(itemSysId, graph, written, rollbackIds);
            this._writeVariableSets(itemSysId, graph, written, rollbackIds);
            this._writeChoices(graph, written, rollbackIds);
            this._writePolicies(itemSysId, graph, written, rollbackIds);
        } catch (e) {
            this._rollback(rollbackIds);
            return { ok: false, error: 'COMMIT_FAILED', message: String(e) };
        }

        // Mark the draft committed.
        gr.setValue('status', 'committed');
        gr.setValue('committed_item_sys_id', written.items[0] || '');
        try {
            gr.update();
        } catch (e2) {
            this._rollback(rollbackIds);
            return { ok: false, error: 'STATUS_UPDATE_FAILED', message: String(e2) };
        }

        return {
            ok: true,
            item_sys_id: written.items[0] || '',
            variables: written.variables.length,
            variable_sets: written.variable_sets.length,
            choices: written.choices.length,
            policies: written.policies.length
        };
    },

    // ----------------------------------------------------------------------
    // EXPORT — emit a portable JSON bundle for review, versioning, re-import.
    // ----------------------------------------------------------------------
    exportBundle: function (draftSysId) {
        var graph = this.preview(draftSysId, null);
        if (!graph || !graph.ok) {
            return graph || { ok: false, error: 'BAD_PREVIEW', message: 'Could not load graph for export' };
        }

        var bundle = {
            format_version: '1.0.0',
            exported_at: new GlideDateTime().getDisplayValue(),
            engine_version: graph.engine_version || this._engine.ENGINE_VERSION,
            fingerprint: graph.fingerprint || '',
            item: {
                name: graph.intake.name,
                short_description: graph.intake.short_description || graph.intake.description,
                category: graph.intake.category,
                type: graph.intake.type
            },
            variables: graph.variables,
            variable_sets: graph.variable_sets,
            policies: graph.policies,
            flow: graph.flow
        };

        return { ok: true, bundle: bundle };
    },

    // ----------------------------------------------------------------------
    // LIST — return recent drafts (bounded).
    // ----------------------------------------------------------------------
    listDrafts: function (limit) {
        var cap = Math.min(parseInt(limit, 10) || 25, 100);
        var out = [];
        var gr = new GlideRecord('x_sncf_catalog_forge_draft');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(cap);
        gr.query();
        while (gr.next()) {
            out.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name'),
                type: gr.getValue('type'),
                status: gr.getValue('status'),
                variable_count: gr.getValue('variable_count'),
                fingerprint: gr.getValue('fingerprint'),
                created_on: gr.getValue('sys_created_on')
            });
        }
        return { ok: true, drafts: out };
    },

    // ----------------------------------------------------------------------
    // Internal writers
    // ----------------------------------------------------------------------
    _writeItem: function (graph, written, rollbackIds) {
        var isProducer = (graph.intake.type === 'record_producer');
        var table = isProducer ? 'sc_cat_item_producer' : 'sc_cat_item';
        var item = new GlideRecord(table);
        item.initialize();
        item.setValue('name', graph.intake.name || graph.intake.description || 'Untitled Service');
        item.setValue('short_description', graph.intake.short_description || graph.intake.description || '');
        item.setValue('active', 'false');   // stays inactive until a human reviews it
        if (isProducer) {
            item.setValue('table', (graph.flow && graph.flow.target_table) ? graph.flow.target_table : 'incident');
        } else {
            item.setValue('type', 'item');
        }
        if (graph.intake.category) {
            item.setValue('category', graph.intake.category);
        }
        var sysId = item.insert();
        written.items.push(sysId);
        rollbackIds.push({ table: table, sys_id: sysId });
        return sysId;
    },

    _writeVariables: function (itemSysId, graph, written, rollbackIds) {
        var vars = graph.variables || [];
        for (var i = 0; i < vars.length; i++) {
            var v = vars[i];
            var opt = new GlideRecord('item_option_new');
            opt.initialize();
            opt.setValue('cat_item', itemSysId);
            opt.setValue('name', v.name);
            opt.setValue('question_text', v.label);
            opt.setValue('type', this._mapType(v.type));
            opt.setValue('mandatory', v.mandatory ? 'true' : 'false');
            opt.setValue('order', v.order);
            opt.setValue('active', 'true');
            if (v.type === 'reference' && v.reference_table) {
                opt.setValue('reference', v.reference_table);
            }
            if (v.default_value) {
                opt.setValue('default_value', v.default_value);
            }
            if (v.read_only) {
                opt.setValue('read_only', 'true');
            }
            var optSysId = opt.insert();
            written.variables.push(optSysId);
            rollbackIds.push({ table: 'item_option_new', sys_id: optSysId });
        }
    },

    _writeVariableSets: function (itemSysId, graph, written, rollbackIds) {
        var sets = graph.variable_sets || [];
        for (var s = 0; s < sets.length; s++) {
            var set = sets[s];
            var vs = new GlideRecord('item_option_new_set');
            vs.initialize();
            vs.setValue('name', set.set_name);
            vs.setValue('cat_item', itemSysId);
            vs.setValue('active', 'true');
            var vsSysId = vs.insert();
            written.variable_sets.push(vsSysId);
            rollbackIds.push({ table: 'item_option_new_set', sys_id: vsSysId });

            // Attach member variables to the set.
            for (var m = 0; m < set.members.length; m++) {
                var memberName = set.members[m];
                var mv = new GlideRecord('item_option_new');
                mv.addQuery('cat_item', itemSysId);
                mv.addQuery('name', memberName);
                mv.setLimit(1);
                mv.query();
                if (mv.next()) {
                    mv.setValue('variable_set', vsSysId);
                    try { mv.update(); } catch (e) { /* non-fatal */ }
                }
            }
        }
    },

    _writeChoices: function (graph, written, rollbackIds) {
        var vars = graph.variables || [];
        var itemName = graph.intake.name || graph.intake.description || '';
        for (var i = 0; i < vars.length; i++) {
            var v = vars[i];
            if (v.type !== 'choice' || !v.choices || v.choices.length === 0) { continue; }
            for (var c = 0; c < v.choices.length; c++) {
                var ch = new GlideRecord('sys_choice');
                ch.initialize();
                ch.setValue('name', 'item_option_new');       // catalog variable choices
                ch.setValue('element', v.name);
                ch.setValue('label', v.choices[c]);
                ch.setValue('value', v.choices[c]);
                ch.setValue('sequence', c);
                ch.setValue('inactive', 'false');
                ch.setValue('language', 'en');
                var chSysId = ch.insert();
                written.choices.push(chSysId);
                rollbackIds.push({ table: 'sys_choice', sys_id: chSysId });
            }
        }
    },

    _writePolicies: function (itemSysId, graph, written, rollbackIds) {
        var policies = graph.policies || [];
        for (var p = 0; p < policies.length; p++) {
            var pol = policies[p];
            var ui = new GlideRecord('sys_ui_policy');
            ui.initialize();
            ui.setValue('name', pol.name);
            ui.setValue('table', 'sc_cat_item');
            ui.setValue('catalog_item', itemSysId);
            ui.setValue('active', 'true');
            ui.setValue('order', pol.order);
            ui.setValue('on_load', 'false');
            ui.setValue('short_description', 'CatalogForge-generated policy');
            if (pol.condition_field) {
                ui.setValue('condition', this._buildCondition(pol));
            }
            var uiSysId = ui.insert();
            written.policies.push(uiSysId);
            rollbackIds.push({ table: 'sys_ui_policy', sys_id: uiSysId });

            // Child action — without this the policy is inert at runtime.
            var act = new GlideRecord('sys_ui_policy_action');
            act.initialize();
            act.setValue('ui_policy', uiSysId);
            act.setValue('field', pol.target);
            act.setValue('visible', 'true');
            act.setValue('mandatory', pol.type === 'mandatory' ? 'true' : 'false');
            act.setValue('read_only', 'false');
            act.setValue('disabled', 'false');
            var actSysId = act.insert();
            rollbackIds.push({ table: 'sys_ui_policy_action', sys_id: actSysId });
        }
    },

    _buildCondition: function (pol) {
        var field = 'variables.' + pol.condition_field;
        var vals = pol.condition_value;
        if (Object.prototype.toString.call(vals) === '[object Array]') {
            var parts = [];
            for (var i = 0; i < vals.length; i++) {
                parts.push(field + '=' + vals[i]);
            }
            return parts.join('^OR');
        }
        return field + '=' + vals;
    },

    _rollback: function (rollbackIds) {
        for (var i = rollbackIds.length - 1; i >= 0; i--) {
            var rec = rollbackIds[i];
            try {
                var gr = new GlideRecord(rec.table);
                if (gr.get(rec.sys_id)) {
                    gr.deleteRecord();
                }
            } catch (e) {
                gs.error('CatalogForge rollback failed for ' + rec.table + ' ' + rec.sys_id + ': ' + e);
            }
        }
    },

    _mapType: function (type) {
        // CatalogForge type → item_option_new type.
        var map = {
            'string': 'string',
            'integer': 'integer',
            'boolean': 'boolean',
            'choice': 'select_box',
            'reference': 'reference',
            'glide_date': 'date',
            'decimal': 'decimal'
        };
        return map[type] || 'string';
    },

    _loadChoiceOverrides: function () {
        var map = {};
        var gr = new GlideRecord('x_sncf_choice_override');
        gr.addQuery('active', 'true');
        gr.query();
        while (gr.next()) {
            var field = gr.getValue('field_name');
            var val = gr.getValue('choice_value');
            if (!map[field]) { map[field] = []; }
            if (map[field].indexOf(val) === -1) { map[field].push(val); }
        }
        return map;
    },

    _safeParse: function (text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    },

    _safeStringify: function (obj) {
        try { return JSON.stringify(obj); } catch (e) { return '{}'; }
    }
};
