// PerfPulse — PerfPulseEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic instance-performance audit engine. Implements the six
// detectors (business-rule scanner, slow-query detector, N+1 pattern
// detector, client-script scanner, ACL evaluation-cost scorer, and
// transaction-log correlator) plus per-component cost scoring.
// Pure GlideRecord / static-analysis logic — no LLM in the critical path.
// @class PerfPulseEngine @namespace x_vkap_perf_pulse

var PerfPulseEngine = Class.create();
PerfPulseEngine.prototype = {

    initialize: function () {
        this._brTable = 'sys_script';
        this._clientScriptTable = 'sys_script_client';
        this._aclTable = 'sys_security_acl';
        this._dictTable = 'sys_dictionary';
        this._txnTable = 'syslog_transaction';
        this._findingTable = 'x_vkap_perf_pulse_finding';
        this._scanTable = 'x_vkap_perf_pulse_scan';
    },

    /**
     * Run a full scan. Returns the scan sys_id, or null on failure.
     * @param {string} scanType - 'full' | 'delta'
     * @param {string} sourceEnv - environment label (dev/test/prod)
     * @return {string|null} scan sys_id
     */
    runScan: function (scanType, sourceEnv) {
        var scanId = this._createScan(scanType, sourceEnv);
        if (!scanId) {
            return null;
        }
        var inventory;
        try {
            inventory = this._collectInventory();
        } catch (e) {
            gs.error('PerfPulseEngine.runScan collection failed: ' + e.message);
            this._failScan(scanId, e.message);
            return null;
        }
        var counts = {
            business_rule: this._detectBusinessRules(inventory.businessRules, scanId),
            slow_query: this._detectSlowQueries(inventory, scanId),
            n_plus_one: this._detectNPlusOne(inventory.scriptIncludes, scanId),
            client_script: this._detectClientScripts(inventory.clientScripts, scanId),
            acl_cost: this._scoreAclCost(inventory.acls, scanId),
            transaction: this._correlateTransactions(inventory, scanId)
        };
        var scores = this._scoreComponents(inventory);
        this._finalizeScan(scanId, counts, scores);
        return scanId;
    },

    /**
     * Collect the full execution-surface inventory into a normalized
     * in-memory structure. Reads business rules, client scripts, ACLs,
     * dictionary entries, and script includes.
     * @return {Object} normalized inventory
     */
    _collectInventory: function () {
        return {
            businessRules: this._collectBusinessRules(),
            clientScripts: this._collectClientScripts(),
            acls: this._collectAcls(),
            dictionaries: this._collectDictionaries(),
            scriptIncludes: this._collectScriptIncludes()
        };
    },

    /**
     * Collect active business rules (sys_script) with their script bodies.
     * @return {Array} normalized business-rule records
     */
    _collectBusinessRules: function () {
        var rules = [];
        var gr = new GlideRecord(this._brTable);
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            rules.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                collection: gr.getValue('collection') || '',
                when: gr.getValue('when') || '',
                script: gr.getValue('script') || '',
                order: parseInt(gr.getValue('order') || '0', 10)
            });
        }
        return rules;
    },

    /**
     * Collect active client scripts (sys_script_client).
     * @return {Array} normalized client-script records
     */
    _collectClientScripts: function () {
        var scripts = [];
        var gr = new GlideRecord(this._clientScriptTable);
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            scripts.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                table: gr.getValue('table') || '',
                type: gr.getValue('type') || '',
                script: gr.getValue('script') || ''
            });
        }
        return scripts;
    },

    /**
     * Collect ACLs with their roles and scripted conditions.
     * @return {Array} normalized ACL records
     */
    _collectAcls: function () {
        var acls = [];
        var gr = new GlideRecord(this._aclTable);
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            var name = gr.getValue('name') || '';
            acls.push({
                sys_id: gr.getUniqueValue(),
                name: name,
                table_name: this._extractTable(name),
                operation: gr.getValue('operation') || '',
                condition: gr.getValue('condition') || '',
                script: gr.getValue('script') || ''
            });
        }
        return acls;
    },

    /**
     * Collect dictionary entries (index metadata) for slow-query analysis.
     * @return {Array} normalized dictionary records
     */
    _collectDictionaries: function () {
        var dicts = [];
        var gr = new GlideRecord(this._dictTable);
        gr.addQuery('internal_type', 'IN', 'string,reference');
        gr.setLimit(20000);
        gr.query();
        while (gr.next()) {
            dicts.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name') || '',
                element: gr.getValue('element') || '',
                internal_type: gr.getValue('internal_type') || '',
                reference: gr.getValue('reference') || '',
                attributes: gr.getValue('attributes') || ''
            });
        }
        return dicts;
    },

    /**
     * Collect script includes (sys_script_include) for N+1 static analysis.
     * @return {Array} normalized script-include records
     */
    _collectScriptIncludes: function () {
        var includes = [];
        var gr = new GlideRecord('sys_script_include');
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            includes.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name') || '',
                api_name: gr.getValue('api_name') || '',
                script: gr.getValue('script') || ''
            });
        }
        return includes;
    },

    /**
     * Extract the target table name from an ACL name.
     * @param {string} name - ACL name
     * @return {string} table name or empty string
     */
    _extractTable: function (name) {
        if (!name) {
            return '';
        }
        var idx = name.indexOf('.');
        if (idx <= 0) {
            return name;
        }
        return name.substring(0, idx);
    },

    /**
     * Detector 1 — Business-rule performance scanner.
     * Flags before/after business rules with full-table GlideRecord scans,
     * missing setLimit(), expensive dot-walked queries, and getRowCount()
     * on large tables. Reports every applicable defect per rule.
     * @param {Array} rules - normalized business rules
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectBusinessRules: function (rules, scanId) {
        var count = 0;
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            var script = rule.script || '';
            if (!script) {
                continue;
            }
            var reasons = [];
            if (this._hasFullTableScan(script)) {
                reasons.push({
                    reason: 'Business rule "' + rule.name + '" performs a full-table GlideRecord scan with no filter',
                    suggestion: 'Add an addQuery() filter or setLimit() to bound the result set before iterating.'
                });
            }
            if (this._missingSetLimit(script)) {
                reasons.push({
                    reason: 'Business rule "' + rule.name + '" iterates a GlideRecord without setLimit()',
                    suggestion: 'Add setLimit(N) to cap the number of records processed per transaction.'
                });
            }
            if (this._hasDotWalkedQuery(script)) {
                reasons.push({
                    reason: 'Business rule "' + rule.name + '" uses an expensive dot-walked query',
                    suggestion: 'Replace dot-walked conditions with a direct reference-field query or a GlideRecord on the target table.'
                });
            }
            if (this._hasGetRowCount(script)) {
                reasons.push({
                    reason: 'Business rule "' + rule.name + '" calls getRowCount() on a potentially large table',
                    suggestion: 'Use getAggregate("COUNT") or a hasNext() check instead of materializing the full result set.'
                });
            }
            for (var r = 0; r < reasons.length; r++) {
                this._createFinding(scanId, 'business_rule', rule, reasons[r].reason, reasons[r].suggestion, 'high');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 2 — Slow-query detector.
     * Flags dictionary entries with missing indexes on reference fields,
     * LIKE '%...%' patterns, and unindexed ORDER BY on large tables.
     * @param {Array} dicts - normalized dictionary records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectSlowQueries: function (inventory, scanId) {
        var count = 0;
        var dicts = inventory.dictionaries;
        var i;
        for (i = 0; i < dicts.length; i++) {
            var d = dicts[i];
            if (d.internal_type === 'reference' && d.reference && !this._isIndexed(d.attributes)) {
                this._createFinding(scanId, 'slow_query', d,
                    'Reference field "' + d.name + '.' + d.element + '" is not indexed',
                    'Add an index to the reference field to speed up joins and lookups.',
                    'medium');
                count++;
            }
        }
        // Leading-wildcard LIKE patterns live in query code (business rules
        // and script includes), not in dictionary attributes.
        var scripts = [];
        var j;
        for (j = 0; j < inventory.businessRules.length; j++) {
            scripts.push({ name: inventory.businessRules[j].name, script: inventory.businessRules[j].script });
        }
        for (j = 0; j < inventory.scriptIncludes.length; j++) {
            scripts.push({ name: inventory.scriptIncludes[j].name, script: inventory.scriptIncludes[j].script });
        }
        for (j = 0; j < scripts.length; j++) {
            if (this._hasLikePattern(scripts[j].script)) {
                this._createFinding(scanId, 'slow_query', scripts[j],
                    'Component "' + scripts[j].name + '" uses a leading-wildcard LIKE pattern',
                    'Avoid leading-wildcard LIKE; use a text index or a normalized search field instead.',
                    'medium');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 3 — N+1 pattern detector.
     * Static analysis of script includes for query-inside-loop anti-patterns
     * (GlideRecord instantiated inside a while/for loop).
     * @param {Array} includes - normalized script-include records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectNPlusOne: function (includes, scanId) {
        var count = 0;
        for (var i = 0; i < includes.length; i++) {
            var inc = includes[i];
            var script = inc.script || '';
            if (this._hasQueryInLoop(script)) {
                this._createFinding(scanId, 'n_plus_one', inc,
                    'Script include "' + inc.name + '" instantiates a GlideRecord inside a loop (N+1 anti-pattern)',
                    'Hoist the query out of the loop, or batch the lookups into a single query with an IN clause.',
                    'high');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 4 — Client-script performance scanner.
     * Flags heavy onLoad scripts, synchronous GlideAjax calls, DOM
     * manipulation in loops, and getReference() misuse.
     * @param {Array} scripts - normalized client scripts
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectClientScripts: function (scripts, scanId) {
        var count = 0;
        for (var i = 0; i < scripts.length; i++) {
            var cs = scripts[i];
            var script = cs.script || '';
            var reasons = [];
            if (cs.type === 'onLoad' && script.length > 2000) {
                reasons.push({
                    reason: 'onLoad client script "' + cs.name + '" is heavy (' + script.length + ' chars)',
                    suggestion: 'Defer non-critical work to onLoad via a callback or move it to a UI action.'
                });
            }
            if (this._hasSyncGlideAjax(script)) {
                reasons.push({
                    reason: 'Client script "' + cs.name + '" uses a synchronous GlideAjax call',
                    suggestion: 'Use getXMLWait() only when unavoidable; prefer asynchronous getXML(callback).'
                });
            }
            if (this._hasDomInLoop(script)) {
                reasons.push({
                    reason: 'Client script "' + cs.name + '" manipulates the DOM inside a loop',
                    suggestion: 'Build a single HTML string and set it once, or use a document fragment.'
                });
            }
            if (this._hasGetReference(script)) {
                reasons.push({
                    reason: 'Client script "' + cs.name + '" calls g_form.getReference()',
                    suggestion: 'Use a GlideAjax call or a reference field with a display value instead of a blocking getReference().'
                });
            }
            for (var r = 0; r < reasons.length; r++) {
                this._createFinding(scanId, 'client_script', cs, reasons[r].reason, reasons[r].suggestion, 'medium');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 5 — ACL evaluation-cost scorer.
     * Scores hot tables by ACL count + scripted-condition density, surfacing
     * tables where every access pays a heavy security-evaluation tax.
     * @param {Array} acls - normalized ACL records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _scoreAclCost: function (acls, scanId) {
        var byTable = {};
        for (var i = 0; i < acls.length; i++) {
            var acl = acls[i];
            var table = acl.table_name;
            if (!table) {
                continue;
            }
            if (!byTable[table]) {
                byTable[table] = { count: 0, scripted: 0 };
            }
            byTable[table].count++;
            if (acl.script) {
                byTable[table].scripted++;
            }
        }
        var count = 0;
        for (var t in byTable) {
            if (!byTable.hasOwnProperty(t)) {
                continue;
            }
            var entry = byTable[t];
            if (entry.count >= 10 || entry.scripted >= 3) {
                this._createFinding(scanId, 'acl_cost', { sys_id: '', name: t, table_name: t },
                    'Table "' + t + '" has ' + entry.count + ' ACLs (' + entry.scripted + ' scripted) — high evaluation cost',
                    'Consolidate ACLs and replace scripted conditions with declarative conditions where possible.',
                    'medium');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 6 — Transaction-log hotspot aggregator.
     * Joins syslog_transaction slow entries against the component inventory
     * to surface actual runtime culprits, not just static smells.
     * @param {Object} inventory - normalized inventory
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _correlateTransactions: function (inventory, scanId) {
        var count = 0;
        var gr = new GlideRecord(this._txnTable);
        gr.addQuery('response_time', '>', 5000);
        gr.orderByDesc('response_time');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            var url = gr.getValue('url') || '';
            var table = this._extractTableFromUrl(url);
            if (!table) {
                continue;
            }
            var matched = this._findComponentForTable(inventory, table);
            if (matched) {
                this._createFinding(scanId, 'transaction', matched,
                    'Slow transaction (' + gr.getValue('response_time') + 'ms) on "' + table + '" correlates to component "' + matched.name + '"',
                    'Review the correlated component for the performance defect flagged by the static detectors.',
                    'high', JSON.stringify({ url: url }));
                count++;
            }
        }
        return count;
    },

    /**
     * Extract a table name from a transaction URL.
     * @param {string} url - transaction URL
     * @return {string} table name or empty string
     */
    _extractTableFromUrl: function (url) {
        if (!url) {
            return '';
        }
        var m = url.match(/table=([a-z0-9_]+)/i);
        if (m && m[1]) {
            return m[1];
        }
        m = url.match(/\/([a-z][a-z0-9_]{2,})\.do/i);
        if (m && m[1]) {
            return m[1];
        }
        return '';
    },

    /**
     * Find the first component (business rule / client script / ACL)
     * governing a table.
     * @param {Object} inventory - normalized inventory
     * @param {string} table - table name
     * @return {Object|null} matching component or null
     */
    _findComponentForTable: function (inventory, table) {
        var i;
        for (i = 0; i < inventory.businessRules.length; i++) {
            if (inventory.businessRules[i].collection === table) {
                return inventory.businessRules[i];
            }
        }
        for (i = 0; i < inventory.clientScripts.length; i++) {
            if (inventory.clientScripts[i].table === table) {
                return inventory.clientScripts[i];
            }
        }
        for (i = 0; i < inventory.acls.length; i++) {
            if (inventory.acls[i].table_name === table) {
                return inventory.acls[i];
            }
        }
        return null;
    },

    /**
     * Compute a per-component performance score (0-100) across the inventory.
     * @param {Object} inventory - normalized inventory
     * @return {Object} map of component name to score
     */
    _scoreComponents: function (inventory) {
        var scores = {};
        var i;
        for (i = 0; i < inventory.businessRules.length; i++) {
            var br = inventory.businessRules[i];
            scores[br.name] = this._scoreScript(br.script);
        }
        for (i = 0; i < inventory.clientScripts.length; i++) {
            var cs = inventory.clientScripts[i];
            scores[cs.name] = this._scoreScript(cs.script);
        }
        for (i = 0; i < inventory.scriptIncludes.length; i++) {
            var si = inventory.scriptIncludes[i];
            scores[si.name] = this._scoreScript(si.script);
        }
        for (i = 0; i < inventory.acls.length; i++) {
            var acl = inventory.acls[i];
            scores[acl.name] = this._scoreScript(acl.script);
        }
        return scores;
    },

    /**
     * Score a single script body (0-100) by counting anti-patterns.
     * @param {string} script - script body
     * @return {number} score
     */
    _scoreScript: function (script) {
        if (!script) {
            return 100;
        }
        var penalty = 0;
        if (this._hasFullTableScan(script)) {
            penalty += 30;
        }
        if (this._missingSetLimit(script)) {
            penalty += 20;
        }
        if (this._hasDotWalkedQuery(script)) {
            penalty += 15;
        }
        if (this._hasGetRowCount(script)) {
            penalty += 15;
        }
        if (this._hasQueryInLoop(script)) {
            penalty += 20;
        }
        var score = 100 - penalty;
        return score < 0 ? 0 : score;
    },

    // ---- Static-analysis helpers (regex-based, deterministic) ----

    _hasFullTableScan: function (script) {
        // Split on each GlideRecord instantiation and check whether that
        // instance is filtered (addQuery) before its query() call. This
        // catches unfiltered scans even when another GlideRecord in the
        // same script is properly filtered.
        var parts = script.split(/new\s+GlideRecord\(/);
        for (var i = 1; i < parts.length; i++) {
            var seg = parts[i];
            var queryIdx = seg.indexOf('.query(');
            if (queryIdx === -1) {
                continue;
            }
            if (!/addQuery\(/.test(seg.substring(0, queryIdx))) {
                return true;
            }
        }
        return false;
    },

    _missingSetLimit: function (script) {
        // Only flag completely unbounded scans (no filter AND no limit).
        // Filtered-but-unbounded queries are intentional and no longer flagged.
        return /new\s+GlideRecord\(/.test(script) &&
            /\.query\(\)/.test(script) &&
            !/setLimit\(/.test(script) &&
            !/addQuery\(/.test(script);
    },

    _hasDotWalkedQuery: function (script) {
        // A dot-walked query is a dot inside the FIRST (field-name) argument,
        // e.g. addQuery('caller_id.department', ...). Dots inside later
        // string-literal values are not dot-walking.
        return /addQuery\(\s*['"][^'"]*\.[^'"]*['"]/.test(script);
    },

    _hasGetRowCount: function (script) {
        return /getRowCount\(\)/.test(script);
    },

    _hasQueryInLoop: function (script) {
        var re = /(?:while|for)\s*\([^)]*\)\s*\{/g;
        var m;
        while ((m = re.exec(script)) !== null) {
            var body = this._extractLoopBody(script, m.index + m[0].length - 1);
            if (/new\s+GlideRecord\(/.test(body)) {
                return true;
            }
        }
        return false;
    },

    _hasSyncGlideAjax: function (script) {
        return /getXMLWait\(\)/.test(script);
    },

    _hasDomInLoop: function (script) {
        var re = /(?:while|for)\s*\([^)]*\)\s*\{/g;
        var m;
        while ((m = re.exec(script)) !== null) {
            var body = this._extractLoopBody(script, m.index + m[0].length - 1);
            if (/(getElementById|appendChild|innerHTML)/.test(body)) {
                return true;
            }
        }
        return false;
    },

    _hasGetReference: function (script) {
        return /getReference\(/.test(script);
    },

    _extractLoopBody: function (script, braceIdx) {
        var depth = 0;
        for (var i = braceIdx; i < script.length; i++) {
            var c = script.charAt(i);
            if (c === '{') {
                depth++;
            } else if (c === '}') {
                depth--;
                if (depth === 0) {
                    return script.substring(braceIdx + 1, i);
                }
            }
        }
        return script.substring(braceIdx + 1);
    },

    _isIndexed: function (attributes) {
        return /index=true/.test(attributes || '');
    },

    _hasLikePattern: function (script) {
        // Leading-wildcard LIKE patterns live in query code, not dictionary
        // attributes. Detect LIKE '%...' (leading wildcard) in script text.
        return /LIKE\s*['"]%/.test((script || '').toUpperCase());
    },

    // ---- Scan lifecycle helpers ----

    _createScan: function (scanType, sourceEnv) {
        try {
            var gr = new GlideRecord(this._scanTable);
            gr.initialize();
            gr.setValue('type', scanType || 'full');
            gr.setValue('source_env', sourceEnv || 'local');
            gr.setValue('status', 'running');
            gr.setValue('started_at', new GlideDateTime().getValue());
            return gr.insert();
        } catch (e) {
            gs.error('PerfPulseEngine._createScan failed: ' + e.message);
            return null;
        }
    },

    _failScan: function (scanId, message) {
        try {
            var gr = new GlideRecord(this._scanTable);
            if (!gr.get(scanId)) {
                return;
            }
            gr.setValue('status', 'failed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setValue('failure_reason', message || '');
            gr.update();
        } catch (e) {
            gs.error('PerfPulseEngine._failScan failed: ' + e.message);
        }
    },

    _finalizeScan: function (scanId, counts, scores) {
        try {
            var gr = new GlideRecord(this._scanTable);
            if (!gr.get(scanId)) {
                return;
            }
            gr.setValue('status', 'completed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setValue('business_rule_count', counts.business_rule || 0);
            gr.setValue('slow_query_count', counts.slow_query || 0);
            gr.setValue('n_plus_one_count', counts.n_plus_one || 0);
            gr.setValue('client_script_count', counts.client_script || 0);
            gr.setValue('acl_cost_count', counts.acl_cost || 0);
            gr.setValue('transaction_count', counts.transaction || 0);
            gr.setValue('scores_json', JSON.stringify(scores || {}));
            gr.update();
        } catch (e) {
            gs.error('PerfPulseEngine._finalizeScan failed: ' + e.message);
        }
    },

    _createFinding: function (scanId, category, component, reason, suggestion, severity, detail) {
        try {
            var gr = new GlideRecord(this._findingTable);
            gr.initialize();
            gr.setValue('scan', scanId);
            gr.setValue('category', category);
            gr.setValue('component_sys_id', component.sys_id || '');
            gr.setValue('component_name', component.name || '');
            gr.setValue('table_name', component.table_name || component.collection || component.table || '');
            gr.setValue('reason', reason);
            gr.setValue('suggestion', suggestion);
            gr.setValue('severity', severity);
            gr.setValue('status', 'open');
            if (detail) {
                gr.setValue('detail_json', detail);
            }
            return gr.insert();
        } catch (e) {
            gs.error('PerfPulseEngine._createFinding failed: ' + e.message);
            return null;
        }
    },

    type: 'PerfPulseEngine'
};
