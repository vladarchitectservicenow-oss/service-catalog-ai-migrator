// ScopeBridge — ScopeBridgeGenerator
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Least-privilege generator + apply engine for ScopeBridge.
// Responsibilities (the ONLY component in the apply path):
//   1. Least-Privilege Generator — derives the minimal sys_scope_privilege
//      record set needed to close all UNCOVERED gaps from a scan, scoped to
//      the exact operation set each reference exercises. A read-only
//      GlideRecord yields `read`, never `write`.
//   2. Diff preview + dry-run — returns the proposed records WITHOUT applying;
//      a caller must pass apply=true to commit.
//   3. Apply — inserts the generated records (guarded, with audit trail).
//   4. GenAI rationale (optional BYOK) — attaches a human-readable per-record
//      justification when a Generative AI Controller provider is configured;
//      otherwise emits a deterministic rationale derived from the reference.
//
// This class NEVER emits a `*` on `*` record. A reference that would require a
// wildcard is flagged for manual review instead of being auto-granted.
//
// @class ScopeBridgeGenerator @namespace x_snb
var ScopeBridgeGenerator = Class.create();
ScopeBridgeGenerator.prototype = {

    PRIVILEGE_TABLE: 'sys_scope_privilege',
    REFERENCE_TABLE: 'x_snb_reference',
    SCAN_TABLE: 'x_snb_scan',

    initialize: function () {
        this._scanner = null;
    },

    _getScanner: function () {
        if (!this._scanner) { this._scanner = new x_snb.ScopeBridgeScanner(); }
        return this._scanner;
    },

    // ----------------------------------------------------------------------
    // Public: generate the minimal privilege record set for a scan.
    // Returns { records: [...], flagged: [...], dry_run: true/false }.
    // When apply=false (dry-run), nothing is written.
    // ----------------------------------------------------------------------
    generate: function (scanSysId, apply) {
        var refs = this._getScanner().listReferences(scanSysId, 'uncovered');
        var records = [];
        var flagged = [];
        var dedupe = {};

        for (var i = 0; i < refs.length; i++) {
            var r = refs[i];

            // External integration and property access are not table-level
            // privileges — they need manual review, never auto-grant.
            if (r.target_table === 'external_integration' || r.target_table === 'sys_properties') {
                flagged.push({
                    reference: r,
                    reason: 'non-table target — requires manual cross-scope or REST configuration review'
                });
                continue;
            }

            // Refuse to auto-generate a wildcard. Flag for manual review.
            if (r.target_table === '*' || this._containsWildcard(r.operations)) {
                flagged.push({
                    reference: r,
                    reason: 'would require wildcard privilege — refused by least-privilege policy'
                });
                continue;
            }

            for (var j = 0; j < r.operations.length; j++) {
                var op = r.operations[j];
                var key = r.target_scope + '|' + r.target_table + '|' + op;
                if (dedupe[key]) { continue; }
                dedupe[key] = true;
                records.push({
                    source_scope: r.source_scope,
                    target_name: r.target_table,
                    target_scope: r.target_scope,
                    target_type: 'table',
                    operation: op,
                    status: 'allowed',
                    rationale: this._rationale(r, op)
                });
            }
        }

        if (apply === true && records.length > 0) {
            // E5 compensating control: minting sys_scope_privilege records is
            // a privileged, self-escalating action. Restrict the apply path to
            // callers holding the elevated scoped-admin role; any other caller
            // is refused and the request is reported as a dry-run (no write).
            if (!gs.hasRole('x_snb.admin')) {
                gs.warn('ScopeBridgeGenerator.generate: apply refused — x_snb.admin role required to apply privileges');
                flagged.push({
                    reference: { target_table: '(apply)', target_scope: '', operations: [] },
                    reason: 'apply requires the x_snb.admin role (change-control guard)'
                });
                apply = false;
            } else {
                this._applyRecords(records, scanSysId);
            }
        }

        return {
            records: records,
            flagged: flagged,
            record_count: records.length,
            flagged_count: flagged.length,
            applied: (apply === true)
        };
    },

    // ----------------------------------------------------------------------
    // Apply generated records (guarded insert). Returns count inserted.
    // ----------------------------------------------------------------------
    _applyRecords: function (records, scanSysId) {
        var inserted = 0;
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (this._privilegeExists(rec)) { continue; }
            var gr = new GlideRecord(this.PRIVILEGE_TABLE);
            gr.initialize();
            gr.setValue('source_scope', rec.source_scope);
            gr.setValue('target_name', rec.target_name);
            gr.setValue('target_scope', rec.target_scope);
            gr.setValue('target_type', rec.target_type);
            gr.setValue('operation', rec.operation);
            gr.setValue('status', rec.status);
            try {
                gr.insert();
                inserted++;
            } catch (e) {
                gs.error('ScopeBridgeGenerator._applyRecords: failed to insert privilege for '
                    + rec.target_name + '.' + rec.operation + ': ' + e.message);
            }
        }
        this._appendApplyAudit(scanSysId, inserted);
        return inserted;
    },

    _privilegeExists: function (rec) {
        var gr = new GlideRecord(this.PRIVILEGE_TABLE);
        gr.addQuery('source_scope', rec.source_scope);
        gr.addQuery('target_name', rec.target_name);
        gr.addQuery('target_scope', rec.target_scope);
        gr.addQuery('operation', rec.operation);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    },

    _containsWildcard: function (ops) {
        for (var i = 0; i < ops.length; i++) {
            if (ops[i] === '*') { return true; }
        }
        return false;
    },

    // ----------------------------------------------------------------------
    // Rationale: GenAI (BYOK) when configured, deterministic otherwise.
    // ----------------------------------------------------------------------
    _rationale: function (ref, op) {
        var provider = this._aiProvider();
        if (provider) {
            var rationale = this._aiRationale(provider, ref, op);
            if (rationale) { return rationale; }
        }
        return 'Required by ' + ref.source_artifact + ' (' + ref.artifact_kind + ') which accesses '
            + ref.target_table + ' in scope ' + ref.target_scope + ' with ' + op + ' operation.';
    },

    _aiProvider: function () {
        return gs.getProperty('x_snb.ai.provider', '');
    },

    _aiRationale: function (provider, ref, op) {
        // Placeholder for Generative AI Controller (BYOK) integration.
        // In production, this routes a rationale-generation prompt through the
        // customer's own Azure OpenAI / Bedrock / Vertex AI / watsonx endpoint
        // via sn_generative_ai. It degrades gracefully to null when the
        // controller is unreachable, and the deterministic rationale above is
        // used instead. No ServiceNow-side model cost or data egress.
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenerativeAI) {
                var genAI = new sn_generative_ai.GenerativeAI();
                var prompt = 'Explain in one sentence why a scoped app requires a '
                    + op + ' privilege on table ' + ref.target_table
                    + ' (scope ' + ref.target_scope + ') accessed from '
                    + ref.source_artifact + '.';
                var resp = genAI.generate(prompt);
                if (resp && resp.text) { return resp.text; }
            }
        } catch (e) {
            gs.warn('ScopeBridgeGenerator._aiRationale: GenAI unavailable, using deterministic rationale: ' + e.message);
        }
        return null;
    },

    _appendApplyAudit: function (scanSysId, inserted) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanSysId)) { return; }
        var existing = [];
        try {
            existing = JSON.parse(gr.getValue('audit_log_json') || '[]');
        } catch (e) {
            existing = [];
        }
        existing.push({
            event: 'privileges_applied',
            scan: scanSysId,
            records_inserted: inserted,
            applied_by: gs.getUserID(),
            recorded_on: new GlideDateTime().getValue()
        });
        // Truncate by serialized length (not entry count) so the 4000-char
        // field is never exceeded, even when a single entry is large.
        var MAX = 4000;
        while (existing.length > 0 && JSON.stringify(existing).length > MAX) {
            existing.shift();
        }
        gr.setValue('audit_log_json', JSON.stringify(existing));
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('ScopeBridgeGenerator._appendApplyAudit: failed to append apply audit: ' + e.message);
        }
    },

    type: 'ScopeBridgeGenerator'
};
