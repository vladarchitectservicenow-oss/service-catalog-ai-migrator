// ClientScript Medic — Nightly Delta Audit (scheduled job)
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Scheduled job that re-runs the full scan nightly and diffs the new baseline
// fingerprint against the previous run, emitting a delta digest (new/resolved/
// regressed findings) to the system log. Findings are never deleted — the
// `resolved` flag is set instead so re-emergence is detectable.

var ClientScriptMedicDeltaAudit = Class.create();
ClientScriptMedicDeltaAudit.prototype = {

    initialize: function () {},

    run: function () {
        var engine = new ClientScriptMedicEngine();
        var newRunId = engine.scanAll();

        // Enrich with AI suggestions (advisory only, degrades gracefully)
        var ai = new ClientScriptMedicAI();
        ai.enrichRun(newRunId);

        // Diff against the previous completed run
        var prev = this._getPreviousRun(newRunId);
        if (!prev) {
            gs.info('ClientScriptMedic: first scan complete, run ' + newRunId +
                ' — no baseline to diff against.');
            return;
        }

        var delta = this._diffRuns(prev, newRunId);
        gs.info('ClientScriptMedic: nightly delta — new=' + delta.newCount +
            ', resolved=' + delta.resolvedCount + ', regressed=' + delta.regressedCount);
    },

    _getPreviousRun: function (currentRunId) {
        var gr = new GlideRecord('x_snc_csm_scan_run');
        gr.addQuery('status', 'completed');
        gr.addQuery('sys_id', '!=', currentRunId);
        gr.orderByDesc('completed_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('sys_id');
        }
        return '';
    },

    _diffRuns: function (prevRunId, newRunId) {
        // Build a normalized key -> sys_id map for the previous run's findings
        var prevKeys = {};
        var p = new GlideRecord('x_snc_csm_finding');
        p.addQuery('run_id', prevRunId);
        p.query();
        while (p.next()) {
            prevKeys[this._key(p)] = p.getValue('sys_id');
        }

        // Walk the new run's findings, classify each
        var newCount = 0;
        var resolvedCount = 0;
        var regressedCount = 0;
        var n = new GlideRecord('x_snc_csm_finding');
        n.addQuery('run_id', newRunId);
        n.query();
        while (n.next()) {
            var k = this._key(n);
            if (!prevKeys[k]) {
                newCount++;
                // A finding that reappears after being resolved is a regression.
                if (this._wasResolved(n, newRunId)) {
                    regressedCount++;
                }
            }
        }

        // Resolved = previous findings whose key is absent from the new run.
        // Mark them resolved=true so re-emergence is detectable.
        var newKeys = {};
        var n2 = new GlideRecord('x_snc_csm_finding');
        n2.addQuery('run_id', newRunId);
        n2.query();
        while (n2.next()) {
            newKeys[this._key(n2)] = true;
        }
        for (var pk in prevKeys) {
            if (!newKeys[pk]) {
                resolvedCount++;
                this._markResolved(prevKeys[pk]);
            }
        }

        return {
            newCount: newCount,
            resolvedCount: resolvedCount,
            regressedCount: regressedCount
        };
    },

    _markResolved: function (findingSysId) {
        var gr = new GlideRecord('x_snc_csm_finding');
        if (!gr.get(findingSysId)) {
            return;
        }
        gr.setValue('resolved', true);
        try {
            gr.update();
        } catch (e) {
            gs.error('ClientScriptMedic: failed to mark finding resolved: ' + e);
        }
    },

    _wasResolved: function (findingGr, excludeRunId) {
        var q = new GlideRecord('x_snc_csm_finding');
        q.addQuery('resolved', true);
        q.addQuery('table_name', findingGr.getValue('table_name') || '');
        q.addQuery('field_name', findingGr.getValue('field_name') || '');
        q.addQuery('event', findingGr.getValue('event') || '');
        q.addQuery('finding_type', findingGr.getValue('finding_type') || '');
        q.addQuery('title', findingGr.getValue('title') || '');
        q.addQuery('run_id', '!=', excludeRunId);
        q.setLimit(1);
        q.query();
        return q.next();
    },

    _key: function (gr) {
        return (gr.getValue('table_name') || '') + '|' +
            (gr.getValue('field_name') || '') + '|' +
            (gr.getValue('event') || '') + '|' +
            (gr.getValue('finding_type') || '') + '|' +
            (gr.getValue('title') || '');
    },

    type: 'ClientScriptMedicDeltaAudit'
};
