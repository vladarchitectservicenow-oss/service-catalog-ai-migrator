// FlowForge — FlowForgeWriter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Persistence and commit layer of the FlowForge scoped application.
// Owns the two scoped tables (draft + config), the update-set XML export,
// and the direct Table API commit into the OOTB flow tables
// (sys_hub_flow, sys_hub_flow_version, sys_hub_flow_logic). It is the ONLY
// component that writes records — the engine (FlowForgeEngine) is pure.
//
// Dual import path:
//   exportUpdateSetXml(draftSysId)  → portable update-set XML (GUI/partner)
//   commit(draftSysId)              → direct Table API write (CI/CD pipeline)
// Both emit identical record content from the same draft graph.
//
// ES5-compatible (Rhino).
//
// @class FlowForgeWriter @namespace x_snff
var FlowForgeWriter = Class.create();
FlowForgeWriter.prototype = {

    DRAFT_TABLE: 'x_snff_flow_forge_draft',
    CONFIG_TABLE: 'x_snff_flow_forge_config',
    FLOW_TABLE: 'sys_hub_flow',
    FLOW_VERSION_TABLE: 'sys_hub_flow_version',
    FLOW_LOGIC_TABLE: 'sys_hub_flow_logic',
    ACTION_SNAPSHOT_TABLE: 'sys_hub_action_type_snapshot',
    SNAPSHOT_TABLE: 'sys_hub_flow_snapshot',

    initialize: function () {
        this.engine = new FlowForgeEngine();
    },

    // ----------------------------------------------------------------------
    // PROPOSE — run the engine, persist a draft, return the preview.
    // ----------------------------------------------------------------------
    propose: function (rawSpec, userId) {
        var parsed = this.engine.parseSpec(rawSpec);
        if (!parsed.ok) {
            return { ok: false, error: parsed.error, message: parsed.message };
        }

        var spec = parsed.spec;
        var category = this._defaultCategory();
        var generated = this.engine.generateFlow(spec, category);

        if (!generated.ok) {
            return {
                ok: false,
                error: 'VALIDATION_FAILED',
                message: 'Generated flow failed structural validation',
                validation: generated.validation
            };
        }

        var fingerprint = this.engine.fingerprint(spec);
        var draftSysId = this._saveDraft(spec, generated, fingerprint, userId);

        return {
            ok: true,
            draft_sys_id: draftSysId,
            fingerprint: fingerprint,
            preview: this.engine.renderPreview(generated),
            validation: generated.validation,
            step_count: generated.steps.length
        };
    },

    // ----------------------------------------------------------------------
    // COMMIT — write the draft's graph directly to the OOTB flow tables.
    // Returns the new flow + version sys_ids.
    // ----------------------------------------------------------------------
    commit: function (draftSysId) {
        var draft = this._loadDraft(draftSysId);
        if (!draft) {
            return { ok: false, error: 'NOT_FOUND', message: 'Draft ' + draftSysId + ' not found' };
        }

        var generated = this._rehydrate(draft);
        if (!generated.ok) {
            return { ok: false, error: 'REHYDRATE_FAILED', message: generated.message };
        }

        try {
            var flowSysId = this._insertFlow(generated.flow);
            var status = this._commitMode() === 'published' ? 'published' : 'draft';
            var versionSysId = this._insertFlowVersion(generated.version, flowSysId, status);
            var logicIds = this._insertFlowLogic(generated.logic, flowSysId, versionSysId);
            var snapshotSysId = this._insertFlowSnapshot(generated.version, flowSysId);

            // Record the commit on the draft for audit.
            var gr = new GlideRecord(this.DRAFT_TABLE);
            if (gr.get(draftSysId)) {
                gr.setValue('status', 'committed');
                gr.setValue('committed_flow_sys_id', flowSysId);
                gr.setValue('committed_version_sys_id', versionSysId);
                gr.setWorkflow(false);
                gr.update();
            }

            return {
                ok: true,
                flow_sys_id: flowSysId,
                version_sys_id: versionSysId,
                snapshot_sys_id: snapshotSysId,
                logic_record_count: logicIds.length
            };
        } catch (e) {
            return { ok: false, error: 'COMMIT_FAILED', message: String(e) };
        }
    },

    // ----------------------------------------------------------------------
    // EXPORT — emit a portable update-set XML bundle for the draft.
    // ----------------------------------------------------------------------
    exportUpdateSetXml: function (draftSysId) {
        var draft = this._loadDraft(draftSysId);
        if (!draft) {
            return { ok: false, error: 'NOT_FOUND', message: 'Draft ' + draftSysId + ' not found' };
        }

        var generated = this._rehydrate(draft);
        if (!generated.ok) {
            return { ok: false, error: 'REHYDRATE_FAILED', message: generated.message };
        }

        var xml = this._buildUpdateSetXml(generated);

        return {
            ok: true,
            file_name: 'flow_forge_' + this._slugify(generated.flow.name) + '.xml',
            xml: xml,
            byte_count: xml.length
        };
    },

    // ----------------------------------------------------------------------
    // RESOLVE ACTION RECORD — bind a catalog action to a live
    // sys_hub_action_type_snapshot sys_id (integration hub action snapshot).
    // Returns '' if not resolvable (author must supply a custom action).
    // ----------------------------------------------------------------------
    resolveActionRecord: function (actionName) {
        var gr = new GlideRecord(this.ACTION_SNAPSHOT_TABLE);
        gr.addQuery('name', actionName);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return '';
    },

    // ----------------------------------------------------------------------
    // Internal: draft persistence
    // ----------------------------------------------------------------------
    _saveDraft: function (spec, generated, fingerprint, userId) {
        var gr = new GlideRecord(this.DRAFT_TABLE);
        gr.initialize();
        gr.setValue('name', spec.name);
        gr.setValue('description', spec.description || spec.name);
        gr.setValue('status', 'proposed');
        gr.setValue('fingerprint', fingerprint);
        gr.setValue('engine_version', this.engine.ENGINE_VERSION);
        gr.setValue('trigger_type', generated.version.flow_trigger_type);
        gr.setValue('step_count', generated.steps.length);
        gr.setValue('spec_json', JSON.stringify(spec));
        gr.setValue('graph_json', JSON.stringify(generated));
        gr.setValue('preview', this.engine.renderPreview(generated));
        gr.setValue('requestor', userId || gs.getUserID());
        var sysId = gr.insert();
        return sysId;
    },

    _loadDraft: function (draftSysId) {
        if (!draftSysId) { return null; }
        var gr = new GlideRecord(this.DRAFT_TABLE);
        if (!gr.get(draftSysId)) { return null; }
        return {
            sys_id: gr.getUniqueValue(),
            name: gr.getValue('name'),
            spec_json: gr.getValue('spec_json'),
            graph_json: gr.getValue('graph_json'),
            status: gr.getValue('status')
        };
    },

    // Rebuild the generated graph from the stored draft (or regenerate from
    // the stored spec if the graph blob is missing/empty).
    _rehydrate: function (draft) {
        var generated = this._safeParse(draft.graph_json);
        if (generated && generated.flow && generated.logic) {
            return {
                ok: true,
                flow: generated.flow,
                version: generated.version,
                logic: generated.logic,
                steps: generated.steps || [],
                validation: generated.validation || { errors: [], warnings: [] }
            };
        }
        // Fallback: regenerate deterministically from the stored spec.
        var parsed = this.engine.parseSpec(draft.spec_json);
        if (!parsed.ok) {
            return { ok: false, message: 'Stored spec could not be parsed: ' + parsed.message };
        }
        var g = this.engine.generateFlow(parsed.spec);
        if (!g.ok) {
            return { ok: false, message: 'Regenerated flow failed validation' };
        }
        return {
            ok: true,
            flow: g.flow,
            version: g.version,
            logic: g.logic,
            steps: g.steps,
            validation: g.validation
        };
    },

    // ----------------------------------------------------------------------
    // Internal: direct Table API inserts (guarded)
    // ----------------------------------------------------------------------
    _insertFlow: function (flow) {
        var gr = new GlideRecord(this.FLOW_TABLE);
        gr.initialize();
        gr.setValue('name', flow.name);
        gr.setValue('description', flow.description);
        gr.setValue('active', flow.active);
        gr.setValue('category', flow.category);
        gr.setValue('run_as', flow.run_as);
        gr.setValue('type', 'flow');
        var sysId = gr.insert();
        return sysId;
    },

    _insertFlowVersion: function (version, flowSysId, status) {
        var gr = new GlideRecord(this.FLOW_VERSION_TABLE);
        gr.initialize();
        gr.setValue('name', version.name);
        gr.setValue('description', version.description);
        gr.setValue('flow', flowSysId);
        gr.setValue('status', status || version.status || 'draft');
        gr.setValue('version', version.version);
        if (version.trigger_table) { gr.setValue('table', version.trigger_table); }
        if (version.trigger_condition) { gr.setValue('condition', version.trigger_condition); }
        if (version.trigger_operation) { gr.setValue('operation', version.trigger_operation); }
        var sysId = gr.insert();
        return sysId;
    },

    _insertFlowLogic: function (logic, flowSysId, versionSysId) {
        var ids = [];
        for (var i = 0; i < logic.length; i++) {
            var l = logic[i];
            var actionSysId = this.resolveActionRecord(l.action_type);
            var gr = new GlideRecord(this.FLOW_LOGIC_TABLE);
            gr.initialize();
            gr.setValue('name', l.name);
            gr.setValue('flow', flowSysId);
            gr.setValue('flow_version', versionSysId);
            // action_type is a reference to sys_hub_action_type_snapshot —
            // bind the resolved sys_id, not the display string.
            gr.setValue('action_type', actionSysId);
            if (l.action_table) { gr.setValue('table', l.action_table); }
            gr.setValue('order', l.order);
            if (l.condition) { gr.setValue('condition', l.condition); }
            gr.setValue('on_error', l.on_error || 'continue');
            var logicSysId = gr.insert();
            if (logicSysId) {
                this._insertLogicPills(l, logicSysId);
            }
            ids.push(logicSysId);
        }
        return ids;
    },

    _insertFlowSnapshot: function (version, flowSysId) {
        var gr = new GlideRecord(this.SNAPSHOT_TABLE);
        gr.initialize();
        gr.setValue('name', version.name);
        gr.setValue('flow', flowSysId);
        gr.setValue('status', 'draft');
        return gr.insert();
    },

    // Flow Designer data-pill bindings live on child tables, not string columns
    // on the parent. Emit input/output pill records for each bound value.
    _insertLogicPills: function (logic, logicSysId) {
        var field;
        var inputs = logic.inputs || {};
        for (field in inputs) {
            if (!inputs.hasOwnProperty(field)) { continue; }
            var value = inputs[field];
            if (value === undefined || value === '') { continue; }
            var igr = new GlideRecord('sys_hub_flow_logic_input');
            igr.initialize();
            igr.setValue('flow_logic', logicSysId);
            igr.setValue('name', field);
            igr.setValue('value', JSON.stringify(value));
            igr.insert();
        }
        var outputs = logic.outputs || {};
        for (field in outputs) {
            if (!outputs.hasOwnProperty(field)) { continue; }
            var oval = outputs[field];
            if (oval === undefined || oval === '') { continue; }
            var ogr = new GlideRecord('sys_hub_flow_logic_output');
            ogr.initialize();
            ogr.setValue('flow_logic', logicSysId);
            ogr.setValue('name', field);
            ogr.setValue('value', JSON.stringify(oval));
            ogr.insert();
        }
    },

    // ----------------------------------------------------------------------
    // Internal: update-set XML construction
    // ----------------------------------------------------------------------
    _buildUpdateSetXml: function (generated) {
        var e = this.engine;
        var flow = generated.flow;
        var version = generated.version;
        var logic = generated.logic;

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<unload unload_date="' + this._now() + '">\n';
        xml += '  <sys_remote_update_set action="INSERT_OR_UPDATE">\n';
        xml += '    <name>FlowForge - ' + e._escapeXml(flow.name) + '</name>\n';
        xml += '    <application display_value="FlowForge">x_snff</application>\n';
        xml += '    <application_name>FlowForge</application_name>\n';
        xml += '  </sys_remote_update_set>\n';

        // Flow record
        xml += '  <sys_hub_flow action="INSERT_OR_UPDATE">\n';
        xml += '    <name>' + e._escapeXml(flow.name) + '</name>\n';
        xml += '    <description>' + e._escapeXml(flow.description) + '</description>\n';
        xml += '    <active>true</active>\n';
        xml += '    <category>' + e._escapeXml(flow.category) + '</category>\n';
        xml += '    <run_as>user_initiator</run_as>\n';
        xml += '  </sys_hub_flow>\n';

        // Version record
        xml += '  <sys_hub_flow_version action="INSERT_OR_UPDATE">\n';
        xml += '    <name>' + e._escapeXml(version.name) + '</name>\n';
        xml += '    <description>' + e._escapeXml(version.description) + '</description>\n';
        xml += '    <status>draft</status>\n';
        xml += '    <type>' + e._escapeXml(version.flow_trigger_type) + '</type>\n';
        if (version.trigger_table) { xml += '    <table>' + e._escapeXml(version.trigger_table) + '</table>\n'; }
        if (version.trigger_condition) { xml += '    <condition>' + e._escapeXml(version.trigger_condition) + '</condition>\n'; }
        if (version.trigger_operation) { xml += '    <operation>' + e._escapeXml(version.trigger_operation) + '</operation>\n'; }
        xml += '  </sys_hub_flow_version>\n';

        // Logic records
        for (var i = 0; i < logic.length; i++) {
            var l = logic[i];
            xml += '  <sys_hub_flow_logic action="INSERT_OR_UPDATE">\n';
            xml += '    <name>' + e._escapeXml(l.name) + '</name>\n';
            xml += '    <action_type>' + e._escapeXml(l.action_type) + '</action_type>\n';
            if (l.action_table) { xml += '    <table>' + e._escapeXml(l.action_table) + '</table>\n'; }
            xml += '    <order>' + l.order + '</order>\n';
            xml += '    <inputs>' + e._escapeXml(JSON.stringify(l.inputs)) + '</inputs>\n';
            xml += '    <outputs>' + e._escapeXml(JSON.stringify(l.outputs)) + '</outputs>\n';
            xml += '    <on_error>' + e._escapeXml(l.on_error || 'continue') + '</on_error>\n';
            xml += '  </sys_hub_flow_logic>\n';
        }

        xml += '</unload>\n';
        return xml;
    },

    // ----------------------------------------------------------------------
    // Config accessors — read/write the scoped config table (single row).
    // ----------------------------------------------------------------------
    _defaultCategory: function () {
        var cfg = this.getConfig();
        return (cfg && cfg.default_category) || 'Process Automation';
    },

    _commitMode: function () {
        var cfg = this.getConfig();
        return (cfg && cfg.commit_mode) || 'draft';
    },

    getConfig: function () {
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return {
                sys_id: gr.getUniqueValue(),
                default_category: gr.getValue('default_category'),
                commit_mode: gr.getValue('commit_mode'),
                llm_enabled: gr.getValue('llm_enabled'),
                llm_provider: gr.getValue('llm_provider')
            };
        }
        return null;
    },

    setConfig: function (values) {
        var gr = new GlideRecord(this.CONFIG_TABLE);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            if (values.default_category !== undefined) { gr.setValue('default_category', values.default_category); }
            if (values.commit_mode !== undefined) { gr.setValue('commit_mode', values.commit_mode); }
            if (values.llm_enabled !== undefined) { gr.setValue('llm_enabled', values.llm_enabled); }
            if (values.llm_provider !== undefined) { gr.setValue('llm_provider', values.llm_provider); }
            gr.setWorkflow(false);
            return gr.update();
        }
        // Insert a fresh singleton row.
        gr.initialize();
        gr.setValue('default_category', values.default_category || 'Process Automation');
        gr.setValue('commit_mode', values.commit_mode || 'draft');
        gr.setValue('llm_enabled', values.llm_enabled !== undefined ? values.llm_enabled : false);
        gr.setValue('llm_provider', values.llm_provider || '');
        return gr.insert();
    },

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------
    _safeParse: function (text) {
        if (!text) { return null; }
        try { return JSON.parse(text); } catch (e) { return null; }
    },

    _slugify: function (s) {
        return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'flow';
    },

    _now: function () {
        var gdt = new GlideDateTime();
        return gdt.getValue();
    },

    type: 'FlowForgeWriter'
};
