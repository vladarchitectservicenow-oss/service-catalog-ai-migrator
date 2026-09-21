// TransformForge — TransformForgeEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic core of the TransformForge scoped application.
// Reads a source-file sample (CSV header + rows) and the target table's
// schema (sys_dictionary + sys_choice), then proposes a complete transform
// map: field mappings, coalesce keys, choice wiring, and transform scripts.
//
// This Script Include is PURE computation — it never writes to the scoped
// tables and never mutates platform records. Persistence and record
// generation are the responsibility of TransformForgeGenerator.
//
// All logic is ES5-compatible (Rhino): no arrow functions, no let/const,
// no template literals, no Object.values, no for...of.
//
// @class TransformForgeEngine @namespace x_sntf
var TransformForgeEngine = Class.create();
TransformForgeEngine.prototype = {

    ENGINE_VERSION: '1.0.0',

    // ----------------------------------------------------------------------
    // Initialize
    // ----------------------------------------------------------------------
    initialize: function () {
        this._gs = null;
    },

    // ----------------------------------------------------------------------
    // SOURCE PARSER
    // Detect delimiter, extract header + sample rows, infer per-column
    // type, distinct values, cardinality, null ratio, and value shape.
    // Returns { columns: [...], row_count, delimiter }
    // ----------------------------------------------------------------------
    parseSource: function (csvText, options) {
        var opts = options || {};
        var sampleLimit = opts.sampleLimit || 100;
        var text = (csvText || '');

        if (!text) {
            return { ok: false, error: 'EMPTY_SOURCE', message: 'No source content provided' };
        }

        var delimiter = this._detectDelimiter(text);
        var lines = this._splitLines(text);

        if (lines.length < 2) {
            return { ok: false, error: 'NO_HEADER_ROWS', message: 'Source must contain a header row and at least one data row' };
        }

        var header = this._parseRow(lines[0], delimiter);
        if (!header || header.length === 0) {
            return { ok: false, error: 'BAD_HEADER', message: 'Could not parse the header row' };
        }

        // Normalize / dedupe header names (empty or duplicate headers get a
        // synthetic suffix so every column has a unique, addressable name).
        var columns = [];
        var seen = {};
        for (var h = 0; h < header.length; h++) {
            var raw = (header[h] || '').trim();
            var name = raw || ('column_' + (h + 1));
            var key = name.toLowerCase();
            if (seen[key]) {
                seen[key]++;
                name = name + '_' + seen[key];
                key = name.toLowerCase();
            } else {
                seen[key] = 1;
            }
            columns.push({
                index: h,
                name: name,
                raw_header: raw,
                samples: [],
                distinct: {},
                non_null: 0,
                total: 0,
                inferred_type: null,
                shapes: {}
            });
        }

        // Parse sample rows.
        var rowCount = 0;
        for (var i = 1; i < lines.length && rowCount < sampleLimit; i++) {
            var line = lines[i];
            if (!line || !line.trim()) { continue; }
            var cells = this._parseRow(line, delimiter);
            rowCount++;
            for (var c = 0; c < columns.length; c++) {
                var val = (c < cells.length) ? cells[c] : '';
                val = (val === null || val === undefined) ? '' : String(val).trim();
                var col = columns[c];
                col.total++;
                if (val !== '') {
                    col.non_null++;
                    col.distinct[val] = (col.distinct[val] || 0) + 1;
                    if (col.samples.length < 5) { col.samples.push(val); }
                    var shape = this._detectShape(val);
                    col.shapes[shape] = (col.shapes[shape] || 0) + 1;
                }
            }
        }

        // Finalize per-column inference.
        for (var c2 = 0; c2 < columns.length; c2++) {
            var col2 = columns[c2];
            var distinctKeys = [];
            for (var k in col2.distinct) {
                if (col2.distinct.hasOwnProperty(k)) { distinctKeys.push(k); }
            }
            col2.distinct_count = distinctKeys.length;
            col2.cardinality = (col2.total > 0) ? (col2.distinct_count / col2.total) : 0;
            col2.null_ratio = (col2.total > 0) ? ((col2.total - col2.non_null) / col2.total) : 1;
            col2.inferred_type = this._inferType(col2);
            col2.distinct_values = distinctKeys.slice(0, 30);
        }

        return {
            ok: true,
            delimiter: delimiter,
            row_count: rowCount,
            columns: columns
        };
    },

    // ----------------------------------------------------------------------
    // SCHEMA FINGERPRINT BUILDER
    // Reads sys_dictionary + sys_choice (+ sys_db_object for reference
    // resolution) for the target table and produces a per-field signature.
    // Returns { ok, fields: [...] }
    // ----------------------------------------------------------------------
    buildSchemaFingerprint: function (targetTable) {
        var table = (targetTable || '').trim();
        if (!table) {
            return { ok: false, error: 'NO_TARGET_TABLE', message: 'A target table is required' };
        }

        // Validate the table exists and is readable.
        var objGr = new GlideRecord('sys_db_object');
        objGr.addQuery('name', table);
        objGr.setLimit(1);
        objGr.query();
        if (!objGr.next()) {
            return { ok: false, error: 'UNKNOWN_TABLE', message: 'Target table does not exist: ' + table };
        }
        var tableLabel = objGr.getValue('label') || table;

        var fields = [];
        var dictGr = new GlideRecord('sys_dictionary');
        dictGr.addQuery('name', table);
        dictGr.addQuery('active', true);
        dictGr.orderBy('element');
        dictGr.query();
        while (dictGr.next()) {
            var element = dictGr.getValue('element');
            var internalType = dictGr.getValue('internal_type');
            var maxLength = dictGr.getValue('max_length');
            var mandatory = (dictGr.getValue('mandatory') === 'true' || dictGr.getValue('mandatory') === true);
            var readOnly = (dictGr.getValue('read_only') === 'true' || dictGr.getValue('read_only') === true);
            var label = dictGr.getValue('label') || element;

            var field = {
                name: element,
                label: label,
                type: internalType,
                ref_table: '',
                max_length: maxLength,
                mandatory: mandatory,
                read_only: readOnly,
                choices: [],
                unique: false,
                indexed: false
            };

            // Reference resolution.
            if (internalType === 'reference') {
                field.ref_table = dictGr.getValue('reference') || '';
            }

            // Choice values.
            if (internalType === 'choice' || internalType === 'string') {
                field.choices = this._readChoices(table, element);
            }

            fields.push(field);
        }

        // Uniqueness via sys_dictionary attributes (unique attribute) and
        // sys_index detection on single-field indexes.
        var idxGr = new GlideRecord('sys_index');
        idxGr.addQuery('table', table);
        idxGr.query();
        while (idxGr.next()) {
            // sys_index stores one row per indexed field in the 'element'
            // column (table + element + unique) — there is no 'fields' column.
            var elementName = idxGr.getValue('element') || '';
            var uniqueFlag = idxGr.getValue('unique') || 'false';
            for (var f = 0; f < fields.length; f++) {
                if (fields[f].name === elementName) {
                    fields[f].indexed = true;
                    if (uniqueFlag === 'true') { fields[f].unique = true; }
                }
            }
        }

        return {
            ok: true,
            table: table,
            table_label: tableLabel,
            fields: fields,
            fingerprint_hash: this._fingerprintHash(table, fields)
        };
    },

    // ----------------------------------------------------------------------
    // MATCHER (deterministic fuzzy scoring)
    // For each source column, score every target field and rank candidates.
    // Returns { ok, mappings: [...] } where each mapping has a candidates[]
    // list (sorted descending by confidence) and a top match.
    // ----------------------------------------------------------------------
    match: function (parsedSource, fingerprint) {
        var columns = parsedSource.columns;
        var fields = fingerprint.fields;
        var mappings = [];

        for (var c = 0; c < columns.length; c++) {
            var col = columns[c];
            var candidates = [];
            for (var f = 0; f < fields.length; f++) {
                var field = fields[f];
                var score = this._scoreColumnField(col, field);
                if (score > 0) {
                    candidates.push({
                        field: field.name,
                        label: field.label,
                        type: field.type,
                        score: score,
                        confidence: this._confidenceFor(score),
                        signals: this._matchSignals(col, field)
                    });
                }
            }
            candidates.sort(function (a, b) { return b.score - a.score; });

            var top = (candidates.length > 0) ? candidates[0] : null;
            mappings.push({
                source_column: col.name,
                source_index: col.index,
                inferred_type: col.inferred_type,
                cardinality: col.cardinality,
                candidates: candidates.slice(0, 5),
                top_match: top
            });
        }

        return { ok: true, mappings: mappings };
    },

    // ----------------------------------------------------------------------
    // COALESCE KEY RECOMMENDER
    // Flags fields that are real identity keys: unique, sys_id-adjacent
    // (external identifier / email / employee number / serial number), or
    // indexed + high-cardinality in the source.
    // ----------------------------------------------------------------------
    recommendCoalesce: function (mappings, fingerprint) {
        var fields = fingerprint.fields;
        var byName = {};
        for (var f = 0; f < fields.length; f++) {
            byName[fields[f].name] = fields[f];
        }

        var recommendations = [];
        for (var m = 0; m < mappings.length; m++) {
            var map = mappings[m];
            if (!map.top_match) { continue; }
            var field = byName[map.top_match.field];
            var col = this._colFor(mappings, map.source_column);

            var reason = this._coalesceReason(field, col, map.top_match);
            recommendations.push({
                source_column: map.source_column,
                target_field: map.top_match.field,
                coalesce: reason.recommend,
                reason: reason.text
            });
        }
        return recommendations;
    },

    // ----------------------------------------------------------------------
    // CHOICE MAPPING AUTO-WIRING
    // For choice-typed target fields, match source distinct values against
    // sys_choice labels/values; flag orphans (no matching target choice).
    // ----------------------------------------------------------------------
    wireChoices: function (mappings, parsedSource, fingerprint) {
        var fields = fingerprint.fields;
        var byName = {};
        for (var f = 0; f < fields.length; f++) {
            byName[fields[f].name] = fields[f];
        }
        var cols = {};
        for (var c = 0; c < parsedSource.columns.length; c++) {
            cols[parsedSource.columns[c].name] = parsedSource.columns[c];
        }

        var results = [];
        for (var m = 0; m < mappings.length; m++) {
            var map = mappings[m];
            if (!map.top_match) { continue; }
            var field = byName[map.top_match.field];
            var col = cols[map.source_column];

            var entry = {
                source_column: map.source_column,
                target_field: map.top_match.field,
                is_choice: false,
                choice_map: [],
                orphans: []
            };

            if (field && field.choices && field.choices.length > 0 && col) {
                entry.is_choice = true;
                var choiceByLabel = {};
                var choiceByValue = {};
                for (var ch = 0; ch < field.choices.length; ch++) {
                    var choice = field.choices[ch];
                    choiceByLabel[String(choice.label).toLowerCase()] = choice.value;
                    choiceByValue[String(choice.value).toLowerCase()] = choice.value;
                }
                var seenPair = {};
                for (var v = 0; v < col.distinct_values.length; v++) {
                    var srcVal = col.distinct_values[v];
                    var lkey = srcVal.toLowerCase();
                    var matched = null;
                    if (choiceByLabel.hasOwnProperty(lkey)) {
                        matched = choiceByLabel[lkey];
                    } else if (choiceByValue.hasOwnProperty(lkey)) {
                        matched = choiceByValue[lkey];
                    }
                    if (matched !== null) {
                        var pairKey = srcVal + '=>' + matched;
                        if (!seenPair[pairKey]) {
                            seenPair[pairKey] = true;
                            entry.choice_map.push({ source: srcVal, target: matched });
                        }
                    } else {
                        entry.orphans.push(srcVal);
                    }
                }
            }
            results.push(entry);
        }
        return results;
    },

    // ----------------------------------------------------------------------
    // TRANSFORM SCRIPT SUGGESTER
    // For low-confidence / multi-field / type-coercion columns, propose a
    // reviewable script template (field split, date parse, null normalize).
    // ----------------------------------------------------------------------
    suggestScripts: function (mappings, fingerprint) {
        var scripts = [];
        for (var m = 0; m < mappings.length; m++) {
            var map = mappings[m];
            if (!map.top_match) {
                scripts.push({
                    source_column: map.source_column,
                    target_field: '',
                    script: '',
                    reason: 'No target field matched — column requires manual disposition'
                });
                continue;
            }
            var conf = map.top_match.confidence;
            var script = null;

            if (conf === 'low') {
                script = this._scriptForLowConfidence(map);
            } else if (map.inferred_type === 'date' && map.top_match.type !== 'glide_date_time') {
                script = this._scriptForDateParse(map);
            }

            if (script) {
                scripts.push({
                    source_column: map.source_column,
                    target_field: map.top_match.field,
                    script: script,
                    reason: 'Suggested transform for review (not applied automatically)'
                });
            }
        }
        return scripts;
    },

    // ----------------------------------------------------------------------
    // Full deterministic pipeline (parser -> fingerprint -> match -> coalesce
    // -> choice -> scripts), returned as a single reviewable preview object.
    // ----------------------------------------------------------------------
    preview: function (csvText, targetTable, options) {
        var parsed = this.parseSource(csvText, options);
        if (!parsed.ok) { return parsed; }

        var fingerprint = this.buildSchemaFingerprint(targetTable);
        if (!fingerprint.ok) { return fingerprint; }

        var matched = this.match(parsed, fingerprint);
        var coalesce = this.recommendCoalesce(matched.mappings, fingerprint);
        var choices = this.wireChoices(matched.mappings, parsed, fingerprint);
        var scripts = this.suggestScripts(matched.mappings, fingerprint);

        return {
            ok: true,
            engine_version: this.ENGINE_VERSION,
            source: {
                row_count: parsed.row_count,
                delimiter: parsed.delimiter,
                column_count: parsed.columns.length
            },
            target: {
                table: fingerprint.table,
                table_label: fingerprint.table_label,
                field_count: fingerprint.fields.length,
                fingerprint_hash: fingerprint.fingerprint_hash
            },
            mappings: matched.mappings,
            coalesce: coalesce,
            choices: choices,
            scripts: scripts
        };
    },

    // ======================================================================
    // INTERNAL HELPERS
    // ======================================================================

    _colFor: function (mappings, sourceName) {
        // Source column metadata is embedded in the mapping's top_match;
        // return a lightweight object carrying the source cardinality signal
        // via the mapping's inferred_type and candidate confidence.
        for (var m = 0; m < mappings.length; m++) {
            if (mappings[m].source_column === sourceName) {
                return {
                    name: sourceName,
                    inferred_type: mappings[m].inferred_type,
                    cardinality: mappings[m].cardinality
                };
            }
        }
        return { name: sourceName, inferred_type: 'string', cardinality: 0 };
    },

    _detectDelimiter: function (text) {
        var firstLine = text.split(/\r?\n/)[0] || '';
        var counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
        for (var i = 0; i < firstLine.length; i++) {
            var ch = firstLine.charAt(i);
            if (counts.hasOwnProperty(ch)) { counts[ch]++; }
        }
        var best = ',';
        var bestCount = -1;
        for (var d in counts) {
            if (counts.hasOwnProperty(d) && counts[d] > bestCount) {
                best = d;
                bestCount = counts[d];
            }
        }
        return best;
    },

    _splitLines: function (text) {
        return text.split(/\r?\n/);
    },

    _parseRow: function (line, delimiter) {
        // Minimal CSV row splitter supporting double-quoted fields and
        // escaped quotes. Deliberately simple — bounded sample parsing only.
        var cells = [];
        var cur = '';
        var inQuotes = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line.charAt(i);
            if (inQuotes) {
                if (ch === '"') {
                    if (line.charAt(i + 1) === '"') {
                        cur += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cur += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === delimiter) {
                    cells.push(cur);
                    cur = '';
                } else {
                    cur += ch;
                }
            }
        }
        cells.push(cur);
        return cells;
    },

    _detectShape: function (val) {
        if (/^\d+$/.test(val)) { return 'integer'; }
        if (/^\d+\.\d+$/.test(val)) { return 'decimal'; }
        if (/^[-+]?\d{4}-\d{2}-\d{2}/.test(val)) { return 'date'; }
        if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(val)) { return 'date'; }
        if (/^(true|false|yes|no|0|1)$/i.test(val)) { return 'boolean'; }
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) { return 'email'; }
        if (/^[0-9a-f]{32}$/i.test(val)) { return 'sys_id'; }
        return 'string';
    },

    _inferType: function (col) {
        if (col.total === 0) { return 'empty'; }
        var dominant = 'string';
        var best = 0;
        for (var s in col.shapes) {
            if (col.shapes.hasOwnProperty(s) && col.shapes[s] > best) {
                best = col.shapes[s];
                dominant = s;
            }
        }
        if (best / col.non_null >= 0.9) {
            return dominant;
        }
        // Mixed values (< 90% shape dominance) are treated as plain strings
        // so a heterogeneous column is never mistaken for a typed column.
        return 'string';
    },

    _readChoices: function (table, element) {
        var out = [];
        var gr = new GlideRecord('sys_choice');
        gr.addQuery('name', table);
        gr.addQuery('element', element);
        gr.addQuery('inactive', false);
        gr.orderBy('sequence');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            out.push({
                value: gr.getValue('value'),
                label: gr.getValue('label') || gr.getValue('value')
            });
        }
        return out;
    },

    _scoreColumnField: function (col, field) {
        var score = 0;

        // 1. Exact name match (case-insensitive, normalized).
        var srcName = col.name.toLowerCase();
        var fName = field.name.toLowerCase();
        var fLabel = field.label.toLowerCase();
        if (srcName === fName) { score += 60; }
        else if (srcName === fLabel) { score += 55; }
        else {
            // 2. Levenshtein similarity on name.
            var dist = this._levenshtein(srcName, fName);
            var maxLen = Math.max(srcName.length, fName.length);
            if (maxLen > 0) {
                var sim = 1 - (dist / maxLen);
                if (sim >= 0.6) { score += Math.round(30 * sim); }
            }
            // 3. Token overlap on label.
            var overlap = this._tokenOverlap(srcName, fLabel);
            if (overlap > 0) { score += Math.round(25 * overlap); }
        }

        // 4. Type compatibility.
        score += this._typeCompatibility(col.inferred_type, field.type);

        // 5. Choice-list overlap (when source values are categorical and the
        //    target is a choice field).
        if (field.choices && field.choices.length > 0 && col.distinct_values) {
            var labelSet = {};
            var valueSet = {};
            for (var c = 0; c < field.choices.length; c++) {
                labelSet[String(field.choices[c].label).toLowerCase()] = true;
                valueSet[String(field.choices[c].value).toLowerCase()] = true;
            }
            var hits = 0;
            var checked = Math.min(col.distinct_values.length, 20);
            for (var v = 0; v < checked; v++) {
                var key = col.distinct_values[v].toLowerCase();
                if (labelSet[key] || valueSet[key]) { hits++; }
            }
            if (checked > 0) {
                score += Math.round(20 * (hits / checked));
            }
        }

        return score;
    },

    _typeCompatibility: function (srcType, fieldType) {
        // Returns a bounded bonus for compatible source/target types.
        var bonus = 0;
        if (fieldType === 'glide_date_time' && srcType === 'date') { bonus = 15; }
        else if (fieldType === 'boolean' && srcType === 'boolean') { bonus = 15; }
        else if ((fieldType === 'integer' || fieldType === 'decimal') &&
                 (srcType === 'integer' || srcType === 'decimal')) { bonus = 12; }
        else if (fieldType === 'reference' && srcType === 'sys_id') { bonus = 12; }
        else if (fieldType === 'string' && srcType === 'string') { bonus = 6; }
        else if (fieldType === 'string' && srcType === 'email') { bonus = 6; }
        return bonus;
    },

    _confidenceFor: function (score) {
        if (score >= 60) { return 'high'; }
        if (score >= 35) { return 'medium'; }
        if (score > 0) { return 'low'; }
        return 'none';
    },

    _matchSignals: function (col, field) {
        var sig = [];
        if (col.name.toLowerCase() === field.name.toLowerCase()) { sig.push('exact_name'); }
        if (col.name.toLowerCase() === field.label.toLowerCase()) { sig.push('exact_label'); }
        if (this._typeCompatibility(col.inferred_type, field.type) > 0) { sig.push('type_compatible'); }
        return sig;
    },

    _coalesceReason: function (field, col, topMatch) {
        if (!field) {
            return { recommend: false, text: 'No target field resolved' };
        }
        var name = field.name.toLowerCase();
        var idAdjacent = /(sys_id|external|email|employee|number|serial|asset|user_name|u_)/.test(name);
        var highCard = col && typeof col.cardinality === 'number' && col.cardinality >= 0.9;

        if (field.unique) {
            return { recommend: true, text: 'Target field is unique — safe and reliable coalesce key' };
        }
        if (field.indexed && idAdjacent && topMatch.confidence === 'high') {
            return { recommend: true, text: 'Indexed external-identifier field with a high-confidence match' };
        }
        if (field.indexed && highCard) {
            return { recommend: true, text: 'Indexed field with high-cardinality source values' };
        }
        if (name === 'name') {
            return { recommend: false, text: 'Coalescing on "name" is duplicate-prone — verify uniqueness before enabling' };
        }
        return { recommend: false, text: 'No strong identity signal detected' };
    },

    _scriptForLowConfidence: function (map) {
        return '// TransformForge suggested script (review before use)\n' +
               '// Source column "' + map.source_column + '" matched with low confidence.\n' +
               '// Inspect source values and confirm or override the target field.\n' +
               'function onStart(source, target, map) {\n' +
               '    // source.u_' + map.source_column.toLowerCase().replace(/[^a-z0-9_]/g, '_') + ' holds the raw value\n' +
               '}\n';
    },

    _scriptForDateParse: function (map) {
        return '// TransformForge suggested date-normalization script (review before use)\n' +
               '// Source column "' + map.source_column + '" looks like a date but the target\n' +
               '// field is not a glide_date_time. Normalize before import.\n' +
               'function onBefore(source, target, map) {\n' +
               '    var raw = source.u_' + map.source_column.toLowerCase().replace(/[^a-z0-9_]/g, '_') + ';\n' +
               '    if (raw) {\n' +
               '        var gdt = new GlideDateTime();\n' +
               '        gdt.setDisplayValue(raw);\n' +
               '        target.' + String(map.top_match.field).replace(/[^a-z0-9_]/g, '_') + ' = gdt.getValue();\n' +
               '    }\n' +
               '}\n';
    },

    _tokenOverlap: function (a, b) {
        var ta = {};
        var tokens = a.split(/[^a-z0-9]+/);
        for (var i = 0; i < tokens.length; i++) {
            if (tokens[i]) { ta[tokens[i]] = true; }
        }
        var tb = {};
        var tokensB = b.split(/[^a-z0-9]+/);
        for (var j = 0; j < tokensB.length; j++) {
            if (tokensB[j]) { tb[tokensB[j]] = true; }
        }
        var hits = 0;
        var totalA = 0;
        for (var k in ta) { if (ta.hasOwnProperty(k)) { totalA++; if (tb[k]) { hits++; } } }
        if (totalA === 0) { return 0; }
        return hits / totalA;
    },

    _levenshtein: function (a, b) {
        var m = a.length;
        var n = b.length;
        if (m === 0) { return n; }
        if (n === 0) { return m; }
        var prev = [];
        var curr = [];
        for (var i = 0; i <= n; i++) { prev[i] = i; }
        for (var i = 1; i <= m; i++) {
            curr[0] = i;
            for (var j = 1; j <= n; j++) {
                var cost = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
                curr[j] = Math.min(
                    curr[j - 1] + 1,
                    prev[j] + 1,
                    prev[j - 1] + cost
                );
            }
            var tmp = prev;
            prev = curr;
            curr = tmp;
        }
        return prev[n];
    },

    _fingerprintHash: function (table, fields) {
        // Portable, deterministic hash of the schema (name + type + label).
        // Deliberately avoids GlideStringUtil.hashCode() for cross-instance
        // stability — uses a simple FNV-1a over the field signature.
        var parts = [table];
        for (var f = 0; f < fields.length; f++) {
            parts.push(fields[f].name + ':' + fields[f].type);
        }
        var input = parts.join('|');
        var hash = 0x811c9dc5;
        for (var i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        return 'fnv1a_' + hash.toString(16);
    },

    type: 'TransformForgeEngine'
};
