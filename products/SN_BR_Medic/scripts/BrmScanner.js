// BR Medic — BrmScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic static analyzer for server-side script performance. Acquires
// every business rule (sys_script) and script include (sys_script_include)
// read-only, tokenizes each script to separate string literals from code, and
// runs five anti-pattern detectors:
//   1. N+1 query          — GlideRecord query inside a loop
//   2. Unindexed where    — addQuery on a non-indexed field of a high-volume table
//   3. Synchronous heavy  — sync business rule doing expensive work on a hot table
//   4. Recursion/double-write — current.update()/insert()/setWorkflow() re-trigger
//   5. Missing gating     — empty condition or no gs.hasRole() on an expensive body
// Each finding is scored by estimated production impact (table volume x op cost
// x fire frequency x concurrency) into a 0-100 score and a severity class.
// No AI dependency in the scan path — every finding is reproducible.
//
// @class BrmScanner @namespace x_brmedic

var BrmScanner = Class.create();
BrmScanner.prototype = {

    SCAN_TABLE: 'x_brmedic_scan',
    FINDING_TABLE: 'x_brmedic_finding',

    // High-volume tables whose synchronous rules and unindexed filters carry
    // the highest production impact. Row-count estimates are conservative
    // defaults; the scorer multiplies by these volume factors.
    HIGH_VOLUME_TABLES: {
        incident: 1000000,
        task: 5000000,
        sys_audit: 20000000,
        sys_journal_field: 20000000,
        sys_email: 10000000,
        syslog: 50000000,
        sys_user: 100000,
        change_request: 500000,
        problem: 200000,
        sc_req_item: 2000000,
        sys_attachment: 10000000
    },

    // Operation cost weights (relative). A GlideAggregate or a write is more
    // expensive than a single-row get.
    OP_COST: {
        query: 1,
        aggregate: 3,
        write: 4,
        email: 5,
        workflow: 6,
        event: 3
    },

    // Fire-frequency weights: a rule firing on every read of a hot table is
    // far more damaging than one firing on a rare insert.
    FIRE_FREQ: {
        read: 10,
        write: 5,
        insert: 3,
        update: 3,
        delete: 2,
        query: 1
    },

    // Concurrency multiplier for synchronous operations on shared tables.
    CONCURRENCY: {
        sync: 4,
        async: 1
    },

    // Per-pattern scoring weight. Defaults to 1.0 (neutral); tune here to
    // bias the impact score toward anti-patterns that are costlier to fix or
    // more damaging in production.
    PATTERN_WEIGHT: {
        n_plus_one: 1.0,
        unindexed_where: 1.0,
        sync_heavy_op: 1.0,
        recursion: 1.0,
        missing_gating: 1.0
    },

    // Severity thresholds for the 0-100 impact score.
    SEVERITY: {
        critical: 80,
        high: 60,
        medium: 35,
        low: 0
    },

    initialize: function () {
        this._batchSize = 500;
        this._indexCache = {};
        this._scriptsScanned = 0;
    },

    // ---------------------------------------------------------------------
    // Public: run a full scan of all business rules and script includes.
    // Persists findings and returns the scan record sys_id.
    // ---------------------------------------------------------------------
    runScan: function () {
        var scanStart = new GlideDateTime().getValue();
        this._scriptsScanned = 0;
        var scanId = this._createScanRecord('full');
        if (!scanId) {
            gs.error('BrmScanner: scan aborted — could not create scan record');
            return null;
        }
        var findings = this.scanAll();
        var counts = this._persistFindings(scanId, findings);
        var health = this._computeScriptHealth(findings);
        this._finalizeScanRecord(scanId, counts, health, scanStart);
        return scanId;
    },

    // ---------------------------------------------------------------------
    // Public: delta scan — only scripts changed since the high-water mark.
    // ---------------------------------------------------------------------
    runDeltaScan: function () {
        var scanStart = new GlideDateTime().getValue();
        this._scriptsScanned = 0;
        var hwm = this._getHighWaterMark();
        var scanId = this._createScanRecord('delta');
        if (!scanId) {
            gs.error('BrmScanner: delta scan aborted — could not create scan record');
            return null;
        }
        var findings = this.scanChanged(hwm);
        var counts = this._persistFindings(scanId, findings);
        var health = this._computeScriptHealth(findings);
        this._finalizeScanRecord(scanId, counts, health, scanStart);
        return scanId;
    },

    // ---------------------------------------------------------------------
    // Public: scan every business rule and script include, returning an
    // array of finding objects (not yet persisted).
    // ---------------------------------------------------------------------
    scanAll: function () {
        var findings = [];
        findings = findings.concat(this._scanBusinessRules(''));
        findings = findings.concat(this._scanScriptIncludes(''));
        return findings;
    },

    // ---------------------------------------------------------------------
    // Public: scan only scripts whose sys_updated_on is after the given
    // high-water mark (empty string = scan everything).
    // ---------------------------------------------------------------------
    scanChanged: function (highWaterMark) {
        var findings = [];
        findings = findings.concat(this._scanBusinessRules(highWaterMark));
        findings = findings.concat(this._scanScriptIncludes(highWaterMark));
        return findings;
    },

    // ---------------------------------------------------------------------
    // Business rule acquisition + detection.
    // ---------------------------------------------------------------------
    _scanBusinessRules: function (highWaterMark) {
        var findings = [];
        var gr = new GlideRecord('sys_script');
        gr.addNotNullQuery('script');
        if (highWaterMark) {
            gr.addQuery('sys_updated_on', '>', highWaterMark);
        }
        gr.setLimit(this._batchSize);
        gr.query();
        while (gr.next()) {
            var script = gr.getValue('script') || '';
            if (!script) { continue; }
            this._scriptsScanned++;
            var meta = {
                source_type: 'business_rule',
                source_name: gr.getValue('name') || gr.getUniqueValue(),
                source_sys_id: gr.getUniqueValue(),
                table_name: gr.getValue('collection') || '',
                condition: gr.getValue('condition') || '',
                when: gr.getValue('when') || '',
                order: parseInt(gr.getValue('order'), 10) || 0
            };
            findings = findings.concat(this._analyzeScript(script, meta));
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Script include acquisition + detection.
    // ---------------------------------------------------------------------
    _scanScriptIncludes: function (highWaterMark) {
        var findings = [];
        var gr = new GlideRecord('sys_script_include');
        gr.addNotNullQuery('script');
        if (highWaterMark) {
            gr.addQuery('sys_updated_on', '>', highWaterMark);
        }
        gr.setLimit(this._batchSize);
        gr.query();
        while (gr.next()) {
            var script = gr.getValue('script') || '';
            if (!script) { continue; }
            this._scriptsScanned++;
            var meta = {
                source_type: 'script_include',
                source_name: gr.getValue('name') || gr.getUniqueValue(),
                source_sys_id: gr.getUniqueValue(),
                table_name: '',
                condition: '',
                when: '',
                order: 0
            };
            findings = findings.concat(this._analyzeScript(script, meta));
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Run all five detectors over a single script body.
    // ---------------------------------------------------------------------
    _analyzeScript: function (script, meta) {
        var findings = [];
        findings = findings.concat(this._detectNPlusOne(script, meta));
        findings = findings.concat(this._detectUnindexedWhere(script, meta));
        findings = findings.concat(this._detectSyncHeavyOp(script, meta));
        findings = findings.concat(this._detectRecursion(script, meta));
        findings = findings.concat(this._detectMissingGating(script, meta));
        return findings;
    },

    // ---------------------------------------------------------------------
    // Detector 1: N+1 query — a GlideRecord query issued inside a loop.
    // ---------------------------------------------------------------------
    _detectNPlusOne: function (script, meta) {
        var findings = [];
        var lines = script.split('\n');
        var loopStack = [];   // entries: { line: N, depth: braceDepthAtBodyStart }
        var braceDepth = 0;
        var loopRegex = /\b(while|for)\s*\(/;
        var forEachRegex = /\.forEach\s*\(/;
        var queryRegex = /new\s+GlideRecord\s*\(|\.query\s*\(/;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var code = this._stripStringLiterals(line);

            var opens = (code.match(/\{/g) || []).length;
            var closes = (code.match(/\}/g) || []).length;
            var isLoop = loopRegex.test(code) || forEachRegex.test(code);

            // A query is "inside a loop" if we are already inside a loop body,
            // or if this line itself opens a loop (same-line body).
            var insideLoop = loopStack.length > 0 || isLoop;

            if (insideLoop && queryRegex.test(code)) {
                var loopLine = isLoop ? (i + 1) : loopStack[loopStack.length - 1].line;
                var table = this._extractTableName(code);
                var opCost = this.OP_COST.query;
                var score = this._scoreFinding('n_plus_one', table, opCost, 'query', 'sync');
                findings.push({
                    anti_pattern: 'n_plus_one',
                    severity: this._severityFor(score),
                    table_name: table,
                    line_number: i + 1,
                    snippet: this._snippet(line),
                    detail: 'GlideRecord query issued inside a loop (loop opened at line ' +
                        loopLine + '). Each iteration issues a separate query.',
                    impact_score: score
                });
            }

            // Update loop stack and brace depth.
            if (isLoop) {
                loopStack.push({ line: i + 1, depth: braceDepth + opens });
            }
            braceDepth += opens - closes;
            while (loopStack.length > 0 && braceDepth < loopStack[loopStack.length - 1].depth) {
                loopStack.pop();
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Detector 2: unindexed where — addQuery/addEncodedQuery on a non-indexed
    // field.
    // ---------------------------------------------------------------------
    _detectUnindexedWhere: function (script, meta) {
        var findings = [];
        var lines = script.split('\n');
        var currentTable = meta.table_name || '';
        var grRegex = /new\s+GlideRecord\s*\(\s*['"]([^'"]+)['"]/;
        var addQueryRegex = /\.addQuery\s*\(\s*['"]([^'"]+)['"]/;
        var addEncodedRegex = /\.addEncodedQuery\s*\(\s*['"]([^'"]+)['"]/;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var code = this._stripStringLiterals(line);

            var grMatch = code.match(grRegex);
            if (grMatch) {
                currentTable = grMatch[1];
            }

            var qMatch = code.match(addQueryRegex);
            if (qMatch) {
                this._checkFieldIndex(findings, currentTable || meta.table_name, qMatch[1], i + 1, line);
            }

            var encMatch = code.match(addEncodedRegex);
            if (encMatch) {
                var fields = this._extractEncodedFields(encMatch[1]);
                for (var fi = 0; fi < fields.length; fi++) {
                    this._checkFieldIndex(findings, currentTable || meta.table_name, fields[fi], i + 1, line);
                }
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Check a single field's index state and emit a finding if unindexed or
    // not the leading column of a composite index.
    // ---------------------------------------------------------------------
    _checkFieldIndex: function (findings, table, field, lineNumber, line) {
        if (!table) { return; }
        var indexState = this._checkIndex(table, field);
        if (indexState === 'none') {
            var score = this._scoreFinding('unindexed_where', table, this.OP_COST.query, 'query', 'sync');
            findings.push({
                anti_pattern: 'unindexed_where',
                severity: this._severityFor(score),
                table_name: table,
                line_number: lineNumber,
                snippet: this._snippet(line),
                detail: 'addQuery on field "' + field + '" of table "' + table +
                    '" which has no index. Full table scan on every query.',
                impact_score: score
            });
        } else if (indexState === 'not_leading') {
            var score2 = this._scoreFinding('unindexed_where', table, this.OP_COST.query, 'query', 'sync') - 10;
            if (score2 < 0) { score2 = 0; }
            findings.push({
                anti_pattern: 'unindexed_where',
                severity: this._severityFor(score2),
                table_name: table,
                line_number: lineNumber,
                snippet: this._snippet(line),
                detail: 'addQuery on field "' + field + '" of table "' + table +
                    '" which is indexed but not as the leading column of a composite index.',
                impact_score: score2
            });
        }
    },

    // ---------------------------------------------------------------------
    // Extract field names from an encoded query string (e.g.
    // "active=true^priority=1^ORstate=2"). Splits on '^', strips leading
    // boolean/query operators, and skips ORDERBY clauses.
    // ---------------------------------------------------------------------
    _extractEncodedFields: function (encodedQuery) {
        var fields = [];
        var parts = encodedQuery.split('^');
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i];
            var eq = seg.indexOf('=');
            if (eq <= 0) { continue; }
            var field = seg.substring(0, eq);
            field = field.replace(/^(OR|NQ)+/, '');
            if (field && !/^ORDERBY(DESC)?$/i.test(field)) {
                fields.push(field);
            }
        }
        return fields;
    },

    // ---------------------------------------------------------------------
    // Detector 3: synchronous heavy operation on a high-volume table.
    // ---------------------------------------------------------------------
    _detectSyncHeavyOp: function (script, meta) {
        var findings = [];
        if (meta.source_type !== 'business_rule') { return findings; }
        if (meta.when === 'async') { return findings; }
        if (!this.HIGH_VOLUME_TABLES[meta.table_name]) { return findings; }

        var lines = script.split('\n');
        var heavyRegex = /GlideAggregate|\.setWorkflow\s*\(|gs\.eventQueue|new\s+GlideEmailOutbound|\.send\s*\(|\.insert\s*\(|\.update\s*\(/;
        for (var i = 0; i < lines.length; i++) {
            var code = this._stripStringLiterals(lines[i]);
            if (heavyRegex.test(code)) {
                var opCost = this._opCostFor(code);
                var score = this._scoreFinding('sync_heavy_op', meta.table_name, opCost, 'write', 'sync');
                findings.push({
                    anti_pattern: 'sync_heavy_op',
                    severity: this._severityFor(score),
                    table_name: meta.table_name,
                    line_number: i + 1,
                    snippet: this._snippet(lines[i]),
                    detail: 'Synchronous business rule on high-volume table "' + meta.table_name +
                        '" performs an expensive operation. Consider making the rule async or moving the work off the transaction.',
                    impact_score: score
                });
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Detector 4: recursion / double-write — current.update()/insert()/
    // setWorkflow() re-trigger the rule or cause a second write.
    // ---------------------------------------------------------------------
    _detectRecursion: function (script, meta) {
        var findings = [];
        if (meta.source_type !== 'business_rule') { return findings; }
        var lines = script.split('\n');
        var recurRegex = /current\.(update|insert|setWorkflow)\s*\(/;
        for (var i = 0; i < lines.length; i++) {
            var code = this._stripStringLiterals(lines[i]);
            if (recurRegex.test(code)) {
                var score = this._scoreFinding('recursion', meta.table_name, this.OP_COST.write, 'write', 'sync');
                findings.push({
                    anti_pattern: 'recursion',
                    severity: this._severityFor(score),
                    table_name: meta.table_name,
                    line_number: i + 1,
                    snippet: this._snippet(lines[i]),
                    detail: 'current.' + code.match(recurRegex)[1] + '() inside a business rule re-triggers the same rule or causes a second write to the same record, producing recursion or duplicate audit/journal entries.',
                    impact_score: score
                });
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Detector 5: missing gating — empty condition or no gs.hasRole() on an
    // expensive body.
    // ---------------------------------------------------------------------
    _detectMissingGating: function (script, meta) {
        var findings = [];
        if (meta.source_type !== 'business_rule') { return findings; }
        if (!this.HIGH_VOLUME_TABLES[meta.table_name]) { return findings; }

        var hasRole = script.indexOf('gs.hasRole') !== -1;
        var emptyCondition = !meta.condition || meta.condition === 'true' || meta.condition === '1==1';

        if (emptyCondition) {
            var score = this._scoreFinding('missing_gating', meta.table_name, this.OP_COST.query, 'read', 'sync');
            findings.push({
                anti_pattern: 'missing_gating',
                severity: this._severityFor(score),
                table_name: meta.table_name,
                line_number: 1,
                snippet: this._snippet(script.split('\n')[0] || ''),
                detail: 'Business rule on high-volume table "' + meta.table_name +
                    '" has an empty (trivially-true) condition and fires on every read/write.',
                impact_score: score
            });
        } else if (!hasRole) {
            var score2 = this._scoreFinding('missing_gating', meta.table_name, this.OP_COST.query, 'read', 'sync') - 15;
            if (score2 < 0) { score2 = 0; }
            findings.push({
                anti_pattern: 'missing_gating',
                severity: this._severityFor(score2),
                table_name: meta.table_name,
                line_number: 1,
                snippet: this._snippet(script.split('\n')[0] || ''),
                detail: 'Business rule on high-volume table "' + meta.table_name +
                    '" lacks gs.hasRole() gating on an expensive body.',
                impact_score: score2
            });
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Impact scoring: table volume x op cost x fire frequency x concurrency x
    // pattern weight, normalized to 0-100.
    // ---------------------------------------------------------------------
    _scoreFinding: function (antiPattern, tableName, opCost, fireFreq, concurrency) {
        var volume = this.HIGH_VOLUME_TABLES[tableName] || 1000;
        var volumeFactor = Math.min(10, Math.max(1, Math.log(volume) / Math.log(10) - 2));
        var freq = this.FIRE_FREQ[fireFreq] || 1;
        var conc = this.CONCURRENCY[concurrency] || 1;
        var weight = this.PATTERN_WEIGHT[antiPattern] || 1;
        var raw = volumeFactor * opCost * freq * conc * weight;
        // Normalize: raw ranges roughly 1..240; map to 0..100 with a log curve.
        var score = Math.round(Math.min(100, Math.max(0, raw * 2.5)));
        return score;
    },

    _severityFor: function (score) {
        if (score >= this.SEVERITY.critical) { return 'critical'; }
        if (score >= this.SEVERITY.high) { return 'high'; }
        if (score >= this.SEVERITY.medium) { return 'medium'; }
        return 'low';
    },

    _opCostFor: function (code) {
        if (code.indexOf('GlideEmailOutbound') !== -1 || code.indexOf('.send(') !== -1) { return this.OP_COST.email; }
        if (code.indexOf('.setWorkflow(') !== -1) { return this.OP_COST.workflow; }
        if (code.indexOf('gs.eventQueue') !== -1) { return this.OP_COST.event; }
        if (code.indexOf('GlideAggregate') !== -1) { return this.OP_COST.aggregate; }
        if (code.indexOf('.insert(') !== -1 || code.indexOf('.update(') !== -1) { return this.OP_COST.write; }
        return this.OP_COST.query;
    },

    // ---------------------------------------------------------------------
    // Index cross-reference: check whether a field is indexed on a table.
    // Returns 'indexed', 'not_leading', or 'none'.
    // ---------------------------------------------------------------------
    _checkIndex: function (table, field) {
        var cacheKey = table + ':' + field;
        if (this._indexCache[cacheKey] !== undefined) {
            return this._indexCache[cacheKey];
        }
        var result = 'none';
        var gr = new GlideRecord('sys_index');
        gr.addQuery('table', table);
        gr.addQuery('element', field);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var position = parseInt(gr.getValue('position'), 10) || 0;
            result = (position === 0) ? 'indexed' : 'not_leading';
        }
        this._indexCache[cacheKey] = result;
        return result;
    },

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    _extractTableName: function (code) {
        var m = code.match(/new\s+GlideRecord\s*\(\s*['"]([^'"]+)['"]/);
        return m ? m[1] : '';
    },

    _stripStringLiterals: function (line) {
        var out = line;
        out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''");
        return out;
    },

    _snippet: function (line) {
        var trimmed = line.replace(/^\s+/, '');
        if (trimmed.length > 200) { return trimmed.substring(0, 200) + '...'; }
        return trimmed;
    },

    // ---------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------
    _createScanRecord: function (scanType) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        gr.initialize();
        gr.setValue('scan_type', scanType);
        gr.setValue('status', 'running');
        gr.setValue('started_at', new GlideDateTime().getValue());
        gr.setValue('scripts_scanned', 0);
        gr.setValue('findings_count', 0);
        gr.setValue('critical_count', 0);
        gr.setValue('high_count', 0);
        gr.setValue('medium_count', 0);
        gr.setValue('low_count', 0);
        gr.setValue('high_water_mark', this._getHighWaterMark());
        gr.setWorkflow(false);
        try {
            return gr.insert();
        } catch (e) {
            gs.error('BrmScanner: failed to create scan record: ' + e.message);
            return null;
        }
    },

    _persistFindings: function (scanId, findings) {
        var counts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var gr = new GlideRecord(this.FINDING_TABLE);
            gr.initialize();
            gr.setValue('scan', scanId);
            gr.setValue('anti_pattern', f.anti_pattern);
            gr.setValue('severity', f.severity);
            gr.setValue('source_type', f.source_type);
            gr.setValue('source_name', f.source_name);
            gr.setValue('source_sys_id', f.source_sys_id);
            gr.setValue('table_name', f.table_name);
            gr.setValue('line_number', f.line_number);
            gr.setValue('snippet', f.snippet);
            gr.setValue('detail', f.detail);
            gr.setValue('impact_score', f.impact_score);
            gr.setValue('status', 'open');
            gr.setWorkflow(false);
            try {
                gr.insert();
            } catch (e) {
                gs.error('BrmScanner: failed to persist finding: ' + e.message);
                continue;
            }
            counts[f.severity]++;
        }
        return counts;
    },

    _computeScriptHealth: function (findings) {
        // Aggregate per-script health: group findings by source, sum impact.
        var health = {};
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var key = f.source_type + ':' + f.source_name;
            if (!health[key]) {
                health[key] = { source_type: f.source_type, source_name: f.source_name, total_score: 0, finding_count: 0 };
            }
            health[key].total_score += f.impact_score;
            health[key].finding_count++;
        }
        var list = [];
        for (var k in health) {
            if (health.hasOwnProperty(k)) { list.push(health[k]); }
        }
        list.sort(function (a, b) { return b.total_score - a.total_score; });
        return list;
    },

    _finalizeScanRecord: function (scanId, counts, health, highWaterMark) {
        if (!scanId) { return; }
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanId)) { return; }
        gr.setValue('status', 'completed');
        gr.setValue('completed_at', new GlideDateTime().getValue());
        gr.setValue('scripts_scanned', this._scriptsScanned);
        gr.setValue('findings_count', counts.critical + counts.high + counts.medium + counts.low);
        gr.setValue('critical_count', counts.critical);
        gr.setValue('high_count', counts.high);
        gr.setValue('medium_count', counts.medium);
        gr.setValue('low_count', counts.low);
        gr.setValue('health_json', JSON.stringify(health));
        gr.setValue('high_water_mark', highWaterMark);
        gr.setWorkflow(false);
        try {
            gr.update();
        } catch (e) {
            gs.error('BrmScanner: failed to finalize scan record: ' + e.message);
        }
    },

    _getHighWaterMark: function () {
        var gr = new GlideRecord(this.SCAN_TABLE);
        gr.addQuery('status', 'completed');
        gr.orderByDesc('high_water_mark');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('high_water_mark');
        }
        return '';
    },

    type: 'BrmScanner'
};
