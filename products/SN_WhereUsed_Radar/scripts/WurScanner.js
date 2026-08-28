// WhereUsed Radar — WurScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic code-aware reference scanner and impact scorer. Acquires the
// scripted surface (business rules, script includes, client scripts, UI
// policies, flows, scheduled jobs, dictionary, ACLs, transform maps) read-only,
// tokenizes each script to separate string literals from code, matches
// references to a target object, and classifies each as SAFE / WARN / BREAK.
// No AI dependency in the scan path — every finding is reproducible.
//
// @class WurScanner @namespace x_sn_wur

var WurScanner = Class.create();
WurScanner.prototype = {

    SCAN_TABLE: 'x_sn_wur_scan',
    REFERENCE_TABLE: 'x_sn_wur_reference',

    // Acquisition surface: table name -> { script_field, name_field, source_type }
    // All read-only. Cross-scope read privileges are declared in sys_app.xml.
    ACQUISITION_SURFACE: {
        sys_script:          { script_field: 'script',          name_field: 'name',          source_type: 'business_rule' },
        sys_script_include:  { script_field: 'script',          name_field: 'name',          source_type: 'script_include' },
        sys_script_client:   { script_field: 'script',          name_field: 'name',          source_type: 'client_script' },
        sys_ui_policy:       { script_field: 'script_false',    name_field: 'name',          source_type: 'ui_policy' },
        sys_hub_flow:        { script_field: 'script',          name_field: 'name',          source_type: 'flow' },
        sysauto_script:      { script_field: 'script',          name_field: 'name',          source_type: 'scheduled_job' },
        sys_dictionary:      { script_field: 'calculation',     name_field: 'name',          source_type: 'dictionary' },
        sys_security_acl:    { script_field: 'script',          name_field: 'name',          source_type: 'acl' },
        sys_transform_map:   { script_field: 'source_script',  name_field: 'name',          source_type: 'transform_map' }
    },

    // Reference-type -> risk class mapping. A reference is BREAK when the
    // target's absence would throw or silently corrupt; WARN when it would
    // change behavior (write/conditional); SAFE when read-only.
    RISK_RULES: {
        'GlideRecord':        'BREAK',
        'gr.get':             'BREAK',
        'gr.setValue':        'BREAK',
        'gr.addQuery':        'BREAK',
        'gr.insert':          'BREAK',
        'gr.update':          'BREAK',
        'gr.deleteRecord':    'BREAK',
        'gr.getValue':        'SAFE',
        'gr.getUniqueValue':  'SAFE',
        'gr.getRowCount':     'SAFE',
        'gr.getEncodedQuery': 'SAFE',
        'current.get':        'BREAK',
        'current.getValue':   'SAFE',
        'current.setValue':   'BREAK',
        'current.addQuery':   'BREAK',
        'gs.getProperty':     'WARN',
        'gs.setProperty':     'BREAK',
        'g_form.getValue':    'WARN',
        'g_form.setValue':    'BREAK',
        'g_form.addOption':   'WARN',
        'g_user.hasRole':     'WARN',
        'GlideRecordSecure':  'BREAK',
        'new GlideRecord':    'BREAK',
        'GlideAggregate':     'WARN',
        'GlideElement':       'WARN',
        'dot_walk':           'WARN'
    },

    initialize: function () {
        this._batchSize = 200;
    },

    // ---------------------------------------------------------------------
    // Public: run a full scan for a target object and persist findings.
    // Returns the scan record sys_id.
    // ---------------------------------------------------------------------
    runScan: function (targetType, targetName) {
        var scanId = this._createScanRecord(targetType, targetName);
        if (!scanId) {
            gs.error('WurScanner: scan aborted — could not create scan record for ' + targetType + ':' + targetName);
            return null;
        }
        var findings = this.scanTarget(targetType, targetName);
        var counts = this._persistFindings(scanId, findings);
        var impact = this.computeImpact(findings);
        this._finalizeScanRecord(scanId, counts, impact);
        return scanId;
    },

    // ---------------------------------------------------------------------
    // Public: scan a target object across the full scripted surface.
    // Returns an array of finding objects (not yet persisted).
    // ---------------------------------------------------------------------
    scanTarget: function (targetType, targetName) {
        var findings = [];
        var surface = this.ACQUISITION_SURFACE;
        for (var table in surface) {
            if (!surface.hasOwnProperty(table)) { continue; }
            var cfg = surface[table];
            var gr = new GlideRecord(table);
            gr.addNotNullQuery(cfg.script_field);
            gr.setLimit(this._batchSize);
            gr.query();
            while (gr.next()) {
                var script = gr.getValue(cfg.script_field) || '';
                if (!script) { continue; }
                var sourceName = gr.getValue(cfg.name_field) || gr.getUniqueValue();
                var sourceSysId = gr.getUniqueValue();
                var matches = this._scanScript(script, targetType, targetName);
                for (var i = 0; i < matches.length; i++) {
                    findings.push({
                        source_type: cfg.source_type,
                        source_name: sourceName,
                        source_sys_id: sourceSysId,
                        target_type: targetType,
                        target_name: targetName,
                        line_number: matches[i].line,
                        matched_pattern: matches[i].pattern,
                        risk_class: matches[i].risk,
                        confidence: matches[i].confidence,
                        snippet: matches[i].snippet
                    });
                }
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Tokenize a script and find references to the target. Separates string
    // literals (not references) from code, and flags dynamic/indirect calls
    // as "unverifiable" rather than "broken".
    // ---------------------------------------------------------------------
    _scanScript: function (script, targetType, targetName) {
        var findings = [];
        var lines = script.split('\n');
        var targetToken = this._targetToken(targetType, targetName);

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var code = this._stripStringLiterals(line);
            if (!code) { continue; }

            // Dynamic / indirect reference: variable table or field name.
            if (this._isDynamicReference(code, targetType, targetName)) {
                findings.push({
                    line: i + 1,
                    pattern: 'dynamic',
                    risk: 'WARN',
                    confidence: 'unverifiable',
                    snippet: this._snippet(line)
                });
                continue;
            }

            // Direct reference: the target token appears in code.
            if (code.indexOf(targetToken) !== -1) {
                var pattern = this._matchPattern(code);
                var risk = this.RISK_RULES[pattern] || 'WARN';
                findings.push({
                    line: i + 1,
                    pattern: pattern,
                    risk: risk,
                    confidence: 'high',
                    snippet: this._snippet(line)
                });
            }
        }
        return findings;
    },

    // ---------------------------------------------------------------------
    // Compute the aggregate impact score (0-100) for a set of findings.
    // BREAK findings dominate; WARN contributes; SAFE is informational.
    // ---------------------------------------------------------------------
    computeImpact: function (findings) {
        var breakCount = 0;
        var warnCount = 0;
        var safeCount = 0;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].risk_class === 'BREAK') { breakCount++; }
            else if (findings[i].risk_class === 'WARN') { warnCount++; }
            else { safeCount++; }
        }
        var score = 0;
        if (breakCount > 0) {
            score = Math.min(100, 60 + breakCount * 10);
        } else if (warnCount > 0) {
            score = Math.min(59, 20 + warnCount * 5);
        } else if (safeCount > 0) {
            score = Math.min(19, safeCount * 2);
        }
        return {
            score: score,
            break_count: breakCount,
            warn_count: warnCount,
            safe_count: safeCount,
            total: findings.length,
            verdict: breakCount > 0 ? 'BREAK' : (warnCount > 0 ? 'WARN' : 'SAFE')
        };
    },

    // ---------------------------------------------------------------------
    // Build the dependency graph edges from findings (object -> reference).
    // Each finding is already an edge; this normalizes it for the D3 renderer.
    // ---------------------------------------------------------------------
    buildDependencyGraph: function (findings) {
        var nodes = {};
        var edges = [];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var sourceKey = f.source_type + ':' + f.source_name;
            var targetKey = f.target_type + ':' + f.target_name;
            if (!nodes[sourceKey]) {
                nodes[sourceKey] = { id: sourceKey, type: f.source_type, name: f.source_name };
            }
            if (!nodes[targetKey]) {
                nodes[targetKey] = { id: targetKey, type: f.target_type, name: f.target_name };
            }
            edges.push({
                source: sourceKey,
                target: targetKey,
                risk_class: f.risk_class,
                line_number: f.line_number
            });
        }
        var nodeList = [];
        for (var key in nodes) {
            if (nodes.hasOwnProperty(key)) { nodeList.push(nodes[key]); }
        }
        return { nodes: nodeList, edges: edges };
    },

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------
    _targetToken: function (targetType, targetName) {
        // The target token is the bare object name regardless of type. Field
        // references appear as gr.<field> / current.<field> / g_form.getValue('<field>'),
        // property references as gs.getProperty('<name>'), and table/script
        // references as the literal name. All resolve to the same token.
        return targetName;
    },

    _stripStringLiterals: function (line) {
        // Remove single- and double-quoted string literals so that a target
        // name appearing only inside a string is not treated as a reference.
        var out = line;
        out = out.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        out = out.replace(/'(?:[^'\\]|\\.)*'/g, "''");
        return out;
    },

    _isDynamicReference: function (code, targetType, targetName) {
        // A reference is dynamic when the target name is built at runtime
        // (concatenation, variable interpolation) rather than a literal token.
        if (code.indexOf(targetName) === -1) { return false; }
        // Concatenation around the token signals a runtime-built name.
        var idx = code.indexOf(targetName);
        var before = code.charAt(idx - 1);
        var after = code.charAt(idx + targetName.length);
        return (before === '+' || after === '+');
    },

    _matchPattern: function (code) {
        if (code.indexOf('GlideRecordSecure') !== -1) { return 'GlideRecordSecure'; }
        if (code.indexOf('GlideAggregate') !== -1) { return 'GlideAggregate'; }
        if (code.indexOf('GlideElement') !== -1) { return 'GlideElement'; }
        if (code.indexOf('new GlideRecord') !== -1) { return 'new GlideRecord'; }
        if (code.indexOf('GlideRecord') !== -1) { return 'GlideRecord'; }
        if (code.indexOf('gr.deleteRecord') !== -1) { return 'gr.deleteRecord'; }
        if (code.indexOf('gr.insert') !== -1) { return 'gr.insert'; }
        if (code.indexOf('gr.update') !== -1) { return 'gr.update'; }
        if (code.indexOf('gr.setValue') !== -1) { return 'gr.setValue'; }
        if (code.indexOf('gr.addQuery') !== -1) { return 'gr.addQuery'; }
        // Read-only gr.* variants must be matched before the bare gr.get so
        // they are not misclassified as a breaking write access.
        if (code.indexOf('gr.getValue') !== -1) { return 'gr.getValue'; }
        if (code.indexOf('gr.getUniqueValue') !== -1) { return 'gr.getUniqueValue'; }
        if (code.indexOf('gr.getRowCount') !== -1) { return 'gr.getRowCount'; }
        if (code.indexOf('gr.getEncodedQuery') !== -1) { return 'gr.getEncodedQuery'; }
        if (code.indexOf('gr.get(') !== -1) { return 'gr.get'; }
        if (code.indexOf('current.setValue') !== -1) { return 'current.setValue'; }
        if (code.indexOf('current.addQuery') !== -1) { return 'current.addQuery'; }
        if (code.indexOf('current.getValue') !== -1) { return 'current.getValue'; }
        if (code.indexOf('current.get(') !== -1) { return 'current.get'; }
        if (code.indexOf('gs.setProperty') !== -1) { return 'gs.setProperty'; }
        if (code.indexOf('gs.getProperty') !== -1) { return 'gs.getProperty'; }
        if (code.indexOf('g_form.setValue') !== -1) { return 'g_form.setValue'; }
        if (code.indexOf('g_form.addOption') !== -1) { return 'g_form.addOption'; }
        if (code.indexOf('g_form.getValue') !== -1) { return 'g_form.getValue'; }
        if (code.indexOf('g_user.hasRole') !== -1) { return 'g_user.hasRole'; }
        return 'dot_walk';
    },

    _snippet: function (line) {
        var trimmed = line.replace(/^\s+/, '');
        if (trimmed.length > 200) { return trimmed.substring(0, 200) + '...'; }
        return trimmed;
    },

    _createScanRecord: function (targetType, targetName) {
        var gr = new GlideRecord(this.SCAN_TABLE);
        gr.initialize();
        gr.setValue('target_type', targetType);
        gr.setValue('target_name', targetName);
        gr.setValue('status', 'running');
        gr.setValue('started_at', new GlideDateTime().getValue());
        gr.setValue('references_found', 0);
        gr.setValue('break_count', 0);
        gr.setValue('warn_count', 0);
        gr.setValue('safe_count', 0);
        gr.setValue('high_water_mark', this._getHighWaterMark());
        gr.setWorkflow(false);
        try {
            return gr.insert();
        } catch (e) {
            gs.error('WurScanner: failed to create scan record: ' + e.message);
            return null;
        }
    },

    _persistFindings: function (scanId, findings) {
        var counts = { break_count: 0, warn_count: 0, safe_count: 0 };
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var gr = new GlideRecord(this.REFERENCE_TABLE);
            gr.initialize();
            gr.setValue('scan', scanId);
            gr.setValue('target_type', f.target_type);
            gr.setValue('target_name', f.target_name);
            gr.setValue('source_type', f.source_type);
            gr.setValue('source_name', f.source_name);
            gr.setValue('source_sys_id', f.source_sys_id);
            gr.setValue('line_number', f.line_number);
            gr.setValue('risk_class', f.risk_class);
            gr.setValue('confidence', f.confidence);
            gr.setValue('matched_pattern', f.matched_pattern);
            gr.setValue('snippet', f.snippet);
            gr.setWorkflow(false);
            try {
                gr.insert();
            } catch (e) {
                gs.error('WurScanner: failed to persist finding: ' + e.message);
                continue;
            }
            if (f.risk_class === 'BREAK') { counts.break_count++; }
            else if (f.risk_class === 'WARN') { counts.warn_count++; }
            else { counts.safe_count++; }
        }
        return counts;
    },

    _finalizeScanRecord: function (scanId, counts, impact) {
        if (!scanId) { return; }
        var gr = new GlideRecord(this.SCAN_TABLE);
        if (!gr.get(scanId)) { return; }
        gr.setValue('status', 'completed');
        gr.setValue('completed_at', new GlideDateTime().getValue());
        gr.setValue('references_found', counts.break_count + counts.warn_count + counts.safe_count);
        gr.setValue('break_count', counts.break_count);
        gr.setValue('warn_count', counts.warn_count);
        gr.setValue('safe_count', counts.safe_count);
        gr.setValue('impact_json', JSON.stringify(impact));
        gr.setValue('high_water_mark', new GlideDateTime().getValue());
        gr.setWorkflow(false);
        try {
            gr.update();
        } catch (e) {
            gs.error('WurScanner: failed to finalize scan record: ' + e.message);
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

    type: 'WurScanner'
};
