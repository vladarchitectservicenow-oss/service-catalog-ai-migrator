// ScriptInclude Medic — SimMedicEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic static-analysis engine for the sys_script_include layer.
// Builds a call graph across all scripted artifact types, then runs seven
// detectors over that single source of truth: dead-code, duplicate-function,
// naming-convention, documentation, circular-dependency, and OOTB-reinvention.
// The AI layer (Now Assist / GenAI Controller) is optional and layered on top
// for remediation drafting only; every score here is computed deterministically.
//
// @class SimMedicEngine
// @namespace x_snc_script_include_medic

var SimMedicEngine = Class.create();
SimMedicEngine.prototype = {

    initialize: function() {
        this._graph = null;
        this._SAFE_LIST = ['initialize', 'process', 'getOutput', 'execute'];
        // Reserved OOTB names that scoped code must not shadow.
        this._RESERVED = [
            'ArrayUtil', 'StringUtil', 'GlideRecord', 'GlideSystem',
            'GlideDateTime', 'GlideAggregate', 'gs', 'current', 'previous',
            'Class', 'JSON', 'Math', 'Date', 'RegExp'
        ];
        // JavaScript keywords that share the `word(...) {` token shape and must
        // never be mistaken for method names during ES6 class-body extraction.
        this._KEYWORDS = [
            'if', 'for', 'while', 'switch', 'catch', 'function', 'with',
            'return', 'throw', 'typeof', 'instanceof', 'in', 'of', 'new',
            'delete', 'void', 'do', 'else', 'case', 'default', 'finally',
            'this', 'super', 'var', 'let', 'const', 'class', 'try', 'break',
            'continue', 'yield', 'await', 'async', 'get', 'set'
        ];
        // Known platform utilities that custom code frequently reinvents.
        this._OOTB_UTILITIES = [
            { pattern: /function\s+getUserEmail\b/i, platform: 'gs.getUser().getEmail()' },
            { pattern: /function\s+getUserID\b/i, platform: 'gs.getUserID()' },
            { pattern: /function\s+getUserName\b/i, platform: 'gs.getUserName()' },
            { pattern: /function\s+hasRole\b/i, platform: 'gs.hasRole()' },
            { pattern: /function\s+isInteractive\b/i, platform: 'gs.isInteractive()' },
            { pattern: /function\s+getDisplayValue\b/i, platform: 'gr.getDisplayValue()' },
            { pattern: /function\s+trim\b/i, platform: 'String.prototype.trim()' },
            { pattern: /function\s+startsWith\b/i, platform: 'String.prototype.startsWith()' },
            { pattern: /function\s+endsWith\b/i, platform: 'String.prototype.endsWith()' },
            { pattern: /function\s+padLeft\b/i, platform: 'StringUtil.pad()' },
            { pattern: /function\s+toTitleCase\b/i, platform: 'StringUtil / GlideStringUtil' },
            { pattern: /function\s+escapeHTML\b/i, platform: 'gs.getMessage / JSUtil' },
            { pattern: /function\s+log\b/i, platform: 'gs.info/gs.warn/gs.error' },
            { pattern: /function\s+formatDate\b/i, platform: 'GlideDateTime / gs.dateGenerate' },
            { pattern: /function\s+uuid\b/i, platform: 'gs.generateGUID()' }
        ];
    },

    type: 'SimMedicEngine',

    /**
     * Build the call graph. Queries every scripted artifact type that can
     * reference a script include, extracts definitions and references, and
     * returns a graph object consumed by all downstream detectors.
     *
     * @returns {Object} { includes, definitions, inbound, edges, meta }
     */
    buildCallGraph: function(changedSince) {
        var graph = {
            includes: {},      // sys_id -> { name, script, description, scope, functions:[] }
            definitions: {},   // functionName -> includeSysId
            inbound: {},       // includeSysId -> { count, callers:[] }
            edges: [],         // [{ caller, callee }]
            meta: { includeCount: 0 }
        };

        this._collectIncludes(graph, changedSince);
        this._collectReferences(graph);
        this._graph = graph;
        return graph;
    },

    /**
     * Collect every sys_script_include and extract its public functions.
     * When `changedSince` (a GlideDateTime display value) is supplied, only
     * includes updated after that timestamp are collected — this is what makes
     * an incremental re-scan actually scan a subset instead of everything.
     */
    _collectIncludes: function(graph, changedSince) {
        var gr = new GlideRecord('sys_script_include');
        gr.addActiveQuery();
        if (changedSince) {
            gr.addQuery('sys_updated_on', '>', changedSince);
        }
        gr.query();
        while (gr.next()) {
            var sysId = gr.getUniqueValue();
            var name = gr.getValue('name');
            var script = gr.getValue('script') || '';
            var desc = gr.getValue('description') || '';
            var scope = gr.getValue('sys_scope') || '';

            var entry = {
                sys_id: sysId,
                name: name,
                script: script,
                description: desc,
                scope: scope,
                functions: this._extractFunctions(name, script)
            };

            graph.includes[sysId] = entry;
            graph.inbound[sysId] = { count: 0, callers: [] };

            // Register each public function in the global definition map.
            for (var f = 0; f < entry.functions.length; f++) {
                var fn = entry.functions[f];
                if (fn.isPublic) {
                    graph.definitions[fn.name] = sysId;
                    graph.definitions[name + '.' + fn.name] = sysId;
                }
            }
            graph.meta.includeCount++;
        }
    },

    /**
     * Scan consuming artifact types for references to the collected includes.
     */
    _collectReferences: function(graph) {
        var sources = [
            { table: 'sys_script', field: 'script', label: 'BusinessRule' },
            { table: 'sys_script_client', field: 'script', label: 'ClientScript' },
            { table: 'sys_ui_action', field: 'script', label: 'UIAction' },
            { table: 'sys_ws_operation', field: 'operation_script', label: 'ScriptedREST' },
            { table: 'sysauto_script', field: 'script', label: 'ScheduledJob' }
        ];

        for (var s = 0; s < sources.length; s++) {
            var src = sources[s];
            var gr = new GlideRecord(src.table);
            gr.addActiveQuery();
            gr.addNotNullQuery(src.field);
            gr.query();
            while (gr.next()) {
                var code = gr.getValue(src.field) || '';
                var artifactName = this._artifactName(gr, src.label);
                this._matchReferences(code, artifactName, graph);
            }
        }

        // Flow Designer flows store their scripted steps in snapshot JSON.
        this._collectFlowReferences(graph);

        // Script includes can reference other script includes; scan each
        // include's own body so include→include edges are captured. This is
        // what makes cycle detection and dead-code analysis correct.
        this._collectIncludeReferences(graph);
    },

    /**
     * Scan each script include's own body for references to other includes.
     * Produces include→include edges (caller = include name), which both the
     * circular-dependency detector and the dead-code detector depend on.
     */
    _collectIncludeReferences: function(graph) {
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            this._matchReferences(entry.script, entry.name, graph, sysId);
        }
    },

    /**
     * Flow Designer logic is serialized in sys_hub_flow.snapshot JSON.
     * Scan it for script-include name references without a strict column assumption.
     */
    _collectFlowReferences: function(graph) {
        var gr = new GlideRecord('sys_hub_flow');
        gr.addActiveQuery();
        gr.addNotNullQuery('snapshot');
        gr.query();
        while (gr.next()) {
            var snapshot = gr.getValue('snapshot') || '';
            this._matchReferences(snapshot, 'Flow:' + gr.getValue('name'), graph);
        }
    },

    /**
     * Derive a human-readable artifact name for edge reporting.
     */
    _artifactName: function(gr, fallback) {
        var name = gr.getValue('name');
        if (!name) {
            name = gr.getValue('short_description');
        }
        if (!name) {
            name = gr.getValue('collection');
        }
        return fallback + ':' + (name || gr.getUniqueValue());
    },

    /**
     * Find references to collected includes/functions inside a body of code.
     */
    _matchReferences: function(code, artifactName, graph, selfSysId) {
        if (!code || typeof code !== 'string') {
            return;
        }
        var includeIds = {};
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            if (selfSysId && sysId === selfSysId) {
                continue; // never count an include as referencing itself
            }
            var entry = graph.includes[sysId];
            var name = entry.name;
            // Reference patterns: `new Name(`, `Name.prototype`, `Name.method`, `Name.method(`
            var re = new RegExp('(?:new\\s+' + this._escapeRe(name) +
                '\\s*\\(|' + this._escapeRe(name) + '\\.(?:prototype|[A-Za-z_$][\\w$]*)\\s*\\()');
            if (re.test(code)) {
                includeIds[sysId] = true;
                graph.edges.push({ caller: artifactName, callee: name });
            }
        }

        for (var id in includeIds) {
            if (includeIds.hasOwnProperty(id)) {
                graph.inbound[id].count++;
                graph.inbound[id].callers.push(artifactName);
            }
        }
    },

    /**
     * Extract function names from a script include body.
     * Handles the two dominant ServiceNow patterns:
     *   1. Class.create() + prototype object literal (name: function(){})
     *   2. Modern ES6 class syntax (methodName() {})
     * Also captures top-level `var X = function` and `function X()` declarations.
     *
     * @returns {Array<{name:string, isPublic:boolean}>}
     */
    _extractFunctions: function(includeName, script) {
        var found = {};
        var functions = [];

        // Strip comments before extraction so example snippets in JSDoc/comments
        // are never mistaken for real code.
        var code = String(script || '');
        code = code.replace(/\/\*[\s\S]*?\*\//g, '');
        code = code.replace(/\/\/.*$/gm, '');

        // Class.create pattern: ClassName.prototype = { foo: function(){}, ... }
        // Closing `};` is anchored at column 0 (no indent) — the standard
        // ServiceNow format — so nested `var f = function(){...};` declarations
        // inside methods are never mistaken for the object's terminator.
        var protoRe = /prototype\s*=\s*\{([\s\S]*?)\n\};/;
        var pm = code.match(protoRe);
        if (pm) {
            var body = pm[1];
            var memberRe = /([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/g;
            var mm;
            while ((mm = memberRe.exec(body)) !== null) {
                this._addFn(found, functions, mm[1], includeName);
            }
        }

        // ES6 class pattern: class Name { method() {} }
        var classRe = /class\s+\w+[\s\S]*?\{([\s\S]*?)\n\}/;
        var cm = code.match(classRe);
        if (cm) {
            var classBody = cm[1];
            var methodRe = /([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
            var lm;
            while ((lm = methodRe.exec(classBody)) !== null) {
                // Exclude JS keywords that share the `word(...) {` shape.
                if (this._KEYWORDS.indexOf(lm[1]) === -1) {
                    this._addFn(found, functions, lm[1], includeName);
                }
            }
        }

        // Top-level function declarations / var assignments, anchored at line
        // start (no leading indent) so nested helper functions are excluded.
        var declRe = /^(?:function\s+([A-Za-z_$][\w$]*)\s*\(|var\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\()/gm;
        var dm;
        while ((dm = declRe.exec(code)) !== null) {
            var fnName = dm[1] || dm[2];
            this._addFn(found, functions, fnName, includeName);
        }

        return functions;
    },

    _addFn: function(found, functions, name, includeName) {
        if (!name || found[name]) {
            return;
        }
        found[name] = true;
        functions.push({
            name: name,
            isPublic: this._SAFE_LIST.indexOf(name) === -1
        });
    },

    /**
     * Dead-code detector: includes with zero inbound references, minus safe-listed
     * entry points (scripted REST resources, scheduled jobs, UI actions, flow actions).
     * @returns {Array} dead-code findings
     */
    detectDeadCode: function(entryPoints) {
        var graph = this._requireGraph();
        var results = [];
        var entryMap = {};
        if (entryPoints && entryPoints.length) {
            for (var e = 0; e < entryPoints.length; e++) {
                entryMap[entryPoints[e]] = true;
            }
        }

        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            if (entryMap[entry.name] || entryMap[sysId]) {
                continue; // legitimate entry point — never flagged
            }
            var inbound = graph.inbound[sysId];
            if (!inbound || inbound.count === 0) {
                results.push({
                    include_sys_id: sysId,
                    include_name: entry.name,
                    scope: entry.scope,
                    severity: 'medium',
                    detail: 'Zero inbound references across business rules, client scripts, UI actions, scripted REST, scheduled jobs, and flows.'
                });
            }
        }
        return results;
    },

    /**
     * Duplicate-function detector: normalizes function bodies and computes a
     * signature-similarity score between every pair of includes to flag
     * near-identical re-implementations.
     * @returns {Array} duplicate findings (pair + similarity)
     */
    detectDuplicates: function() {
        var graph = this._requireGraph();
        var results = [];
        var keys = [];
        for (var sysId in graph.includes) {
            if (graph.includes.hasOwnProperty(sysId)) {
                keys.push(sysId);
            }
        }

        // Pre-compute normalized signatures once (O(n) tokenization).
        var sigs = {};
        for (var i = 0; i < keys.length; i++) {
            var entry = graph.includes[keys[i]];
            sigs[keys[i]] = this._normalize(entry.script);
        }

        var THRESHOLD = 0.85;
        for (var a = 0; a < keys.length; a++) {
            for (var b = a + 1; b < keys.length; b++) {
                var ea = graph.includes[keys[a]];
                var eb = graph.includes[keys[b]];
                var sim = this._similarity(sigs[keys[a]], sigs[keys[b]]);
                if (sim >= THRESHOLD) {
                    results.push({
                        include_a_sys_id: keys[a],
                        include_a_name: ea.name,
                        include_b_sys_id: keys[b],
                        include_b_name: eb.name,
                        similarity: Math.round(sim * 100),
                        severity: sim >= 0.95 ? 'critical' : 'high',
                        detail: 'Near-identical implementations (' + Math.round(sim * 100) + '% similarity) under different names.'
                    });
                }
            }
        }
        return results;
    },

    /**
     * Naming-convention enforcer: checks scoped prefix, camelCase, and
     * reserved-name collisions.
     * @returns {Array} naming findings
     */
    enforceNaming: function() {
        var graph = this._requireGraph();
        var results = [];
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            var name = entry.name;
            var violations = [];

            // Reserved-name collision.
            if (this._RESERVED.indexOf(name) !== -1) {
                violations.push('Reserved platform name collision: ' + name);
            }
            // camelCase / PascalCase check (no snake_case, no leading digit).
            if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
                violations.push('Name contains invalid characters: ' + name);
            } else if (/^[a-z]/.test(name)) {
                violations.push('Class name should start uppercase (PascalCase): ' + name);
            }
            // Leading/trailing whitespace or double underscores (internal convention leak).
            if (/__/.test(name)) {
                violations.push('Name contains double underscore: ' + name);
            }

            if (violations.length > 0) {
                results.push({
                    include_sys_id: sysId,
                    include_name: name,
                    severity: 'low',
                    detail: violations.join(' | ')
                });
            }
        }
        return results;
    },

    /**
     * Documentation scorer: flags includes missing @description/JSDoc and
     * computes a per-include 0-100 hygiene sub-score.
     * @returns {Array} doc findings + per-include scores
     */
    scoreDocs: function() {
        var graph = this._requireGraph();
        var results = [];
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            var score = 100;
            var issues = [];

            if (!entry.description) {
                score -= 35;
                issues.push('Missing description field');
            }
            if (!/@description/i.test(entry.script)) {
                score -= 25;
                issues.push('Missing @description JSDoc tag');
            }
            if (!/@param/i.test(entry.script) && entry.functions.length > 0) {
                score -= 20;
                issues.push('No @param JSDoc tags on public methods');
            }
            if (!/@returns?/i.test(entry.script) && entry.functions.length > 0) {
                score -= 20;
                issues.push('No @return JSDoc tags on public methods');
            }
            if (score < 0) {
                score = 0;
            }

            results.push({
                include_sys_id: sysId,
                include_name: entry.name,
                score: score,
                severity: score < 50 ? 'high' : (score < 80 ? 'medium' : 'low'),
                detail: issues.length ? issues.join(' | ') : 'Documented'
            });
        }
        return results;
    },

    /**
     * Circular-dependency detector: walks the call graph for cycles.
     * @returns {Array} cycle findings (with the exact cycle path)
     */
    detectCycles: function() {
        var graph = this._requireGraph();
        var results = [];
        var WHITE = 0, GRAY = 1, BLACK = 2;
        var color = {};
        var stack = [];

        // Build adjacency from edges (caller -> callee by include name).
        var adj = {};
        for (var e = 0; e < graph.edges.length; e++) {
            var edge = graph.edges[e];
            if (!adj[edge.caller]) {
                adj[edge.caller] = [];
            }
            adj[edge.caller].push(edge.callee);
        }

        // Resolve include names for node iteration.
        var names = [];
        for (var sysId in graph.includes) {
            if (graph.includes.hasOwnProperty(sysId)) {
                names.push(graph.includes[sysId].name);
                color[graph.includes[sysId].name] = WHITE;
            }
        }

        var self = this;
        function dfs(node) {
            color[node] = GRAY;
            stack.push(node);
            var neighbors = adj[node] || [];
            for (var n = 0; n < neighbors.length; n++) {
                var next = neighbors[n];
                if (color[next] === GRAY) {
                    // Cycle found: extract the sub-path from stack.
                    var start = stack.indexOf(next);
                    var cyclePath = stack.slice(start);
                    cyclePath.push(next);
                    results.push({
                        cycle: cyclePath,
                        length: cyclePath.length - 1,
                        severity: 'critical',
                        detail: 'Circular dependency: ' + cyclePath.join(' → ')
                    });
                } else if (color[next] === WHITE) {
                    dfs(next);
                }
            }
            stack.pop();
            color[node] = BLACK;
        }

        for (var i = 0; i < names.length; i++) {
            if (color[names[i]] === WHITE) {
                dfs(names[i]);
            }
        }
        return results;
    },

    /**
     * OOTB-reinvention flagger: matches custom function signatures against
     * known GlideSystem/GlideRecord utilities the platform already provides.
     * @returns {Array} reinvention findings
     */
    flagOotbReinvention: function() {
        var graph = this._requireGraph();
        var results = [];
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            for (var u = 0; u < this._OOTB_UTILITIES.length; u++) {
                var util = this._OOTB_UTILITIES[u];
                if (util.pattern.test(entry.script)) {
                    results.push({
                        include_sys_id: sysId,
                        include_name: entry.name,
                        severity: 'medium',
                        detail: 'Reimplements platform utility — use ' + util.platform + ' instead.'
                    });
                }
            }
        }
        return results;
    },

    /**
     * Aggregate per-include health score (0-100) from the detector outputs.
     * @returns {Object} { perInclude:[{include_sys_id, include_name, score}], instance: 0-100 }
     */
    computeHealth: function(dead, duplicates, naming, docs, cycles, reinvention) {
        var graph = this._requireGraph();
        var penalty = {}; // includeSysId -> penalty points

        function addPenalty(id, pts) {
            if (penalty[id] === undefined) {
                penalty[id] = 0;
            }
            penalty[id] += pts;
        }

        for (var d = 0; d < dead.length; d++) {
            addPenalty(dead[d].include_sys_id, 40);
        }
        for (var dup = 0; dup < duplicates.length; dup++) {
            addPenalty(duplicates[dup].include_a_sys_id, 30);
            addPenalty(duplicates[dup].include_b_sys_id, 30);
        }
        for (var nm = 0; nm < naming.length; nm++) {
            addPenalty(naming[nm].include_sys_id, 15);
        }
        for (var doc = 0; doc < docs.length; doc++) {
            // docs already carry a 0-100 score; convert to penalty.
            addPenalty(docs[doc].include_sys_id, Math.round((100 - docs[doc].score) * 0.3));
        }
        for (var cy = 0; cy < cycles.length; cy++) {
            var path = cycles[cy].cycle || [];
            for (var p = 0; p < path.length; p++) {
                this._penalizeByName(graph, penalty, path[p], 50);
            }
        }
        for (var r = 0; r < reinvention.length; r++) {
            addPenalty(reinvention[r].include_sys_id, 15);
        }

        var perInclude = [];
        var total = 0;
        var count = 0;
        for (var sysId in graph.includes) {
            if (!graph.includes.hasOwnProperty(sysId)) {
                continue;
            }
            var entry = graph.includes[sysId];
            var pts = penalty[sysId] || 0;
            var score = 100 - pts;
            if (score < 0) {
                score = 0;
            }
            perInclude.push({ include_sys_id: sysId, include_name: entry.name, score: score });
            total += score;
            count++;
        }

        var instance = count > 0 ? Math.round(total / count) : 100;
        return { perInclude: perInclude, instance: instance };
    },

    _penalizeByName: function(graph, penalty, name, pts) {
        for (var sysId in graph.includes) {
            if (graph.includes.hasOwnProperty(sysId) && graph.includes[sysId].name === name) {
                if (penalty[sysId] === undefined) {
                    penalty[sysId] = 0;
                }
                penalty[sysId] += pts;
            }
        }
    },

    /**
     * Normalize a script body for similarity comparison: strip comments,
     * whitespace, string literals, and normalize identifiers to a token stream.
     * @returns {string} normalized token signature
     */
    _normalize: function(script) {
        if (!script) {
            return '';
        }
        var s = script;
        s = s.replace(/\/\*[\s\S]*?\*\//g, '');     // block comments
        s = s.replace(/\/\/.*$/gm, '');              // line comments
        s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");   // string literals
        s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
        s = s.replace(/\s+/g, ' ').trim();           // collapse whitespace
        return s;
    },

    /**
     * Dice-coefficient similarity between two normalized bodies via character
     * bigrams. O(n) and robust to identifier renames that preserve structure.
     * @returns {number} 0.0 - 1.0
     */
    _similarity: function(a, b) {
        if (!a || !b) {
            return 0;
        }
        if (a === b) {
            return 1;
        }
        var bigrams = function(s) {
            var set = {};
            for (var i = 0; i < s.length - 1; i++) {
                set[s.substr(i, 2)] = true;
            }
            return set;
        };
        var ba = bigrams(a);
        var bb = bigrams(b);
        var inter = 0;
        for (var key in ba) {
            if (ba.hasOwnProperty(key) && bb[key]) {
                inter++;
            }
        }
        var total = Object.keys(ba).length + Object.keys(bb).length;
        return total === 0 ? 0 : (2 * inter) / total;
    },

    _escapeRe: function(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    _requireGraph: function() {
        if (!this._graph) {
            this._graph = this.buildCallGraph();
        }
        return this._graph;
    }
};
