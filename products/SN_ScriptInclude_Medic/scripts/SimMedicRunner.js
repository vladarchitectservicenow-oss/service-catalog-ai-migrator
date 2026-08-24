// ScriptInclude Medic — SimMedicRunner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Orchestrates a full scan: builds the call graph, runs every detector,
// computes health scores, and persists results to the scoped result tables.
// Also drives the safe-list (configurable entry-point registry) and
// incremental re-scan (only changed includes since last run).
//
// @class SimMedicRunner
// @namespace x_snc_script_include_medic

var SimMedicRunner = Class.create();
SimMedicRunner.prototype = {

    initialize: function() {
        this._engine = new SimMedicEngine();
    },

    type: 'SimMedicRunner',

    /**
     * Run a complete scan and persist results.
     *
     * @param {boolean} incremental  If true, only re-scan changed includes.
     * @param {Array}   entryPoints  Safe-list of legitimate entry-point names.
     * @returns {Object} summary { scan_sys_id, include_count, dead, duplicates, ... }
     */
    runScan: function(incremental, entryPoints) {
        if (entryPoints === undefined) {
            entryPoints = this.loadEntryPoints();
        }

        var scanSysId = this._createScanRecord(incremental);

        // Incremental re-scan: only collect includes changed since the last
        // completed scan. The flag now actually changes scan behavior.
        var changedSince = null;
        if (incremental) {
            changedSince = this._lastCompletedOn();
        }

        var graph = this._engine.buildCallGraph(changedSince);
        var dead = this._engine.detectDeadCode(entryPoints);
        var duplicates = this._engine.detectDuplicates();
        var naming = this._engine.enforceNaming();
        var docs = this._engine.scoreDocs();
        var cycles = this._engine.detectCycles();
        var reinvention = this._engine.flagOotbReinvention();
        var health = this._engine.computeHealth(dead, duplicates, naming, docs, cycles, reinvention);

        this._persistFindings(scanSysId, dead, 'dead_code', duplicates, 'duplicate',
            naming, 'naming', docs, 'documentation', cycles, 'cycle', reinvention, 'reinvention');
        this._persistHealth(scanSysId, health.perInclude);

        this._finalizeScanRecord(scanSysId, {
            include_count: graph.meta.includeCount,
            dead_count: dead.length,
            duplicate_count: duplicates.length,
            naming_count: naming.length,
            doc_count: docs.length,
            cycle_count: cycles.length,
            reinvention_count: reinvention.length,
            instance_health: health.instance
        });

        return {
            scan_sys_id: scanSysId,
            include_count: graph.meta.includeCount,
            dead_count: dead.length,
            duplicate_count: duplicates.length,
            naming_count: naming.length,
            doc_count: docs.length,
            cycle_count: cycles.length,
            reinvention_count: reinvention.length,
            instance_health: health.instance,
            per_include: health.perInclude
        };
    },

    /**
     * Load the configurable entry-point registry (scripted REST resources,
     * scheduled jobs, UI actions, flow actions) from a system property.
     * Falls back to an empty list when unconfigured.
     * @returns {Array<string>}
     */
    loadEntryPoints: function() {
        var prop = gs.getProperty('x_snc_script_include_medic.safe_list', '');
        if (!prop) {
            return [];
        }
        var parts = prop.split(',');
        var cleaned = [];
        for (var i = 0; i < parts.length; i++) {
            var name = parts[i].trim();
            if (name) {
                cleaned.push(name);
            }
        }
        return cleaned;
    },

    /**
     * Incremental re-scan check: returns true when the include set changed
     * since the last completed scan.
     * @returns {boolean}
     */
    hasChangedSinceLastScan: function() {
        var lastCompleted = this._lastCompletedOn();
        if (!lastCompleted) {
            return true; // never scanned — run full
        }

        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('sys_updated_on', '>', lastCompleted);
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    /**
     * Return the `completed_on` display value of the most recent completed
     * scan, or null when no scan has ever completed.
     * @returns {string|null}
     */
    _lastCompletedOn: function() {
        var last = new GlideRecord('x_snc_script_include_medic_scan');
        last.addQuery('status', 'completed');
        last.orderByDesc('completed_on');
        last.setLimit(1);
        last.query();
        if (!last.next()) {
            return null;
        }
        return last.getValue('completed_on');
    },

    /**
     * Create the scan record and return its sys_id.
     * @returns {string}
     */
    _createScanRecord: function(incremental) {
        var gr = new GlideRecord('x_snc_script_include_medic_scan');
        gr.initialize();
        gr.setValue('scan_type', incremental ? 'incremental' : 'full');
        gr.setValue('status', 'running');
        gr.setValue('started_on', new GlideDateTime().getDisplayValue());
        gr.setValue('triggered_by', gs.getUserName());
        var sysId = gr.insert();
        return sysId;
    },

    /**
     * Persist a batch of findings to the polymorphic finding table.
     */
    _persistFindings: function(scanSysId, dead, deadType, duplicates, dupType,
            naming, namingType, docs, docsType, cycles, cycleType, reinvention, reinventionType) {
        this._persistOneType(scanSysId, dead, deadType);
        this._persistOneType(scanSysId, duplicates, dupType);
        this._persistOneType(scanSysId, naming, namingType);
        this._persistOneType(scanSysId, docs, docsType);
        this._persistOneType(scanSysId, cycles, cycleType);
        this._persistOneType(scanSysId, reinvention, reinventionType);
    },

    _persistOneType: function(scanSysId, findings, type) {
        if (!findings) {
            return;
        }
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            try {
                var gr = new GlideRecord('x_snc_script_include_medic_finding');
                gr.initialize();
                gr.setValue('scan', scanSysId);
                gr.setValue('type', type);
                gr.setValue('severity', f.severity || 'low');
                gr.setValue('include_name', f.include_name || '');
                gr.setValue('detail', (f.detail || '').substring(0, 4000));

                if (f.include_sys_id) {
                    gr.setValue('include_sys_id', f.include_sys_id);
                }
                if (f.include_a_name) {
                    gr.setValue('include_sys_id', f.include_a_sys_id);
                    gr.setValue('target_name', f.include_a_name + ' ↔ ' + f.include_b_name);
                    gr.setValue('metric', 'similarity=' + f.similarity + '% | a=' +
                        f.include_a_sys_id + ' | b=' + f.include_b_sys_id);
                }
                if (f.score !== undefined) {
                    gr.setValue('score', f.score);
                }
                if (f.cycle) {
                    gr.setValue('target_name', f.cycle.join(' → '));
                    gr.setValue('metric', 'length=' + f.length);
                }
                if (f.scope) {
                    gr.setValue('detail', (f.detail || '') + ' [scope: ' + f.scope + ']');
                }
                gr.insert();
            } catch (e) {
                gs.error('SimMedic: failed to persist ' + type + ' finding: ' + e.message);
            }
        }
    },

    /**
     * Persist per-include health scores.
     */
    _persistHealth: function(scanSysId, perInclude) {
        for (var i = 0; i < perInclude.length; i++) {
            var h = perInclude[i];
            try {
                var gr = new GlideRecord('x_snc_script_include_medic_finding');
                gr.initialize();
                gr.setValue('scan', scanSysId);
                gr.setValue('type', 'health');
                gr.setValue('severity', h.score < 50 ? 'high' : (h.score < 80 ? 'medium' : 'low'));
                gr.setValue('include_name', h.include_name);
                gr.setValue('include_sys_id', h.include_sys_id);
                gr.setValue('score', h.score);
                gr.setValue('detail', 'Health score ' + h.score + '/100');
                gr.insert();
            } catch (e) {
                gs.error('SimMedic: failed to persist health score: ' + e.message);
            }
        }
    },

    /**
     * Finalize the scan record with summary counts.
     */
    _finalizeScanRecord: function(scanSysId, summary) {
        try {
            var gr = new GlideRecord('x_snc_script_include_medic_scan');
            if (!gr.get(scanSysId)) {
                return;
            }
            gr.setValue('status', 'completed');
            gr.setValue('completed_on', new GlideDateTime().getDisplayValue());
            gr.setValue('include_count', summary.include_count);
            gr.setValue('dead_count', summary.dead_count);
            gr.setValue('duplicate_count', summary.duplicate_count);
            gr.setValue('naming_count', summary.naming_count);
            gr.setValue('doc_count', summary.doc_count);
            gr.setValue('cycle_count', summary.cycle_count);
            gr.setValue('reinvention_count', summary.reinvention_count);
            gr.setValue('instance_health', summary.instance_health);
            gr.update();
        } catch (e) {
            gs.error('SimMedic: failed to finalize scan record: ' + e.message);
        }
    }
};
