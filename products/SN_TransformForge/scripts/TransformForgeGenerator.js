// TransformForge — TransformForgeGenerator
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Persistence and record-generation layer of the TransformForge scoped
// application. Persists generation jobs and proposed mappings into the two
// scoped tables, and emits ready-to-review transform-map payloads
// (dry-run first). It NEVER writes to sys_transform_map / _entry /
// _script directly — generation is always review-gated.
//
// ES5-compatible (Rhino). @class TransformForgeGenerator @namespace x_sntf
var TransformForgeGenerator = Class.create();
TransformForgeGenerator.prototype = {

    JOB_TABLE: 'x_sntf_transform_job',
    MAPPING_TABLE: 'x_sntf_transform_mapping',

    // ----------------------------------------------------------------------
    // Run the engine over a source + target, persist a job + mapping rows,
    // and return the job sys_id (dry-run emits the payload without persisting).
    // ----------------------------------------------------------------------
    generate: function (csvText, targetTable, options) {
        var opts = options || {};
        var engine = new TransformForgeEngine();
        var preview = engine.preview(csvText, targetTable, opts);

        if (!preview.ok) {
            return { ok: false, error: preview.error, message: preview.message };
        }

        if (opts.dryRun === true) {
            return {
                ok: true,
                dry_run: true,
                job_sys_id: null,
                preview: preview
            };
        }

        var jobSysId = this._createJob(csvText, targetTable, preview, opts);
        if (!jobSysId) {
            return { ok: false, error: 'JOB_PERSIST_FAILED', message: 'Could not persist the generation job' };
        }

        var mappingCount = this._persistMappings(jobSysId, preview, opts);

        return {
            ok: true,
            dry_run: false,
            job_sys_id: jobSysId,
            mapping_count: mappingCount,
            preview: preview
        };
    },

    // ----------------------------------------------------------------------
    // Emit an import-ready transform-map payload (map + entries + scripts).
    // Returns the serializable structure a reviewer can confirm/promote.
    // ----------------------------------------------------------------------
    exportMapPayload: function (jobSysId) {
        var jobGr = new GlideRecord(this.JOB_TABLE);
        if (!jobGr.get(jobSysId)) {
            return { ok: false, error: 'JOB_NOT_FOUND', message: 'Generation job not found: ' + jobSysId };
        }

        var sourceJson = jobGr.getValue('source_signature') || '{}';
        var previewJson = jobGr.getValue('preview_payload') || '{}';
        var sourceSig = this._safeParse(sourceJson, {});
        var preview = this._safeParse(previewJson, {});

        var targetTable = jobGr.getValue('target_table') || '';
        var mapName = 'TransformForge ' + targetTable + ' (' + jobGr.getValue('number') + ')';

        var entries = [];
        var mappings = preview.mappings || [];
        for (var m = 0; m < mappings.length; m++) {
            var map = mappings[m];
            if (!map.top_match) { continue; }
            entries.push({
                source_field: map.source_column,
                target_field: map.top_match.field,
                coalesce: this._coalesceFlag(preview, map.source_column),
                use_source_script: false,
                choice_map: this._choiceMapFor(preview, map.source_column)
            });
        }

        return {
            ok: true,
            transform_map: {
                name: mapName,
                target_table: targetTable,
                source_table: null, // determined at import time by the caller
                order: 100,
                active: true
            },
            entries: entries,
            scripts: preview.scripts || [],
            engine_version: preview.engine_version || '1.0.0',
            source_signature: sourceSig,
            generated_at: new GlideDateTime().getValue()
        };
    },

    // ----------------------------------------------------------------------
    // Read a persisted job's full preview (for the review UI / status API).
    // ----------------------------------------------------------------------
    getJobPreview: function (jobSysId) {
        var jobGr = new GlideRecord(this.JOB_TABLE);
        if (!jobGr.get(jobSysId)) {
            return { ok: false, error: 'JOB_NOT_FOUND', message: 'Generation job not found: ' + jobSysId };
        }
        var previewJson = jobGr.getValue('preview_payload') || '{}';
        var preview = this._safeParse(previewJson, {});
        return {
            ok: true,
            job_sys_id: jobSysId,
            target_table: jobGr.getValue('target_table') || '',
            status: jobGr.getValue('status') || '',
            created_on: jobGr.getValue('sys_created_on') || '',
            preview: preview
        };
    },

    // ----------------------------------------------------------------------
    // List recent jobs (bounded) for the status/listing surface.
    // ----------------------------------------------------------------------
    listJobs: function (limit) {
        var cap = limit || 25;
        var out = [];
        var gr = new GlideRecord(this.JOB_TABLE);
        gr.orderByDesc('sys_created_on');
        gr.setLimit(cap);
        gr.query();
        while (gr.next()) {
            out.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getValue('number') || '',
                target_table: gr.getValue('target_table') || '',
                status: gr.getValue('status') || '',
                mapping_count: parseInt(gr.getValue('mapping_count'), 10) || 0,
                created_on: gr.getValue('sys_created_on') || ''
            });
        }
        return out;
    },

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    _createJob: function (csvText, targetTable, preview, opts) {
        var gr = new GlideRecord(this.JOB_TABLE);
        gr.initialize();
        gr.setValue('target_table', targetTable);
        gr.setValue('status', 'generated');
        gr.setValue('engine_version', preview.engine_version || '1.0.0');
        gr.setValue('fingerprint_hash', preview.target.fingerprint_hash || '');
        gr.setValue('source_column_count', preview.source.column_count || 0);
        gr.setValue('source_row_count', preview.source.row_count || 0);
        gr.setValue('mapping_count', preview.mappings.length || 0);
        gr.setValue('number', 'TF-' + String(gs.generateGUID()).substring(0, 8).toUpperCase());

        var sourceSig = {
            delimiter: preview.source.delimiter,
            row_count: preview.source.row_count,
            column_count: preview.source.column_count,
            columns: preview.mappings.map(function (m) { return m.source_column; }),
            captured_at: new GlideDateTime().getValue()
        };
        gr.setValue('source_signature', JSON.stringify(sourceSig));
        gr.setValue('preview_payload', JSON.stringify(this._compactPreview(preview)));

        if (opts.requested_by) { gr.setValue('requested_by', opts.requested_by); }

        var jobSysId = null;
        try {
            jobSysId = gr.insert();
        } catch (e) {
            gs.error('TransformForgeGenerator._createJob: insert failed: ' + e.message);
            return null;
        }
        return jobSysId;
    },

    _persistMappings: function (jobSysId, preview, opts) {
        var count = 0;
        var mappings = preview.mappings || [];
        var coalesce = preview.coalesce || [];
        var coalesceByCol = {};
        for (var c = 0; c < coalesce.length; c++) {
            coalesceByCol[coalesce[c].source_column] = coalesce[c];
        }

        for (var m = 0; m < mappings.length; m++) {
            var map = mappings[m];
            var gr = new GlideRecord(this.MAPPING_TABLE);
            gr.initialize();
            gr.setValue('job', jobSysId);
            gr.setValue('source_column', map.source_column);
            gr.setValue('source_index', map.source_index);
            gr.setValue('inferred_type', map.inferred_type || '');

            if (map.top_match) {
                gr.setValue('target_field', map.top_match.field);
                gr.setValue('target_label', map.top_match.label || '');
                gr.setValue('confidence', map.top_match.confidence || 'none');
                gr.setValue('match_score', map.top_match.score || 0);
                gr.setValue('status', (map.top_match.confidence === 'high') ? 'confirmed' : 'proposed');
            } else {
                gr.setValue('status', 'unmatched');
            }

            if (coalesceByCol[map.source_column]) {
                gr.setValue('coalesce', coalesceByCol[map.source_column].coalesce);
            }

            var choiceEntry = this._choiceEntryFor(preview, map.source_column);
            if (choiceEntry) {
                gr.setValue('choice_map_json', JSON.stringify(choiceEntry.choice_map || []));
                gr.setValue('orphans_json', JSON.stringify(choiceEntry.orphans || []));
            }

            try {
                gr.insert();
                count++;
            } catch (e) {
                gs.error('TransformForgeGenerator._persistMappings: insert failed for ' + map.source_column + ': ' + e.message);
            }
        }
        return count;
    },

    _coalesceFlag: function (preview, sourceColumn) {
        var coalesce = preview.coalesce || [];
        for (var i = 0; i < coalesce.length; i++) {
            if (coalesce[i].source_column === sourceColumn) {
                return coalesce[i].coalesce === true;
            }
        }
        return false;
    },

    _choiceMapFor: function (preview, sourceColumn) {
        var choices = preview.choices || [];
        for (var i = 0; i < choices.length; i++) {
            if (choices[i].source_column === sourceColumn && choices[i].is_choice) {
                return choices[i].choice_map;
            }
        }
        return [];
    },

    _safeParse: function (text, fallback) {
        try {
            return JSON.parse(text) || fallback;
        } catch (e) {
            return fallback;
        }
    },

    _compactPreview: function (preview) {
        // Persist a reduced copy of the preview that omits the per-column
        // candidate lists (the review UI's alternate matches) so the payload
        // reliably fits within the 4000-char preview_payload column. Every
        // downstream consumer (exportMapPayload, getJobPreview, listJobs)
        // depends only on top_match, coalesce, choices, and scripts — which
        // are preserved verbatim.
        var compact = {
            engine_version: preview.engine_version,
            source: preview.source,
            target: preview.target,
            mappings: [],
            coalesce: preview.coalesce,
            choices: preview.choices,
            scripts: preview.scripts
        };
        var mappings = preview.mappings || [];
        for (var m = 0; m < mappings.length; m++) {
            compact.mappings.push({
                source_column: mappings[m].source_column,
                source_index: mappings[m].source_index,
                inferred_type: mappings[m].inferred_type,
                cardinality: mappings[m].cardinality,
                top_match: mappings[m].top_match
            });
        }
        return compact;
    },

    _choiceEntryFor: function (preview, sourceColumn) {
        var choices = preview.choices || [];
        for (var i = 0; i < choices.length; i++) {
            if (choices[i].source_column === sourceColumn) {
                return choices[i];
            }
        }
        return null;
    },

    type: 'TransformForgeGenerator'
};
