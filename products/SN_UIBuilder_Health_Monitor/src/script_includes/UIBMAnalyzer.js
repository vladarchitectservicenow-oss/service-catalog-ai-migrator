/**
 * UIBMAnalyzer — UIBuilder Health Monitor Dependency Analyzer + Query Engine
 * Scoped App: x_snc_uibm
 *
 * Consolidates: DependencyAnalyzer (cycle detection, orphan detection, broken refs),
 *               Findings query engine, Recommendations query engine,
 *               Safe Mode session queries
 *
 * Public API:
 *   - analyzeDependencies(pageSysId)  → Full dependency analysis for a page
 *   - detectCircularDependencies(tree) → DFS cycle detection
 *   - detectOrphanedComponents()       → Find unreferenced macroponents
 *   - detectBrokenReferences(pageSysId) → Find broken data source/event refs
 *   - runFullAnalysis()                → Analyze all pages (nightly)
 *   - getFindings(filters)             → Query findings with filters
 *   - getRecommendations(filters)      → Query recommendations
 *   - getSafeModeSessions()            → List active Safe Mode sessions
 *   - getWeeklyReport()                → Aggregated weekly health summary
 *
 * @author UIBuilder Health Monitor
 * @version 1.0.0
 */

var UIBMAnalyzer = Class.create();
UIBMAnalyzer.prototype = {
    initialize: function() {
        this.SCOPE = 'x_snc_uibm';
        this.MAX_CYCLE_DEPTH = 50; // Prevent infinite loops in cycle detection
        this._compNameCache = {}; // Instance-level cache, not shared across instances
    },

    // ═════════════════════════════════════════════════════════════════════
    // DEPENDENCY ANALYZER
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Runs full dependency analysis on a single page.
     * Detects circular dependencies, broken references, and records findings.
     * @param {String} pageSysId — sys_ux_page sys_id
     * @returns {Object} analysis result
     */
    analyzeDependencies: function(pageSysId) {
        try {
            var core = new UIBMCore();
            var pageInfo = core._getPageInfo(pageSysId);
            if (!pageInfo) {
                return { ok: false, error: 'Page not found: ' + pageSysId };
            }

            var componentTree = core._buildComponentTree(pageSysId);
            var scanRunId = gs.generateGUID();
            var findings = [];

            // 1. Circular dependency detection
            var cycles = this.detectCircularDependencies(componentTree);
            for (var i = 0; i < cycles.length; i++) {
                var cyclePath = cycles[i].join(' → ');
                var findingId = this._createFinding({
                    page_sys_id: pageSysId,
                    page_name: pageInfo.name,
                    finding_type: 'circular',
                    severity: 'critical',
                    status: 'open',
                    title: 'Circular dependency: ' + cyclePath,
                    description: 'Components form a circular dependency chain: ' + cyclePath +
                                 '. Circular dependencies cause infinite render loops and browser freezes.',
                    action: 'Break the cycle by extracting shared state to a client-state parameter. ' +
                            'Remove one link in the chain so that the dependency graph becomes a DAG.',
                    category: 'dependency',
                    effort: 'medium',
                    cycle_path: cyclePath,
                    affected_component_ids: JSON.stringify(cycles[i]),
                    scan_run_id: scanRunId
                });
                findings.push({ type: 'circular', severity: 'critical', cycle: cyclePath });
            }

            // 2. Broken references
            var brokenRefs = this.detectBrokenReferences(pageSysId);
            for (var j = 0; j < brokenRefs.length; j++) {
                this._createFinding({
                    page_sys_id: pageSysId,
                    page_name: pageInfo.name,
                    finding_type: 'broken_ref',
                    severity: brokenRefs[j].severity,
                    status: 'open',
                    title: brokenRefs[j].title,
                    description: brokenRefs[j].description,
                    action: brokenRefs[j].action,
                    category: 'dependency',
                    effort: 'low',
                    detail_json: JSON.stringify(brokenRefs[j]),
                    scan_run_id: scanRunId
                });
                findings.push(brokenRefs[j]);
            }

            // 3. Update finding counts on page health record
            var findingCounts = this._getFindingCountsForPage(pageSysId);
            core.updatePageHealthRecord(pageSysId, {
                critical_findings: findingCounts.critical,
                warning_findings: findingCounts.warning,
                info_findings: findingCounts.info
            });

            return {
                ok: true,
                data: {
                    page_sys_id: pageSysId,
                    page_name: pageInfo.name,
                    scan_run_id: scanRunId,
                    findings_count: findings.length,
                    findings: findings
                }
            };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.analyzeDependencies] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Detects circular dependencies in a component tree using DFS.
     * @param {Object} tree — component tree from UIBMCore._buildComponentTree
     * @returns {Array} array of cycle paths (each is an array of component names)
     */
    detectCircularDependencies: function(tree) {
        var cycles = [];
        var visited = {};
        var recursionStack = {};
        var path = [];

        var self = this;

        function dfs(node) {
            if (!node || !node.sys_id) return;

            var nodeId = node.sys_id;

            // If already in recursion stack, we found a cycle
            if (recursionStack[nodeId]) {
                // Extract the cycle from the path
                var cycleStart = path.indexOf(nodeId);
                if (cycleStart !== -1) {
                    var cycleNodes = path.slice(cycleStart).map(function(id) {
                        return self._getComponentName(id);
                    });
                    cycleNodes.push(self._getComponentName(nodeId));
                    cycles.push(cycleNodes);
                }
                return;
            }

            // Already fully visited — no cycle through this node
            if (visited[nodeId]) return;

            visited[nodeId] = true;
            recursionStack[nodeId] = true;
            path.push(nodeId);

            // Limit depth to prevent infinite loops
            if (path.length > self.MAX_CYCLE_DEPTH) {
                path.pop();
                delete recursionStack[nodeId];
                return;
            }

            // Traverse children
            if (node.children) {
                for (var i = 0; i < node.children.length; i++) {
                    dfs(node.children[i]);
                }
            }

            // Also check event subscription references (cross-component refs)
            var eventRefs = self._getEventSubscriptionRefs(nodeId);
            for (var e = 0; e < eventRefs.length; e++) {
                var refNode = self._findNodeInTree(tree, eventRefs[e]);
                if (refNode) {
                    dfs(refNode);
                }
            }

            path.pop();
            delete recursionStack[nodeId];
        }

        // Start DFS from root children
        if (tree.children) {
            for (var c = 0; c < tree.children.length; c++) {
                dfs(tree.children[c]);
            }
        }

        // Deduplicate cycles (same cycle can be found from different entry points)
        return this._deduplicateCycles(cycles);
    },

    /**
     * Detects orphaned components — macroponents not referenced by any page.
     * @returns {Object} result with orphaned component list
     */
    detectOrphanedComponents: function() {
        try {
            var orphans = [];
            var core = new UIBMCore();

            // Get all macroponents
            var allComponents = {};
            try {
                var grComp = new GlideRecord('sys_ux_macroponent');
                grComp.addActiveQuery();
                grComp.query();
                while (grComp.next()) {
                    allComponents[grComp.getUniqueValue()] = {
                        sys_id: grComp.getUniqueValue(),
                        name: grComp.name ? grComp.name.toString() : 'unnamed',
                        type: grComp.component ? grComp.component.toString() : 'unknown'
                    };
                }
            } catch (e) {
                gs.logWarning('[UIBMAnalyzer.detectOrphanedComponents] Failed to read macroponents: ' + e.message);
                return { ok: false, error: e.message };
            }

            // Get all referenced components from pages
            var referenced = {};
            var pages = core._getAllUIBuilderPages();
            for (var i = 0; i < pages.length; i++) {
                var tree = core._buildComponentTree(pages[i].sys_id);
                var flat = core._flattenComponentTree(tree);
                for (var j = 0; j < flat.length; j++) {
                    referenced[flat[j].sys_id] = true;
                }
            }

            // Find orphans
            var scanRunId = gs.generateGUID();
            for (var compId in allComponents) {
                if (allComponents.hasOwnProperty(compId) && !referenced[compId]) {
                    orphans.push(allComponents[compId]);
                    // Create finding
                    this._createFinding({
                        page_sys_id: '',
                        page_name: '(orphaned)',
                        finding_type: 'orphaned',
                        severity: 'info',
                        status: 'open',
                        title: 'Orphaned component: ' + allComponents[compId].name,
                        description: 'Component "' + allComponents[compId].name + '" (' +
                                     allComponents[compId].type + ') exists but is not referenced by any UI Builder page.',
                        action: 'Review and delete unused components to reduce instance bloat. ' +
                                'If this component is intentionally shared, document its usage.',
                        category: 'maintainability',
                        effort: 'low',
                        affected_component_ids: compId,
                        scan_run_id: scanRunId
                    });
                }
            }

            return {
                ok: true,
                data: {
                    orphaned_count: orphans.length,
                    orphans: orphans,
                    scan_run_id: scanRunId
                }
            };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.detectOrphanedComponents] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Detects broken references on a page — references to deleted data sources,
     * removed event subscriptions, or missing client-state parameters.
     * @param {String} pageSysId
     * @returns {Array} broken reference findings
     */
    detectBrokenReferences: function(pageSysId) {
        var broken = [];

        // Check data source references
        try {
            var grDS = new GlideRecord('sys_data_source');
            grDS.addQuery('sys_ux_page', pageSysId);
            grDS.query();
            while (grDS.next()) {
                // Check if the data source has a valid script include or table
                var scriptInclude = grDS.script_include ? grDS.script_include.toString() : '';
                var tableName = grDS.table ? grDS.table.toString() : '';
                if (scriptInclude) {
                    var grSI = new GlideRecord('sys_script_include');
                    if (!grSI.get(scriptInclude)) {
                        broken.push({
                            title: 'Data source references missing Script Include',
                            description: 'Data source "' + (grDS.name || 'unnamed') + '" references Script Include ' +
                                         scriptInclude + ' which no longer exists.',
                            action: 'Update the data source to reference a valid Script Include, or recreate the missing one.',
                            severity: 'warning',
                            type: 'broken_ref'
                        });
                    }
                }
                if (tableName) {
                    var grTable = new GlideRecord('sys_db_object');
                    if (!grTable.get(tableName)) {
                        broken.push({
                            title: 'Data source references missing table: ' + tableName,
                            description: 'Data source "' + (grDS.name || 'unnamed') + '" references table ' +
                                         tableName + ' which no longer exists or was renamed.',
                            action: 'Update the data source to reference the current table name, or recreate the table.',
                            severity: 'critical',
                            type: 'broken_ref'
                        });
                    }
                }
            }
        } catch (e) {
            // sys_data_source may not have sys_ux_page field — skip
        }

        // Check event subscription references
        try {
            var grEvent = new GlideRecord('sys_ux_event_subscription');
            grEvent.addQuery('page', pageSysId);
            grEvent.query();
            while (grEvent.next()) {
                var eventDef = grEvent.event_definition ? grEvent.event_definition.toString() : '';
                if (eventDef) {
                    var grEventDef = new GlideRecord('sys_ux_event_definition');
                    if (!grEventDef.get(eventDef)) {
                        broken.push({
                            title: 'Event subscription references missing event definition',
                            description: 'An event subscription on this page references event definition ' +
                                         eventDef + ' which no longer exists.',
                            action: 'Remove the orphaned event subscription or recreate the event definition.',
                            severity: 'warning',
                            type: 'broken_ref'
                        });
                    }
                }
                // Check if subscriber component still exists
                var subscriberComp = grEvent.subscriber_component ? grEvent.subscriber_component.toString() : '';
                if (subscriberComp) {
                    var grSubComp = new GlideRecord('sys_ux_macroponent');
                    if (!grSubComp.get(subscriberComp)) {
                        broken.push({
                            title: 'Event subscription references missing component',
                            description: 'An event subscription references component ' + subscriberComp +
                                         ' which has been deleted from the page.',
                            action: 'Remove the orphaned event subscription.',
                            severity: 'warning',
                            type: 'broken_ref'
                        });
                    }
                }
            }
        } catch (e) {
            // Table may not exist — skip
        }

        // Check client-state parameter references
        try {
            var grParam = new GlideRecord('sys_ux_client_data_parameter');
            grParam.addQuery('page', pageSysId);
            grParam.addNullQuery('component');
            grParam.query();
            var count = grParam.getRowCount();
            if (count > 0) {
                broken.push({
                    title: count + ' client-state parameters have no associated component',
                    description: 'There are ' + count + ' client-state parameters on this page that are not ' +
                                 'associated with any component. These are likely leftovers from deleted components.',
                    action: 'Review and remove orphaned client-state parameters to reduce page complexity.',
                    severity: 'info',
                    type: 'broken_ref'
                });
            }
        } catch (e) {
            // Table may not exist — skip
        }

        return broken;
    },

    /**
     * Runs full analysis across all UI Builder pages.
     * Called by scheduled job after complexity scan.
     * @returns {Object} summary
     */
    runFullAnalysis: function() {
        try {
            var core = new UIBMCore();
            var pages = core._getAllUIBuilderPages();
            var summary = {
                pages_analyzed: 0,
                cycles_found: 0,
                broken_refs_found: 0,
                orphans_found: 0,
                errors: 0
            };

            for (var i = 0; i < pages.length; i++) {
                try {
                    var result = this.analyzeDependencies(pages[i].sys_id);
                    if (result.ok) {
                        summary.pages_analyzed++;
                        for (var j = 0; j < result.data.findings.length; j++) {
                            if (result.data.findings[j].type === 'circular') summary.cycles_found++;
                            if (result.data.findings[j].type === 'broken_ref') summary.broken_refs_found++;
                        }
                    } else {
                        summary.errors++;
                    }
                } catch (e) {
                    summary.errors++;
                }
            }

            // Run orphan detection
            var orphanResult = this.detectOrphanedComponents();
            if (orphanResult.ok) {
                summary.orphans_found = orphanResult.data.orphaned_count;
            }

            gs.log('[UIBMAnalyzer] Full analysis complete: ' + summary.pages_analyzed + ' pages, ' +
                   summary.cycles_found + ' cycles, ' + summary.broken_refs_found + ' broken refs, ' +
                   summary.orphans_found + ' orphans');

            return { ok: true, data: summary };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.runFullAnalysis] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // QUERY ENGINE (for REST API)
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Queries findings with optional filters.
     * @param {Object} filters — { page_sys_id, finding_type, severity, status, scan_run_id, limit }
     * @returns {Object} findings array
     */
    getFindings: function(filters) {
        try {
            filters = filters || {};
            var gr = new GlideRecord('x_snc_uibm_finding');
            gr.orderByDesc('detected_at');
            if (filters.page_sys_id) gr.addQuery('page_sys_id', filters.page_sys_id);
            if (filters.finding_type) gr.addQuery('finding_type', filters.finding_type);
            if (filters.severity) gr.addQuery('severity', filters.severity);
            if (filters.status) gr.addQuery('status', filters.status);
            if (filters.scan_run_id) gr.addQuery('scan_run_id', filters.scan_run_id);
            gr.setLimit(parseInt(filters.limit || '100', 10));
            gr.query();

            var findings = [];
            while (gr.next()) {
                findings.push({
                    sys_id: gr.getUniqueValue(),
                    number: gr.number ? gr.number.toString() : '',
                    finding_type: gr.finding_type.toString(),
                    severity: gr.severity.toString(),
                    status: gr.status.toString(),
                    page_sys_id: gr.page_sys_id.toString(),
                    page_name: gr.page_name.toString(),
                    title: gr.title.toString(),
                    description: gr.description ? gr.description.toString() : '',
                    action: gr.action ? gr.action.toString() : '',
                    category: gr.category ? gr.category.toString() : '',
                    effort: gr.effort ? gr.effort.toString() : '',
                    cycle_path: gr.cycle_path ? gr.cycle_path.toString() : '',
                    detected_at: gr.detected_at.toString(),
                    resolved_at: gr.resolved_at ? gr.resolved_at.toString() : ''
                });
            }

            return { ok: true, data: { count: findings.length, findings: findings } };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.getFindings] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Queries recommendations (findings of type 'recommendation').
     * @param {Object} filters — { page_sys_id, severity, status, category, limit }
     * @returns {Object} recommendations array
     */
    getRecommendations: function(filters) {
        try {
            filters = filters || {};
            var gr = new GlideRecord('x_snc_uibm_finding');
            gr.addQuery('finding_type', 'recommendation');
            gr.orderBy('severity');
            gr.orderByDesc('detected_at');
            if (filters.page_sys_id) gr.addQuery('page_sys_id', filters.page_sys_id);
            if (filters.severity) gr.addQuery('severity', filters.severity);
            if (filters.status) gr.addQuery('status', filters.status);
            if (filters.category) gr.addQuery('category', filters.category);
            gr.setLimit(parseInt(filters.limit || '100', 10));
            gr.query();

            var recs = [];
            while (gr.next()) {
                recs.push({
                    sys_id: gr.getUniqueValue(),
                    page_name: gr.page_name.toString(),
                    page_sys_id: gr.page_sys_id.toString(),
                    title: gr.title.toString(),
                    description: gr.description ? gr.description.toString() : '',
                    action: gr.action ? gr.action.toString() : '',
                    category: gr.category ? gr.category.toString() : '',
                    severity: gr.severity.toString(),
                    effort: gr.effort ? gr.effort.toString() : '',
                    status: gr.status.toString(),
                    detected_at: gr.detected_at.toString()
                });
            }

            return { ok: true, data: { count: recs.length, recommendations: recs } };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.getRecommendations] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Gets all active Safe Mode sessions.
     * @returns {Object} sessions array
     */
    getSafeModeSessions: function() {
        try {
            var sessions = [];
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('safe_mode_active', 'true');
            gr.query();
            while (gr.next()) {
                sessions.push({
                    page_sys_id: gr.page_sys_id.toString(),
                    page_name: gr.page_name.toString(),
                    safe_mode_user: gr.safe_mode_user ? gr.safe_mode_user.toString() : '',
                    safe_mode_enabled_at: gr.safe_mode_enabled_at ? gr.safe_mode_enabled_at.toString() : '',
                    disabled_components: gr.disabled_components ? gr.disabled_components.toString() : '[]'
                });
            }
            return { ok: true, data: { count: sessions.length, sessions: sessions } };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.getSafeModeSessions] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Generates a weekly health report — aggregated metrics across all pages.
     * @returns {Object} weekly report data
     */
    getWeeklyReport: function() {
        try {
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.orderByDesc('last_scanned');
            gr.query();

            var pages = [];
            var seenPages = {};
            var totalScore = 0;
            var redCount = 0;
            var yellowCount = 0;
            var greenCount = 0;
            var totalCritical = 0;
            var totalWarning = 0;
            var totalInfo = 0;
            var totalLoadMs = 0;
            var loadSamples = 0;

            while (gr.next()) {
                var pageId = gr.page_sys_id.toString();
                if (seenPages[pageId]) continue;
                seenPages[pageId] = true;

                var score = parseInt(gr.complexity_score.toString() || '0', 10);
                var cat = gr.score_category.toString();
                var critical = parseInt(gr.critical_findings.toString() || '0', 10);
                var warning = parseInt(gr.warning_findings.toString() || '0', 10);
                var info = parseInt(gr.info_findings.toString() || '0', 10);
                var loadMs = parseInt(gr.avg_load_ms.toString() || '0', 10);

                totalScore += score;
                totalCritical += critical;
                totalWarning += warning;
                totalInfo += info;
                if (loadMs > 0) {
                    totalLoadMs += loadMs;
                    loadSamples++;
                }

                if (cat === 'red') redCount++;
                else if (cat === 'yellow') yellowCount++;
                else if (cat === 'green') greenCount++;

                pages.push({
                    page_name: gr.page_name.toString(),
                    page_sys_id: pageId,
                    complexity_score: score,
                    category: cat,
                    critical: critical,
                    warning: warning,
                    info: info,
                    avg_load_ms: loadMs,
                    last_scanned: gr.last_scanned ? gr.last_scanned.toString() : ''
                });
            }

            var pageCount = pages.length;
            var avgScore = pageCount > 0 ? Math.round(totalScore / pageCount) : 0;
            var avgLoad = loadSamples > 0 ? Math.round(totalLoadMs / loadSamples) : 0;

            // Get total orphaned and circular findings
            var grFindings = new GlideRecord('x_snc_uibm_finding');
            grFindings.addQuery('status', 'open');
            grFindings.addQuery('finding_type', 'circular');
            grFindings.query();
            var circularCount = grFindings.getRowCount();

            grFindings = new GlideRecord('x_snc_uibm_finding');
            grFindings.addQuery('status', 'open');
            grFindings.addQuery('finding_type', 'orphaned');
            grFindings.query();
            var orphanedCount = grFindings.getRowCount();

            return {
                ok: true,
                data: {
                    report_date: new GlideDateTime().getDisplayValue(),
                    summary: {
                        pages_total: pageCount,
                        pages_green: greenCount,
                        pages_yellow: yellowCount,
                        pages_red: redCount,
                        avg_complexity_score: avgScore,
                        avg_load_ms: avgLoad,
                        total_findings: {
                            critical: totalCritical,
                            warning: totalWarning,
                            info: totalInfo,
                            circular: circularCount,
                            orphaned: orphanedCount
                        }
                    },
                    pages: pages.sort(function(a, b) {
                        return b.complexity_score - a.complexity_score;
                    })
                }
            };
        } catch (ex) {
            gs.logError('[UIBMAnalyzer.getWeeklyReport] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — GRAPH UTILITIES
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @private — component name lookup (uses instance cache)
     */
    _getComponentName: function(sysId) {
        if (this._compNameCache[sysId]) return this._compNameCache[sysId];
        try {
            var gr = new GlideRecord('sys_ux_macroponent');
            if (gr.get(sysId)) {
                var name = gr.name ? gr.name.toString() : sysId.substring(0, 8);
                this._compNameCache[sysId] = name;
                return name;
            }
        } catch (e) {}
        return sysId.substring(0, 8);
    },

    /**
     * @private
     */
    _findNodeInTree: function(tree, sysId) {
        function search(node) {
            if (node.sys_id === sysId) return node;
            if (node.children) {
                for (var i = 0; i < node.children.length; i++) {
                    var found = search(node.children[i]);
                    if (found) return found;
                }
            }
            return null;
        }
        return search(tree);
    },

    /**
     * @private
     */
    _getEventSubscriptionRefs: function(componentSysId) {
        var refs = [];
        try {
            var gr = new GlideRecord('sys_ux_event_subscription');
            gr.addQuery('subscriber_component', componentSysId);
            gr.query();
            while (gr.next()) {
                var targetComp = gr.publisher_component ? gr.publisher_component.toString() : '';
                if (targetComp) refs.push(targetComp);
            }
        } catch (e) {
            // Table may not exist
        }
        return refs;
    },

    /**
     * @private
     */
    _deduplicateCycles: function(cycles) {
        var seen = {};
        var unique = [];
        for (var i = 0; i < cycles.length; i++) {
            // Normalize: sort the cycle to create a canonical key
            var key = cycles[i].slice().sort().join('|');
            if (!seen[key]) {
                seen[key] = true;
                unique.push(cycles[i]);
            }
        }
        return unique;
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — FINDING CREATION
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @private
     */
    _createFinding: function(data) {
        try {
            var gr = new GlideRecord('x_snc_uibm_finding');
            gr.initialize();
            gr.page_sys_id = data.page_sys_id || '';
            gr.page_name = data.page_name || '';
            gr.finding_type = data.finding_type || 'recommendation';
            gr.severity = data.severity || 'info';
            gr.status = data.status || 'open';
            gr.title = data.title || '';
            gr.description = data.description || '';
            gr.action = data.action || '';
            gr.category = data.category || 'maintainability';
            gr.effort = data.effort || 'low';
            gr.scan_run_id = data.scan_run_id || gs.generateGUID();
            gr.detected_at = new GlideDateTime();
            if (data.cycle_path) gr.cycle_path = data.cycle_path;
            if (data.affected_component_ids) gr.affected_component_ids = data.affected_component_ids;
            if (data.detail_json) gr.detail_json = data.detail_json;
            return gr.insert();
        } catch (e) {
            gs.logError('[UIBMAnalyzer._createFinding] ' + e.message);
            return null;
        }
    },

    /**
     * @private
     */
    _getFindingCountsForPage: function(pageSysId) {
        var counts = { critical: 0, warning: 0, info: 0 };
        try {
            var gr = new GlideRecord('x_snc_uibm_finding');
            gr.addQuery('page_sys_id', pageSysId);
            gr.addQuery('status', 'open');
            gr.query();
            while (gr.next()) {
                var sev = gr.severity.toString();
                if (counts[sev] !== undefined) counts[sev]++;
            }
        } catch (e) {}
        return counts;
    },

    type: 'UIBMAnalyzer'
};