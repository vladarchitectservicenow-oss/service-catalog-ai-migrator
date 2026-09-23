// FlowForge — FlowForgeEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic generator core of the FlowForge scoped application.
// Turns a canonical FlowSpec (JSON) into a complete, consistent Flow Designer
// record graph: sys_hub_flow + sys_hub_flow_version + sys_hub_flow_logic, with
// resolved spoke/action references and data-pill bindings correct by construction.
//
// This Script Include is PURE computation — it never writes to scoped tables,
// never writes to OOTB flow tables, and never mutates platform records. All
// persistence and commit work is the responsibility of FlowForgeWriter.
//
// The LLM (GenAI Controller / Now Assist, BYOK) is confined to producing the
// FlowSpec; it NEVER emits records. This class is the deterministic, testable
// guardrail that turns that spec into records.
//
// All logic is ES5-compatible (Rhino): no arrow functions, no let/const, no
// template literals, no Object.values, no Object.entries, no for...of.
//
// @class FlowForgeEngine @namespace x_snff
var FlowForgeEngine = Class.create();
FlowForgeEngine.prototype = {

    ENGINE_VERSION: '1.0.0',

    // ----------------------------------------------------------------------
    // FlowSpec contract — the single source of truth. A FlowSpec is a JSON
    // object; every generated flow is a pure function of it.
    // ----------------------------------------------------------------------
    FLOWSPEC_REQUIRED_KEYS: ['name'],

    // ----------------------------------------------------------------------
    // TRIGGER CATALOG — maps an intent token to the platform trigger type.
    // Values are the canonical Flow Designer trigger `trigger_type` strings.
    // ----------------------------------------------------------------------
    TRIGGER_CATALOG: {
        'record created':    { trigger_type: 'record', operation: 'created' },
        'record updated':    { trigger_type: 'record', operation: 'updated' },
        'record deleted':    { trigger_type: 'record', operation: 'deleted' },
        'scheduled':         { trigger_type: 'scheduled' },
        'schedule':          { trigger_type: 'scheduled' },
        'inbound email':     { trigger_type: 'email' },
        'rest api':          { trigger_type: 'rest' },
        'application':      { trigger_type: 'app' },
        'metricbase':        { trigger_type: 'metric' }
    },

    // ----------------------------------------------------------------------
    // ACTION CATALOG — maps an intent token ("create incident", "send email",
    // "ask for approval", ...) to a canonical IntegrationHub action. The
    // resolver binds these to real sys_hub_action_type_snapshot records at
    // generation time (see resolveAction). Unmatched tokens surface as
    // validation errors — never as a silently hallucinated reference.
    // ----------------------------------------------------------------------
    ACTION_CATALOG: {
        'create incident':      { action: 'Create Record', table: 'incident' },
        'create record':        { action: 'Create Record', table: '' },
        'update incident':      { action: 'Update Record', table: 'incident' },
        'update record':        { action: 'Update Record', table: '' },
        'create task':          { action: 'Create Task', table: '' },
        'create change':        { action: 'Create Record', table: 'change_request' },
        'create problem':       { action: 'Create Record', table: 'problem' },
        'send email':           { action: 'Send Email', table: '' },
        'send notification':    { action: 'Send Notification', table: '' },
        'send sms':             { action: 'Send SMS', table: '' },
        'send text':            { action: 'Send SMS', table: '' },
        'ask for approval':     { action: 'Ask for Approval', table: '' },
        'approval':             { action: 'Ask for Approval', table: '' },
        'lookup user':          { action: 'Look Up User', table: '' },
        'look up user':         { action: 'Look Up User', table: '' },
        'lookup record':        { action: 'Look Up Record', table: '' },
        'look up record':       { action: 'Look Up Record', table: '' },
        'lookup incident':      { action: 'Look Up Record', table: 'incident' },
        'wait for condition':   { action: 'Wait For Condition', table: '' },
        'sleep':                { action: 'Wait For Condition', table: '' },
        'log message':          { action: 'Log Message', table: '' },
        'create jira issue':    { action: 'Create Issue', table: '' },
        'page on-call':         { action: 'Send SMS', table: '' },
        'page on call':         { action: 'Send SMS', table: '' },
        'rest call':            { action: 'REST Message', table: '' },
        'webhook':              { action: 'REST Message', table: '' }
    },

    // Curated input-pill mappings per action — the fields each action expects.
    ACTION_INPUTS: {
        'Create Record':   ['table', 'field_values'],
        'Update Record':   ['table', 'record_sys_id', 'field_values'],
        'Create Task':     ['assignment_group', 'assigned_to', 'short_description', 'description'],
        'Send Email':      ['to', 'subject', 'body'],
        'Send Notification': ['recipients', 'message'],
        'Send SMS':        ['phone_number', 'message'],
        'Ask for Approval': ['approval_rule', 'approvers', 'instructions'],
        'Look Up User':    ['user_name', 'user_sys_id'],
        'Look Up Record':  ['table', 'query'],
        'Wait For Condition': ['condition', 'timeout'],
        'Log Message':     ['message', 'level'],
        'Create Issue':    ['project', 'summary', 'description'],
        'REST Message':    ['endpoint', 'method', 'body']
    },

    // Output-pill mappings — the field each action returns into the flow.
    ACTION_OUTPUTS: {
        'Create Record':   'record_sys_id',
        'Update Record':   'record_sys_id',
        'Create Task':     'task_sys_id',
        'Look Up User':    'user_sys_id',
        'Look Up Record':  'record_sys_id',
        'Create Issue':    'issue_key',
        'Ask for Approval': 'approval_result'
    },

    initialize: function () {
    },

    // ----------------------------------------------------------------------
    // SPEC PARSER
    // Accepts a JSON string or object. Returns { ok, spec } with normalized
    // fields, or { ok: false, error, message }.
    // ----------------------------------------------------------------------
    parseSpec: function (raw) {
        var obj = null;

        if (raw === undefined || raw === null || raw === '') {
            return { ok: false, error: 'EMPTY_SPEC', message: 'No FlowSpec provided' };
        }

        if (typeof raw === 'string') {
            var text = raw.trim();
            if (!text) {
                return { ok: false, error: 'EMPTY_SPEC', message: 'No FlowSpec provided' };
            }
            obj = this._safeParse(text);
            if (obj === null) {
                return { ok: false, error: 'BAD_JSON', message: 'FlowSpec JSON could not be parsed' };
            }
        } else if (typeof raw === 'object') {
            obj = raw;
        } else {
            return { ok: false, error: 'BAD_SPEC', message: 'FlowSpec must be a JSON string or object' };
        }

        return this.normalizeSpec(obj);
    },

    normalizeSpec: function (obj) {
        var missing = [];
        for (var i = 0; i < this.FLOWSPEC_REQUIRED_KEYS.length; i++) {
            var key = this.FLOWSPEC_REQUIRED_KEYS[i];
            if (!obj[key]) { missing.push(key); }
        }
        if (missing.length > 0) {
            return { ok: false, error: 'MISSING_KEYS', message: 'FlowSpec missing required key(s): ' + missing.join(', ') };
        }

        var spec = {
            name: (obj.name || '').toString().trim(),
            description: (obj.description || '').toString().trim(),
            table: (obj.table || '').toString().trim(),
            trigger: this._normalizeTrigger(obj.trigger),
            inputs: this._normalizeInputs(obj.inputs),
            steps: this._normalizeSteps(obj.steps),
            approvals: this._normalizeApprovals(obj.approvals),
            outputs: this._normalizeOutputs(obj.outputs)
        };

        return { ok: true, spec: spec };
    },

    _normalizeTrigger: function (trigger) {
        if (!trigger) { return { trigger_type: 'scheduled' }; }
        if (typeof trigger === 'string') {
            var key = this._normalizeToken(trigger);
            return this.TRIGGER_CATALOG[key] || { trigger_type: trigger.toLowerCase() };
        }
        var tt = (trigger.trigger_type || trigger.type || '').toString();
        var normalized = this.TRIGGER_CATALOG[this._normalizeToken(tt)];
        if (normalized) {
            normalized.condition = trigger.condition || '';
            normalized.table = trigger.table || '';
            return normalized;
        }
        return {
            trigger_type: tt.toLowerCase(),
            operation: trigger.operation || '',
            condition: trigger.condition || '',
            table: trigger.table || ''
        };
    },

    _normalizeInputs: function (inputs) {
        var out = [];
        if (!inputs || !this._isArray(inputs)) { return out; }
        for (var i = 0; i < inputs.length; i++) {
            var v = inputs[i];
            if (!v || typeof v !== 'object') { continue; }
            out.push({
                name: this._normalizeFieldName(v.name || v.label || ('input_' + (i + 1))),
                label: (v.label || v.name || ('Input ' + (i + 1))).toString(),
                type: (v.type || 'string').toString(),
                mandatory: v.mandatory === true,
                default_value: v.default_value || ''
            });
        }
        return out;
    },

    _normalizeSteps: function (steps) {
        var out = [];
        if (!steps || !this._isArray(steps)) { return out; }
        for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            if (!s || typeof s !== 'object') { continue; }
            out.push({
                order: i + 1,
                action_token: (s.action || s.action_token || s.intent || '').toString(),
                name: (s.name || s.label || '').toString(),
                inputs: s.inputs || {},
                condition: s.condition || '',
                on_error: (s.on_error || 'continue').toString()
            });
        }
        return out;
    },

    _normalizeApprovals: function (approvals) {
        var out = [];
        if (!approvals || !this._isArray(approvals)) { return out; }
        for (var i = 0; i < approvals.length; i++) {
            var a = approvals[i];
            if (!a) { continue; }
            if (typeof a === 'string') {
                out.push({ approver: a, group: '', wait_for: 'any' });
            } else {
                out.push({
                    approver: (a.approver || a.user || '').toString(),
                    group: (a.group || '').toString(),
                    wait_for: (a.wait_for || 'any').toString()
                });
            }
        }
        return out;
    },

    _normalizeOutputs: function (outputs) {
        var out = [];
        if (!outputs || !this._isArray(outputs)) { return out; }
        for (var i = 0; i < outputs.length; i++) {
            var o = outputs[i];
            if (!o) { continue; }
            if (typeof o === 'string') {
                out.push({ name: o, type: 'string' });
            } else {
                out.push({ name: (o.name || '').toString(), type: (o.type || 'string').toString() });
            }
        }
        return out;
    },

    // ----------------------------------------------------------------------
    // CATALOG RESOLVER — binds an intent token to a real action type.
    // Returns { ok, resolved } where resolved = { action, table, inputs[],
    // output } or { ok: false, error, message } for an unknown token.
    // The binding to a live sys_hub_action_type_snapshot sys_id is performed
    // by the writer at commit time (see FlowForgeWriter.resolveActionRecord).
    // ----------------------------------------------------------------------
    resolveAction: function (token) {
        var key = this._normalizeToken(token);
        var entry = this.ACTION_CATALOG[key];

        if (!entry) {
            return {
                ok: false,
                error: 'UNKNOWN_ACTION',
                message: 'No catalog mapping for action token "' + token + '". ' +
                         'Use a known intent (e.g. "create incident", "send email", "ask for approval") ' +
                         'or register a custom action in the FlowForge catalog.'
            };
        }

        return {
            ok: true,
            resolved: {
                action_token: key,
                action: entry.action,
                table: entry.table,
                inputs: this.ACTION_INPUTS[entry.action] || [],
                output: this.ACTION_OUTPUTS[entry.action] || ''
            }
        };
    },

    // ----------------------------------------------------------------------
    // GENERATOR CORE — builds the sys_hub_flow / _version / _logic record
    // graph from a normalized spec. Pure data construction; no DB access.
    // Returns { ok, flow, version, logic, steps }.
    // ----------------------------------------------------------------------
    generateFlow: function (spec, category) {
        var flow = {
            name: spec.name,
            description: spec.description || spec.name,
            active: true,
            category: category || 'Process Automation',
            run_as: 'user_initiator'
        };

        var version = {
            name: spec.name,
            description: spec.description || spec.name,
            status: 'draft',
            version: 1,
            flow_trigger_type: spec.trigger.trigger_type || 'scheduled',
            trigger_table: spec.trigger.table || spec.table || '',
            trigger_condition: spec.trigger.condition || '',
            trigger_operation: spec.trigger.operation || ''
        };

        // Resolve and validate every step against the catalog BEFORE emitting
        // logic records. This is the "correct by construction" guardrail.
        var resolvedSteps = [];
        var validation = { errors: [], warnings: [] };

        for (var i = 0; i < spec.steps.length; i++) {
            var step = spec.steps[i];
            var resolution = this.resolveAction(step.action_token);
            if (!resolution.ok) {
                validation.errors.push('Step ' + step.order + ': ' + resolution.message);
                continue;
            }
            resolvedSteps.push({
                order: step.order,
                name: step.name || resolution.resolved.action,
                action: resolution.resolved.action,
                table: resolution.resolved.table,
                action_token: resolution.resolved.action_token,
                inputs: step.inputs || {},
                input_fields: resolution.resolved.inputs,
                output: resolution.resolved.output,
                condition: step.condition || '',
                on_error: step.on_error || 'continue'
            });
        }

        // Approvals: append as steps (Ask for Approval) when present.
        for (var a = 0; a < spec.approvals.length; a++) {
            var appr = spec.approvals[a];
            resolvedSteps.push({
                order: resolvedSteps.length + 1,
                name: 'Approval: ' + (appr.approver || appr.group || 'pending'),
                action: 'Ask for Approval',
                table: '',
                action_token: 'ask for approval',
                inputs: {
                    approvers: appr.approver || '',
                    approval_group: appr.group || '',
                    instructions: 'Please approve this request'
                },
                input_fields: this.ACTION_INPUTS['Ask for Approval'] || [],
                output: 'approval_result',
                condition: '',
                on_error: 'continue'
            });
        }

        // Build logic records (one per step).
        var logic = [];
        for (var l = 0; l < resolvedSteps.length; l++) {
            var rs = resolvedSteps[l];
            logic.push({
                order: rs.order,
                name: rs.name,
                action_type: rs.action,
                action_table: rs.table,
                inputs: this._bindInputPills(rs),
                outputs: this._bindOutputPill(rs),
                condition: rs.condition,
                on_error: rs.on_error
            });
        }

        // Structural validation on the final graph.
        var struct = this.validateGraph(resolvedSteps, spec.outputs);
        validation.errors = validation.errors.concat(struct.errors);
        validation.warnings = validation.warnings.concat(struct.warnings);

        return {
            ok: validation.errors.length === 0,
            flow: flow,
            version: version,
            logic: logic,
            steps: resolvedSteps,
            validation: validation
        };
    },

    _bindInputPills: function (step) {
        var pills = {};
        var provided = step.inputs || {};
        for (var i = 0; i < step.input_fields.length; i++) {
            var field = step.input_fields[i];
            if (provided[field] !== undefined) {
                pills[field] = provided[field];
            } else if (field === 'table' && step.table) {
                pills[field] = step.table;
            }
            // Unfilled fields are left for the author — the validator flags
            // mandatory unfilled pills.
        }
        return pills;
    },

    _bindOutputPill: function (step) {
        if (!step.output) { return {}; }
        var out = {};
        out[step.output] = step.name;
        return out;
    },

    // ----------------------------------------------------------------------
    // STRUCTURAL VALIDATION — catches unbound mandatory pills and unresolved
    // references before any record is emitted. Read-only.
    // ----------------------------------------------------------------------
    validateGraph: function (steps, outputs) {
        var errors = [];
        var warnings = [];

        if (!steps || steps.length === 0) {
            errors.push('Flow has no steps. A FlowSpec must define at least one action step.');
            return { errors: errors, warnings: warnings };
        }

        // Flag steps whose mandatory input pills are unbound.
        for (var i = 0; i < steps.length; i++) {
            var step = steps[i];
            var filled = step.inputs || {};
            for (var f = 0; f < step.input_fields.length; f++) {
                var field = step.input_fields[f];
                var isFilled = filled[field] !== undefined && filled[field] !== '';
                var isTableField = (field === 'table');
                if (!isFilled && !isTableField) {
                    warnings.push('Step ' + step.order + ' ("' + step.name + '"): input pill "' + field + '" is unbound');
                }
            }
        }

        // Warn on empty outputs (flow produces nothing).
        if (!outputs || outputs.length === 0) {
            warnings.push('Flow defines no explicit outputs. The final step result will be the only return value.');
        }

        return { errors: errors, warnings: warnings };
    },

    // ----------------------------------------------------------------------
    // DRY-RUN PREVIEW — renders the generated flow structure as a readable
    // summary (steps, branches, action wiring, data-pill bindings). No writes.
    // ----------------------------------------------------------------------
    renderPreview: function (result) {
        var lines = [];
        lines.push('Flow: ' + result.flow.name);
        lines.push('Description: ' + (result.flow.description || ''));
        lines.push('Trigger: ' + result.version.flow_trigger_type +
                   (result.version.trigger_table ? ' on ' + result.version.trigger_table : '') +
                   (result.version.trigger_operation ? ' [' + result.version.trigger_operation + ']' : ''));
        lines.push('');
        lines.push('Steps (' + result.steps.length + '):');

        for (var i = 0; i < result.steps.length; i++) {
            var s = result.steps[i];
            lines.push('  ' + s.order + '. ' + s.name + '  ->  ' + s.action +
                       (s.table ? ' (' + s.table + ')' : ''));
            var keys = [];
            var inputs = s.inputs || {};
            for (var k in inputs) {
                if (inputs.hasOwnProperty(k) && inputs[k] !== '') { keys.push(k + '=' + inputs[k]); }
            }
            if (keys.length > 0) { lines.push('       pills: ' + keys.join(', ')); }
        }

        if (result.validation.errors.length > 0) {
            lines.push('');
            lines.push('Validation errors:');
            for (var e = 0; e < result.validation.errors.length; e++) {
                lines.push('  - ' + result.validation.errors[e]);
            }
        }
        if (result.validation.warnings.length > 0) {
            lines.push('');
            lines.push('Validation warnings:');
            for (var w = 0; w < result.validation.warnings.length; w++) {
                lines.push('  - ' + result.validation.warnings[w]);
            }
        }

        return lines.join('\n');
    },

    // ----------------------------------------------------------------------
    // FINGERPRINT — deterministic content hash of the spec, used for draft
    // dedup and drift detection. Portable JS (no GlideDigest dependency), so
    // it works identically in Rhino and Node.
    // ----------------------------------------------------------------------
    fingerprint: function (spec) {
        var canonical = JSON.stringify(spec);
        var hash = 0;
        for (var i = 0; i < canonical.length; i++) {
            var ch = canonical.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash |= 0;
        }
        return 'ff_' + (hash >>> 0).toString(16) + '_' + canonical.length.toString(16);
    },

    // ----------------------------------------------------------------------
    // HELPERS
    // ----------------------------------------------------------------------
    _safeParse: function (text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    },

    _isArray: function (v) {
        return Object.prototype.toString.call(v) === '[object Array]';
    },

    _normalizeToken: function (s) {
        return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    },

    _normalizeFieldName: function (s) {
        return this._normalizeToken(s).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    },

    _escapeXml: function (s) {
        return (s === undefined || s === null) ? '' :
            String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                     .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                     .replace(/'/g, '&apos;');
    },

    type: 'FlowForgeEngine'
};
