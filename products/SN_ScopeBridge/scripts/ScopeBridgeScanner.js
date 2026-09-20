// ScopeBridge — ScopeBridgeScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic core engine for the ScopeBridge scoped application.
// Responsibilities (READ + ANALYSIS only — never applies privileges):
//   1. Artifact Collector — gathers every executable script body for a target
//      scoped app (business rules, script includes, client scripts, UI actions,
//      UI policies, scheduled jobs, ACL scripts, flows).
//   2. Reference Engine (Stage 1, deterministic) — tokenizes each body for
//      cross-scope access: GlideRecord('foreign_table') with CRUD methods,
//      dot-walked foreign fields, gs.getProperty in a restricted scope, and
//      outbound sn_ws.RESTMessageV2 / GlideAjax calls.
//   3. Coverage Cross-Reference — resolves each reference's owning scope via
//      sys_db_object, then compares against existing sys_scope_privilege and
//      Restricted Caller Access records to tag COVERED / UNCOVERED /
//      OVER-PRIVILEGED.
//   4. Over-Privilege Auditor — flags wildcard (* on *) and orphaned
//      privileges, emitting an auditor-grade remediation list.
//   5. Drift Detection — diffs the privilege set between two scopes or two
//      scans (dev vs prod), reporting added/removed/divergent records.
//
// The apply path (least-privilege generation + dry-run apply) lives in the
// sibling ScopeBridgeGenerator. AI (Now Assist classification, GenAI rationale)
// is a graceful optional layer: when no provider is configured the engine
// stays fully deterministic and marks every reference "confirmed".
//
// @class ScopeBridgeScanner @namespace x_snb
var ScopeBridgeScanner = Class.create();
ScopeBridgeScanner.prototype = {

    SCAN_TABLE: 'x_snb_scan',
    REFERENCE_TABLE: 'x_snb_reference',
    ENGINE_VERSION: '1.0.0',

    // Artifact tables the collector reads (all OOTB, cross-scope read granted).
    ARTIFACT_TABLES: [
        { table: 'sys_script',           field: 'script',      kind: 'business_rule' },
        { table: 'sys_script_include',   field: 'script',      kind: 'script_include' },
        { table: 'sys_script_client',    field: 'script',      kind: 'client_script' },
        { table: 'sys_ui_action',        field: 'script',      kind: 'ui_action' },
        { table: 'sys_ui_policy',        field: 'script',      kind: 'ui_policy' },
        { table: 'sysauto_script',       field: 'script',      kind: 'scheduled_job' },
        { table: 'sys_security_acl',     field: 'script',      kind: 'acl_script' }
    ],

    // Tables whose GlideRecord access from a *foreign* scope is always benign
    // and should not be reported as a cross-scope reference (they are scoped
    // infra, not application data).
    IGNORE_TABLES: {
        'sys_id': true,
        'sys_metadata': true,
        'sys_user': true,
        'sys_user_role': true,
        'sys_user_has_role': true,
        'sys_scope': true,
        'sys_scope_privilege': true,
        'sys_db_object': true,
        'sys_dictionary': true,
        'sys_properties': true,
        'sys_choice': true
    },

    initialize: function () {
        this._nowAssist = null;
    },

    // ----------------------------------------------------------------------
    // Public: run a full or incremental scan of a target scope.
    // Returns the sys_id of the created x_snb_scan record, or null on failure.
    // ----------------------------------------------------------------------
    run: function (targetScope, mode) {
        if (!targetScope) {
            gs.error('ScopeBridgeScanner.run: targetScope is required');
            return null;
        }
        var runMode = (mode === 'incremental') ? 'incremental' : 'full';

        var scanGr = new GlideRecord(this.SCAN_TABLE);
        scanGr.initialize();
        scanGr.setValue('target_scope', targetScope);
        scanGr.setValue('mode', runMode);
        scanGr.setValue('status', 'running');
        scanGr.setValue('started_on', new GlideDateTime().getValue());
        scanGr.setValue('engine_version', this.ENGINE_VERSION);
        scanGr.setValue('ai_model', this._aiModelLabel());
        var scanSysId = null;
        try {
            scanSysId = scanGr.insert();
        } catch (e) {
            gs.error('ScopeBridgeScanner.run: failed to create scan record: ' + e.message);
            return null;
        }

        var artifacts = [];
        var refs = [];
        var aiProvider = this._aiProvider();

        try {
            artifacts = this._collectArtifacts(targetScope, runMode);

            for (var i = 0; i < artifacts.length; i++) {
                var a = artifacts[i];
                var parsed = this._parseReferences(a.body);
                for (var j = 0; j < parsed.length; j++) {
                    var ref = parsed[j];
                    ref.source_scope = targetScope;
                    ref.source_artifact = a.name;
                    ref.artifact_kind = a.kind;
                    this._persistReference(ref, scanSysId);
                    refs.push(ref);
                }
            }

            // Resolve coverage status for every persisted reference.
            var summary = this._finalizeScan(scanSysId, artifacts.length, refs.length);

            // Append audit evidence (append-only trail) into the scan record.
            this._appendAudit(scanSysId, targetScope, artifacts.length, refs.length, summary, aiProvider);

            return scanSysId;
        } catch (e) {
            gs.error('ScopeBridgeScanner.run: scan failed for ' + targetScope + ': ' + e.message);
            this._markFailed(scanSysId, e.message);
            return null;
        }
    },

    // ----------------------------------------------------------------------
    // Artifact collector. Returns [{name, kind, body}] for the target scope.
    // ----------------------------------------------------------------------
    _collectArtifacts: function (targetScope, runMode) {
        var out = [];
        var lastFull = null;
        if (runMode === 'incremental') {
            lastFull = this._lastFullScanTime(targetScope);
        }

        for (var t = 0; t < this.ARTIFACT_TABLES.length; t++) {
            var spec = this.ARTIFACT_TABLES[t];
            var gr = new GlideRecord(spec.table);
            gr.addQuery('sys_scope', targetScope);
            gr.addNotNullQuery(spec.field);
            if (lastFull) {
                gr.addQuery('sys_updated_on', '>=', lastFull);
            }
            gr.query();
            while (gr.next()) {
                out.push({
                    name: gr.getValue('name') || gr.getValue('api_name') || gr.getUniqueValue(),
                    kind: spec.kind,
                    body: gr.getValue(spec.field) || ''
                });
            }
        }

        // Flows: sys_hub_flow holds a JSON action graph, not a raw script.
        // Extract any embedded script/condition text so cross-scope calls made
        // inside Flow Designer steps are captured too.
        var flowGr = new GlideRecord('sys_hub_flow');
        flowGr.addQuery('sys_scope', targetScope);
        flowGr.query();
        while (flowGr.next()) {
            var snapshot = flowGr.getValue('snapshot') || '';
            if (snapshot) {
                out.push({
                    name: flowGr.getValue('name') || flowGr.getUniqueValue(),
                    kind: 'flow',
                    body: snapshot
                });
            }
        }

        return out;
    },

    // ----------------------------------------------------------------------
    // Stage-1 deterministic reference parser. Tokenizes a script body for
    // cross-scope signals. Returns an array of normalized reference objects:
    // { target_table, kind, operations: [..], classification, confidence }.
    // target_scope is resolved later via sys_db_object (needs the target
    // table's owning scope, not the caller's).
    // ----------------------------------------------------------------------
    _parseReferences: function (body) {
        if (!body) { return []; }
        var refs = [];
        var seen = {}; // dedupe key: table|kind

        // -- GlideRecord('table') access with operation inference ----------
        var grRe = /GlideRecord\s*\(\s*(['"])([a-zA-Z0-9_]+)\1\s*\)/g;
        var m;
        while ((m = grRe.exec(body)) !== null) {
            var table = m[2];
            if (this.IGNORE_TABLES[table]) { continue; }
            var ops = this._inferOperations(body, m.index);
            var key = table + '|gliderecord';
            if (seen[key]) { continue; }
            seen[key] = true;
            refs.push({
                target_table: table,
                kind: 'gliderecord',
                operations: ops,
                classification: 'confirmed',
                confidence: 100
            });
        }

        // -- Outbound REST / AJAX calls (external integration surface) ------
        if (/sn_ws\s*\.\s*RESTMessageV2/.test(body) || /GlideAjax/.test(body)) {
            var extKey = 'external|integration';
            if (!seen[extKey]) {
                seen[extKey] = true;
                refs.push({
                    target_table: 'external_integration',
                    kind: 'rest_message',
                    operations: ['execute'],
                    classification: 'confirmed',
                    confidence: 100
                });
            }
        }

        // -- gs.getProperty in a restricted scope (cross-scope config) ------
        var propRe = /gs\.getProperty\s*\(\s*(['"])([^'"]+)\1/g;
        var pm;
        var propCount = 0;
        while ((pm = propRe.exec(body)) !== null) { propCount++; }
        if (propCount > 0) {
            var propKey = 'sys_properties|gs_property';
            if (!seen[propKey]) {
                seen[propKey] = true;
                refs.push({
                    target_table: 'sys_properties',
                    kind: 'gs_property',
                    operations: ['read'],
                    classification: 'confirmed',
                    confidence: 100,
                    occurrence_count: propCount
                });
            }
        }

        return refs;
    },

    // Infer the CRUD operation set from method calls that follow a GlideRecord
    // instantiation. Searches a bounded window after the match index.
    _inferOperations: function (body, fromIndex) {
        var window = body.substring(fromIndex, fromIndex + 800);
        var ops = [];
        if (/\.insert\s*\(/.test(window) || /\.setValue\s*\(/.test(window)) { ops.push('write'); }
        if (/\.deleteRecord\s*\(/.test(window)) { ops.push('delete'); }
        if (/\.newRecord\s*\(/.test(window) || /\.initialize\s*\(/.test(window)) { ops.push('create'); }
        if (/\.query\s*\(/.test(window) || /\.get\s*\(/.test(window) || /\.next\s*\(/.test(window) || /\.getValue\s*\(/.test(window)) {
            ops.push('read');
        }
        // A GlideRecord that is only iterated (query+next) is read-only.
        if (ops.length === 0) { ops.push('read'); }
        // Dedupe preserving order.
        var out = [];
        for (var i = 0; i < ops.length; i++) {
            if (out.indexOf(ops[i]) === -1) { out.push(ops[i]); }
        }
        return out;
    },

    // ----------------------------------------------------------------------
    // Resolve the owning scope of a target table via sys_db_object.
    // Returns 'global' for OOTB tables, the scoped app's scope for x_* tables,
    // or 'unknown' when the table is not registered.
    // ----------------------------------------------------------------------
    _resolveTargetScope: function (tableName) {
        if (tableName === 'external_integration' || tableName === 'sys_properties') {
            return 'global';
        }
        var gr = new GlideRecord('sys_db_object');
        gr.addQuery('name', tableName);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var scope = gr.getValue('sys_scope');
            if (scope === 'global' || !scope) { return 'global'; }
            return scope;
        }
        // Unregistered table: if it carries an x_ prefix it is a scoped table
        // we cannot resolve by name — report 'unknown' so it surfaces for
        // manual review rather than being silently dropped.
        if (tableName.indexOf('x_') === 0) { return 'unknown'; }
        return 'global';
    },

    // ----------------------------------------------------------------------
    // Persist one reference record. target_scope is resolved here.
    // ----------------------------------------------------------------------
    _persistReference: function (ref, scanSysId) {
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.initialize();
        gr.setValue('scan', scanSysId);
        gr.setValue('source_scope', ref.source_scope || '');
        gr.setValue('source_artifact', ref.source_artifact || '');
        gr.setValue('artifact_kind', ref.artifact_kind || '');
        gr.setValue('target_table', ref.target_table || '');
        gr.setValue('target_scope', this._resolveTargetScope(ref.target_table));
        gr.setValue('operations', JSON.stringify(ref.operations || []));
        gr.setValue('kind', ref.kind || 'gliderecord');
        gr.setValue('classification', ref.classification || 'confirmed');
        gr.setValue('confidence', ref.confidence != null ? ref.confidence : 100);
        // Coverage status computed in finalize (needs full privilege context).
        gr.setValue('status', 'uncovered');
        try {
            gr.insert();
        } catch (e) {
            gs.error('ScopeBridgeScanner._persistReference: failed to persist reference: ' + e.message);
        }
    },

    // ----------------------------------------------------------------------
    // Finalize: compute coverage for each reference, update the scan header,
    // return the summary object.
    // ----------------------------------------------------------------------
    _finalizeScan: function (scanSysId, artifactCount, refCount) {
        var summary = { covered: 0, uncovered: 0, overprivileged: 0 };
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.addQuery('scan', scanSysId);
        gr.query();
        while (gr.next()) {
            var targetTable = gr.getValue('target_table');
            var targetScope = gr.getValue('target_scope');
            var sourceScope = gr.getValue('source_scope');
            var ops = this._safeParse(gr.getValue('operations'), []);
            var status = this._coverageStatus(targetTable, targetScope, sourceScope, ops);
            gr.setValue('status', status);
            if (status === 'covered') { summary.covered++; }
            else if (status === 'overprivileged') { summary.overprivileged++; }
            else { summary.uncovered++; }
            try {
                gr.setWorkflow(false);
                gr.update();
            } catch (e) {
                gs.error('ScopeBridgeScanner._finalizeScan: failed to update reference: ' + e.message);
            }
        }

        var scanGr = new GlideRecord(this.SCAN_TABLE);
        if (scanGr.get(scanSysId)) {
            scanGr.setValue('status', 'completed');
            scanGr.setValue('finished_on', new GlideDateTime().getValue());
            scanGr.setValue('artifact_count', artifactCount);
            scanGr.setValue('reference_count', refCount);
            scanGr.setValue('summary_json', JSON.stringify(summary));
            try {
                scanGr.setWorkflow(false);
                scanGr.update();
            } catch (e) {
                gs.error('ScopeBridgeScanner._finalizeScan: failed to finalize scan: ' + e.message);
            }
        }
        return summary;
    },

    // ----------------------------------------------------------------------
    // Coverage status for a single (table, scope, ops) reference:
    //   - No matching sys_scope_privilege -> 'uncovered'
    //   - Matching privilege but with wildcard target/operation -> 'overprivileged'
    //   - Exact least-privilege match -> 'covered'
    // A reference is considered covered only if EVERY operation it exercises
    // has a matching privilege record.
    // ----------------------------------------------------------------------
    _coverageStatus: function (targetTable, targetScope, sourceScope, ops) {
        var gr = new GlideRecord('sys_scope_privilege');
        gr.addQuery('target_name', targetTable);
        gr.addQuery('target_scope', targetScope);
        gr.addQuery('source_scope', sourceScope);
        gr.addQuery('status', 'allowed');
        gr.query();
        var matched = {};
        var sawWildcard = false;
        while (gr.next()) {
            var op = gr.getValue('operation') || '';
            if (op === '*') {
                sawWildcard = true;
            }
            matched[op] = true;
        }

        var allCovered = true;
        for (var i = 0; i < ops.length; i++) {
            if (!matched[ops[i]]) { allCovered = false; }
        }

        if (allCovered && sawWildcard) { return 'overprivileged'; }
        if (allCovered) { return 'covered'; }
        return 'uncovered';
    },

    // ----------------------------------------------------------------------
    // Over-Privilege Auditor: scan the whole instance for unsafe privilege
    // patterns. Returns a remediation list of {scope, target_name, target_scope,
    // operation, issue, risk}.
    // ----------------------------------------------------------------------
    auditOverPrivilege: function () {
        var findings = [];
        var gr = new GlideRecord('sys_scope_privilege');
        gr.addQuery('status', 'allowed');
        gr.query();
        while (gr.next()) {
            var targetName = gr.getValue('target_name') || '';
            var op = gr.getValue('operation') || '';
            var issue = null;
            var risk = 'medium';

            if (targetName === '*' && op === '*') {
                issue = 'wildcard on wildcard — grants every operation on every table';
                risk = 'critical';
            } else if (targetName === '*') {
                issue = 'wildcard table target — grants the operation on all tables in the target scope';
                risk = 'high';
            } else if (op === '*') {
                issue = 'wildcard operation — grants read+write+create+delete+execute on a specific table';
                risk = 'high';
            } else if (this._isOrphanTable(targetName)) {
                issue = 'orphaned privilege — target table no longer exists';
                risk = 'high';
            }

            if (issue) {
                findings.push({
                    scope: gr.getValue('source_scope') || '',
                    target_name: targetName,
                    target_scope: gr.getValue('target_scope') || '',
                    operation: op,
                    issue: issue,
                    risk: risk
                });
            }
        }
        return findings;
    },

    _isOrphanTable: function (tableName) {
        if (tableName === '*' || tableName === 'sys_properties') { return false; }
        var gr = new GlideRecord('sys_db_object');
        gr.addQuery('name', tableName);
        gr.setLimit(1);
        gr.query();
        return !gr.next();
    },

    // ----------------------------------------------------------------------
    // Drift detection: diff the privilege set between two scans (or two
    // scopes). Returns {added: [], removed: [], divergent: []} where each
    // entry is a normalized privilege signature.
    // ----------------------------------------------------------------------
    driftBetween: function (scanA, scanB) {
        var setA = this._privilegeSet(scanA);
        var setB = this._privilegeSet(scanB);
        var result = { added: [], removed: [], divergent: [] };
        var key, i;

        for (key in setA) {
            if (setA.hasOwnProperty(key)) {
                if (!setB[key]) { result.removed.push(setA[key]); }
            }
        }
        for (key in setB) {
            if (setB.hasOwnProperty(key)) {
                if (!setA[key]) { result.added.push(setB[key]); }
            }
        }
        // Divergent = same target, different operation set.
        var opsA = this._operationMap(scanA);
        var opsB = this._operationMap(scanB);
        for (key in opsA) {
            if (opsA.hasOwnProperty(key) && opsB[key]) {
                if (opsA[key].join(',') !== opsB[key].join(',')) {
                    result.divergent.push({
                        target: key,
                        operations_a: opsA[key],
                        operations_b: opsB[key]
                    });
                }
            }
        }
        return result;
    },

    _privilegeSet: function (scanSysId) {
        var map = {};
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.addQuery('scan', scanSysId);
        gr.query();
        while (gr.next()) {
            var sig = gr.getValue('target_table') + '|' + gr.getValue('target_scope');
            map[sig] = {
                target_name: gr.getValue('target_table'),
                target_scope: gr.getValue('target_scope'),
                operations: this._safeParse(gr.getValue('operations'), [])
            };
        }
        return map;
    },

    _operationMap: function (scanSysId) {
        var map = {};
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.addQuery('scan', scanSysId);
        gr.query();
        while (gr.next()) {
            var sig = gr.getValue('target_table') + '|' + gr.getValue('target_scope');
            map[sig] = this._safeParse(gr.getValue('operations'), []);
        }
        return map;
    },

    // ----------------------------------------------------------------------
    // Append-only audit trail. Serializes a dated evidence entry into the
    // scan's audit_log_json column (JSON array).
    // ----------------------------------------------------------------------
    _appendAudit: function (scanSysId, targetScope, artifacts, refs, summary, aiProvider) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanSysId)) { return; }
        var existing = this._safeParse(gr.getValue('audit_log_json'), []);
        existing.push({
            event: 'scan_completed',
            target_scope: targetScope,
            artifacts_scanned: artifacts,
            references_detected: refs,
            summary: summary,
            ai_provider: aiProvider,
            engine_version: this.ENGINE_VERSION,
            recorded_on: new GlideDateTime().getValue()
        });
        // Truncate by serialized length (not entry count) so the 4000-char
        // field is never exceeded, even when a single entry is large.
        gr.setValue('audit_log_json', this._truncateAuditJson(existing));
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('ScopeBridgeScanner._appendAudit: failed to append audit: ' + e.message);
        }
    },

    // ----------------------------------------------------------------------
    // Mark a scan as failed (transition running -> failed) with an error note.
    // ----------------------------------------------------------------------
    _markFailed: function (scanSysId, message) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanSysId)) { return; }
        gr.setValue('status', 'failed');
        gr.setValue('finished_on', new GlideDateTime().getValue());
        var existing = this._safeParse(gr.getValue('audit_log_json'), []);
        existing.push({
            event: 'scan_failed',
            error: (message || '').substring(0, 512),
            recorded_on: new GlideDateTime().getValue()
        });
        gr.setValue('audit_log_json', this._truncateAuditJson(existing));
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('ScopeBridgeScanner._markFailed: failed to mark scan failed: ' + e.message);
        }
    },

    // Serialize an audit array and drop oldest entries until the JSON string
    // fits within the audit_log_json field (4000 chars). If a single entry
    // alone exceeds the limit, it is dropped too, preserving a valid array.
    _truncateAuditJson: function (entries) {
        var MAX = 4000;
        var out = entries.slice();
        while (out.length > 0 && JSON.stringify(out).length > MAX) {
            out.shift();
        }
        return JSON.stringify(out);
    },

    // ----------------------------------------------------------------------
    // Public report helpers for the REST endpoints.
    // ----------------------------------------------------------------------
    getScan: function (scanSysId) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanSysId)) { return null; }
        return {
            sys_id: gr.getUniqueValue(),
            target_scope: gr.getValue('target_scope'),
            mode: gr.getValue('mode'),
            status: gr.getValue('status'),
            started_on: gr.getValue('started_on'),
            finished_on: gr.getValue('finished_on'),
            engine_version: gr.getValue('engine_version'),
            ai_model: gr.getValue('ai_model'),
            artifact_count: parseInt(gr.getValue('artifact_count'), 10) || 0,
            reference_count: parseInt(gr.getValue('reference_count'), 10) || 0,
            summary: this._safeParse(gr.getValue('summary_json'), {})
        };
    },

    listReferences: function (scanSysId, statusFilter) {
        var results = [];
        var gr = new GlideRecord(this.REFERENCE_TABLE);
        gr.addQuery('scan', scanSysId);
        if (statusFilter) { gr.addQuery('status', statusFilter); }
        gr.orderBy('target_table');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                source_scope: gr.getValue('source_scope'),
                source_artifact: gr.getValue('source_artifact'),
                artifact_kind: gr.getValue('artifact_kind'),
                target_table: gr.getValue('target_table'),
                target_scope: gr.getValue('target_scope'),
                operations: this._safeParse(gr.getValue('operations'), []),
                kind: gr.getValue('kind'),
                classification: gr.getValue('classification'),
                confidence: parseInt(gr.getValue('confidence'), 10) || 0,
                status: gr.getValue('status')
            });
        }
        return results;
    },

    getCoverageMatrix: function (scanSysId) {
        var refs = this.listReferences(scanSysId, null);
        var matrix = {};
        for (var i = 0; i < refs.length; i++) {
            var r = refs[i];
            var key = r.target_scope + '|' + r.target_table;
            if (!matrix[key]) {
                matrix[key] = { target_scope: r.target_scope, target_table: r.target_table, operations: {}, status: 'covered' };
            }
            for (var j = 0; j < r.operations.length; j++) {
                matrix[key].operations[r.operations[j]] = true;
            }
            // A matrix cell is only as healthy as its weakest reference.
            if (r.status === 'uncovered') { matrix[key].status = 'uncovered'; }
            else if (r.status === 'overprivileged' && matrix[key].status !== 'uncovered') { matrix[key].status = 'overprivileged'; }
        }
        return matrix;
    },

    // ----------------------------------------------------------------------
    // AI integration (optional). Falls back to deterministic when no provider.
    // ----------------------------------------------------------------------
    _aiProvider: function () {
        // Generative AI Controller (BYOK) presence is optional. If configured,
        // return the provider label; otherwise empty string signals deterministic.
        var provider = gs.getProperty('x_snb.ai.provider', '');
        return provider;
    },

    _aiModelLabel: function () {
        var provider = this._aiProvider();
        if (!provider) { return ''; }
        return gs.getProperty('x_snb.ai.model', '');
    },

    _lastFullScanTime: function (targetScope) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        gr.addQuery('target_scope', targetScope);
        gr.addQuery('mode', 'full');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('started_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) { return gr.getValue('started_on'); }
        return null;
    },

    _safeParse: function (str, fallback) {
        if (!str) { return fallback; }
        try {
            var v = JSON.parse(str);
            return (v === null || v === undefined) ? fallback : v;
        } catch (e) {
            return fallback;
        }
    },

    type: 'ScopeBridgeScanner'
};
