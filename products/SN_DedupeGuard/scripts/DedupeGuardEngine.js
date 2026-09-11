// DedupeGuard — DedupeGuardEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Fuzzy duplicate-detection and scoring engine. Scans configurable tables,
// normalizes candidate fields, blocks records by Soundex key, scores candidate
// pairs with field-weighted Levenshtein similarity, and persists ranked
// candidate pairs to x_snc_ddg_candidate. Read-only with respect to the
// scanned tables — it never mutates source data.
//
// @class DedupeGuardEngine
// @namespace x_snc_ddg
var DedupeGuardEngine = Class.create();
DedupeGuardEngine.prototype = {

    initialize: function () {
        this._config = this._loadConfig();
    },

    // ------------------------------------------------------------------
    // Configuration (system properties — no config table)
    // ------------------------------------------------------------------
    _loadConfig: function () {
        var cfg = {};
        cfg.tables = this._propStr('x_snc_ddg.scan.tables', 'sys_user,incident,cmdb_ci');
        cfg.scanLimit = this._propNum('x_snc_ddg.scan.limit', 2000);
        cfg.autoMergeThreshold = this._propNum('x_snc_ddg.threshold.auto_merge', 85);
        cfg.reviewThreshold = this._propNum('x_snc_ddg.threshold.review', 50);
        cfg.weights = {
            primary: this._propNum('x_snc_ddg.weight.primary', 40),
            secondary: this._propNum('x_snc_ddg.weight.secondary', 25),
            tertiary: this._propNum('x_snc_ddg.weight.tertiary', 20),
            quaternary: this._propNum('x_snc_ddg.weight.quaternary', 15)
        };
        cfg.weightList = this._propStr('x_snc_ddg.weight.list', '40,25,20,15');
        return cfg;
    },

    _propStr: function (name, def) {
        var v = gs.getProperty(name);
        return (v === null || v === undefined || v === '') ? def : v;
    },

    _propNum: function (name, def) {
        var v = gs.getProperty(name);
        if (v === null || v === undefined || v === '') {
            return def;
        }
        var n = parseFloat(v);
        return isNaN(n) ? def : n;
    },

    // ------------------------------------------------------------------
    // Public entry point — scan all configured tables
    // ------------------------------------------------------------------
    scanAll: function () {
        var tables = this._config.tables.split(',');
        var summary = { tables: [], total_candidates: 0, started_on: new GlideDateTime().toString() };
        for (var i = 0; i < tables.length; i++) {
            var t = tables[i].trim();
            if (!t) {
                continue;
            }
            var r = this.scan(t);
            summary.tables.push(r);
            summary.total_candidates += r.candidates;
        }
        summary.completed_on = new GlideDateTime().toString();
        return summary;
    },

    // ------------------------------------------------------------------
    // Public entry point — scan a single table
    // ------------------------------------------------------------------
    scan: function (tableName) {
        var fields = this._matchFields(tableName);
        var records = this._collectRecords(tableName, fields);
        var blocks = this._block(records, fields);
        var candidates = this._compareBlocks(blocks, fields, tableName);
        var persisted = this._persistCandidates(candidates, tableName);

        return {
            table: tableName,
            scanned: records.length,
            blocks: Object.keys(blocks).length,
            candidates: persisted,
            started_on: new GlideDateTime().toString()
        };
    },

    // ------------------------------------------------------------------
    // Match-field profiles per table (configurable via properties)
    // ------------------------------------------------------------------
    _matchFields: function (tableName) {
        var override = this._propStr('x_snc_ddg.fields.' + tableName, '');
        if (override) {
            return override.split(',');
        }
        var profiles = {
            sys_user: ['name', 'email', 'user_name', 'phone'],
            incident: ['short_description', 'caller_id', 'location', 'category'],
            cmdb_ci: ['name', 'serial_number', 'ip_address', 'asset_tag'],
            sc_req_item: ['short_description', 'request', 'cat_item', 'location'],
            task: ['short_description', 'caller_id', 'location', 'category']
        };
        return profiles[tableName] || ['name', 'short_description', 'number', 'email'];
    },

    // ------------------------------------------------------------------
    // Bounded record collection — never a full-table getRowCount()
    // ------------------------------------------------------------------
    _collectRecords: function (tableName, fields) {
        var records = [];
        var gr = new GlideRecord(tableName);
        // cmdb_ci and other tables use install_status, not active.
        if (gr.isValidField('active')) {
            gr.addActiveQuery();
        }
        gr.setLimit(this._config.scanLimit);
        gr.orderByDesc('sys_updated_on');
        gr.query();
        while (gr.next()) {
            var rec = { sys_id: gr.getUniqueValue(), display: gr.getDisplayValue(), fields: {} };
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                rec.fields[f] = gr.getValue(f) || '';
            }
            records.push(rec);
        }
        return records;
    },

    // ------------------------------------------------------------------
    // Blocking — group by Soundex of the primary field to avoid O(n^2)
    // ------------------------------------------------------------------
    _block: function (records, fields) {
        var blocks = {};
        if (!fields || fields.length === 0) {
            return blocks;
        }
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            var primary = this._normalize(r.fields[fields[0]]);
            var key = primary ? this._soundex(primary) : 'EMPTY';
            if (!blocks[key]) {
                blocks[key] = [];
            }
            blocks[key].push(r);
        }
        return blocks;
    },

    // ------------------------------------------------------------------
    // Pairwise comparison within blocks
    // ------------------------------------------------------------------
    _compareBlocks: function (blocks, fields, tableName) {
        var candidates = [];
        var keys = Object.keys(blocks);
        for (var b = 0; b < keys.length; b++) {
            var block = blocks[keys[b]];
            for (var i = 0; i < block.length; i++) {
                for (var j = i + 1; j < block.length; j++) {
                    var a = block[i];
                    var c = block[j];
                    var scored = this._scorePair(a, c, fields);
                    if (scored.confidence >= this._config.reviewThreshold) {
                        candidates.push({
                            record_a: a.sys_id,
                            record_a_display: a.display,
                            record_b: c.sys_id,
                            record_b_display: c.display,
                            confidence: scored.confidence,
                            matched_fields: JSON.stringify(scored.matched),
                            state: scored.confidence >= this._config.autoMergeThreshold ? 'review' : 'new'
                        });
                    }
                }
            }
        }
        return candidates;
    },

    // ------------------------------------------------------------------
    // Field-weighted confidence scoring (0-100)
    // ------------------------------------------------------------------
    _scorePair: function (a, b, fields) {
        var weights = this._weightArray();
        var totalWeight = 0;
        var matched = [];
        var score = 0;

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var w = weights[i] || 10;
            totalWeight += w;
            var av = this._normalize(a.fields[f]);
            var bv = this._normalize(b.fields[f]);
            if (!av && !bv) {
                continue;
            }
            var sim = this._similarity(av, bv);
            score += sim * w;
            if (sim > 0.6) {
                matched.push({ field: f, similarity: Math.round(sim * 100) });
            }
        }

        var confidence = totalWeight > 0 ? Math.round(score / totalWeight * 100) : 0;
        confidence = Math.min(100, Math.max(0, confidence));
        return { confidence: confidence, matched: matched };
    },

    // ------------------------------------------------------------------
    // Weight array — configurable via x_snc_ddg.weight.list (comma-separated)
    // ------------------------------------------------------------------
    _weightArray: function () {
        var parts = this._config.weightList.split(',');
        var weights = [];
        for (var i = 0; i < parts.length; i++) {
            var n = parseFloat(parts[i]);
            weights.push(isNaN(n) ? 0 : n);
        }
        return weights;
    },

    // ------------------------------------------------------------------
    // Normalization — lowercase, trim, collapse whitespace, strip ASCII
    // punctuation only (preserves accented Latin and Cyrillic letters).
    // ------------------------------------------------------------------
    _normalize: function (str) {
        if (!str) {
            return '';
        }
        return String(str)
            .toLowerCase()
            .replace(/[.,;:!?()\[\]{}"'`~@#$%^&*+=|\\<>\/\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    // ------------------------------------------------------------------
    // Levenshtein distance (dynamic programming)
    // ------------------------------------------------------------------
    _levenshtein: function (a, b) {
        if (a === b) {
            return 0;
        }
        if (!a.length) {
            return b.length;
        }
        if (!b.length) {
            return a.length;
        }
        var prev = [];
        var curr = [];
        for (var i = 0; i <= b.length; i++) {
            prev[i] = i;
        }
        for (var i = 1; i <= a.length; i++) {
            curr[0] = i;
            for (var j = 1; j <= b.length; j++) {
                var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + cost
                );
            }
            var tmp = prev;
            prev = curr;
            curr = tmp;
        }
        return prev[b.length];
    },

    // ------------------------------------------------------------------
    // Similarity 0-1 derived from Levenshtein distance
    // ------------------------------------------------------------------
    _similarity: function (a, b) {
        if (!a && !b) {
            return 1;
        }
        if (!a || !b) {
            return 0;
        }
        var maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) {
            return 1;
        }
        var dist = this._levenshtein(a, b);
        return 1 - (dist / maxLen);
    },

    // ------------------------------------------------------------------
    // Soundex phonetic key (standard algorithm, with Latin transliteration)
    // ------------------------------------------------------------------
    _soundex: function (str) {
        if (!str) {
            return '';
        }
        var s = str.toUpperCase();
        // Transliterate common accented Latin characters so phonetic
        // blocking still works for names like "José" / "García".
        var map = {
            'Á': 'A', 'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A', 'Å': 'A',
            'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
            'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
            'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ö': 'O', 'Õ': 'O',
            'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
            'Ñ': 'N', 'Ç': 'C'
        };
        s = s.replace(/[ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ]/g, function (c) { return map[c]; });
        s = s.replace(/[^A-Z]/g, '');
        if (!s.length) {
            return '';
        }
        var first = s.charAt(0);
        var codes = { B: '1', F: '1', P: '1', V: '1', C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2', D: '3', T: '3', L: '4', M: '5', N: '5', R: '6' };
        var out = first;
        var prev = codes[first] || '';
        for (var i = 1; i < s.length && out.length < 4; i++) {
            var c = codes[s.charAt(i)] || '';
            if (c && c !== prev) {
                out += c;
            }
            prev = c;
        }
        while (out.length < 4) {
            out += '0';
        }
        return out;
    },

    // ------------------------------------------------------------------
    // Persistence — dedupe against existing open candidates
    // ------------------------------------------------------------------
    _persistCandidates: function (candidates, tableName) {
        var persisted = 0;
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (this._candidateExists(tableName, c.record_a, c.record_b)) {
                continue;
            }
            try {
                var gr = new GlideRecord('x_snc_ddg_candidate');
                gr.initialize();
                gr.setValue('table_name', tableName);
                gr.setValue('record_a', c.record_a);
                gr.setValue('record_a_display', c.record_a_display);
                gr.setValue('record_b', c.record_b);
                gr.setValue('record_b_display', c.record_b_display);
                gr.setValue('confidence', c.confidence);
                gr.setValue('matched_fields', c.matched_fields);
                gr.setValue('state', c.state);
                gr.setValue('detected_on', new GlideDateTime().toString());
                if (gr.insert()) {
                    persisted++;
                }
            } catch (e) {
                gs.error('x_snc_ddg persist candidate failed: ' + e.message);
            }
        }
        return persisted;
    },

    _candidateExists: function (tableName, a, b) {
        var gr = new GlideRecord('x_snc_ddg_candidate');
        gr.addQuery('table_name', tableName);
        gr.addQuery('record_a', a);
        gr.addQuery('record_b', b);
        gr.addQuery('state', 'IN', 'new,review');
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    // ------------------------------------------------------------------
    // Snapshot for REST GET — ranked candidate list
    // ------------------------------------------------------------------
    snapshot: function (tableName) {
        var candidates = [];
        var gr = new GlideRecord('x_snc_ddg_candidate');
        if (tableName) {
            gr.addQuery('table_name', tableName);
        }
        gr.addQuery('state', 'IN', 'new,review');
        gr.orderByDesc('confidence');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            candidates.push({
                sys_id: gr.getUniqueValue(),
                table_name: gr.getValue('table_name'),
                record_a: gr.getValue('record_a'),
                record_a_display: gr.getValue('record_a_display'),
                record_b: gr.getValue('record_b'),
                record_b_display: gr.getValue('record_b_display'),
                confidence: parseInt(gr.getValue('confidence'), 10) || 0,
                matched_fields: this._parseMatchedFields(gr.getValue('matched_fields')),
                state: gr.getValue('state'),
                detected_on: gr.getValue('detected_on')
            });
        }
        return candidates;
    },

    _parseMatchedFields: function (json) {
        if (!json) {
            return [];
        }
        try {
            var parsed = JSON.parse(json);
            return parsed || [];
        } catch (e) {
            return [];
        }
    },

    type: 'DedupeGuardEngine'
};
