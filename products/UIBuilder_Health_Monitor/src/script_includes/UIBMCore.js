/**
 * UIBMCore — UIBuilder Health Monitor Core Engine
 * Scoped App: x_snc_uibm
 *
 * Consolidates: ComplexityScanner, ScoringEngine, SafeModeManager,
 *               PerformanceCollector, HealthGateAPI
 *
 * Public API:
 *   - scanPage(pageSysId)           → Complexity scan + scoring for one page
 *   - scanAllPages()                 → Full instance scan (scheduled job)
 *   - scoreComplexity(metrics)       → Calculate 0-100 score from metrics
 *   - getHealthScore(pageSysId)      → Get health score for a page
 *   - getInstanceHealth(threshold)   → Instance-wide health gate (CI/CD)
 *   - enableSafeMode(pageSysId)      → Enable Safe Mode for a frozen page
 *   - disableSafeMode(pageSysId)     → Disable Safe Mode
 *   - receiveMetrics(payload)        → Process client-side performance data
 *   - getRecommendations(pageSysId)  → Get actionable recommendations for a page
 *   - updatePageHealthRecord(pageSysId, data) → Upsert page health record
 *
 * @author UIBuilder Health Monitor
 * @version 1.0.0
 */

var UIBMCore = Class.create();
UIBMCore.prototype = {
    initialize: function() {
        this.SCHEMA_VERSION = '1.0.0';
        this.SCOPE = 'x_snc_uibm';

        // Scoring weights (total = 100)
        this.WEIGHTS = {
            component_count: 25,
            nesting_depth: 25,
            data_source_count: 20,
            gliderecord_calls: 20,
            external_deps: 10
        };

        // Thresholds for performance alerts
        this.PERF_THRESHOLDS = {
            load_ms: parseInt(gs.getProperty('x_snc_uibm.perf.threshold.load', '5000'), 10),
            long_tasks: parseInt(gs.getProperty('x_snc_uibm.perf.threshold.tasks', '10'), 10),
            memory_mb: parseInt(gs.getProperty('x_snc_uibm.perf.threshold.memory', '200'), 10)
        };

        // CI/CD gate threshold
        this.CI_GATE_THRESHOLD = parseInt(gs.getProperty('x_snc_uibm.ci.gate_threshold', '60'), 10);
    },

    // ═════════════════════════════════════════════════════════════════════
    // COMPLEXITY SCANNER + SCORING ENGINE
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Scans a single UI Builder page: reads macroponent metadata,
     * builds component tree, calculates complexity score.
     * @param {String} pageSysId — sys_ux_page sys_id
     * @returns {Object} scan result with score, breakdown, component tree
     */
    scanPage: function(pageSysId) {
        try {
            var pageInfo = this._getPageInfo(pageSysId);
            if (!pageInfo) {
                return { ok: false, error: 'Page not found: ' + pageSysId };
            }

            // Build component tree from sys_ux_macroponent
            var componentTree = this._buildComponentTree(pageSysId);
            var flatComponents = this._flattenComponentTree(componentTree);

            // Calculate metrics
            var metrics = {
                component_count: flatComponents.length,
                nesting_depth: this._maxDepth(componentTree),
                data_source_count: this._countDataSources(pageSysId),
                gliderecord_calls: this._estimateGlideRecordCalls(flatComponents),
                external_deps: this._countExternalDependencies(flatComponents)
            };

            // Score
            var score = this.scoreComplexity(metrics);
            var category = this._scoreCategory(score);

            // Build breakdown
            var breakdown = {
                weights: this.WEIGHTS,
                metrics: metrics,
                component_scores: this._componentScoreBreakdown(metrics),
                score: score,
                category: category
            };

            // Update page health record
            var scanRunId = gs.generateGUID();
            this.updatePageHealthRecord(pageSysId, {
                page_name: pageInfo.name,
                page_route: pageInfo.route || '',
                complexity_score: score,
                score_category: category,
                component_count: metrics.component_count,
                nesting_depth: metrics.nesting_depth,
                data_source_count: metrics.data_source_count,
                gliderecord_calls: metrics.gliderecord_calls,
                external_deps: metrics.external_deps,
                score_breakdown: JSON.stringify(breakdown),
                component_json: JSON.stringify(componentTree),
                last_scanned: new GlideDateTime().getDisplayValue(),
                scan_run_id: scanRunId
            });

            return {
                ok: true,
                data: {
                    page_sys_id: pageSysId,
                    page_name: pageInfo.name,
                    score: score,
                    category: category,
                    metrics: metrics,
                    breakdown: breakdown,
                    scan_run_id: scanRunId
                }
            };
        } catch (ex) {
            gs.logError('[UIBMCore.scanPage] Error scanning page ' + pageSysId + ': ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Scans all UI Builder pages on the instance.
     * Called by scheduled job (nightly 02:00).
     * @returns {Object} summary of scan results
     */
    scanAllPages: function() {
        try {
            var scanRunId = gs.generateGUID();
            var pages = this._getAllUIBuilderPages();
            var results = {
                scan_run_id: scanRunId,
                pages_scanned: 0,
                pages_green: 0,
                pages_yellow: 0,
                pages_red: 0,
                errors: 0,
                started_at: new GlideDateTime().getDisplayValue()
            };

            for (var i = 0; i < pages.length; i++) {
                try {
                    var result = this.scanPage(pages[i].sys_id);
                    if (result.ok) {
                        results.pages_scanned++;
                        if (result.data.category === 'green') results.pages_green++;
                        else if (result.data.category === 'yellow') results.pages_yellow++;
                        else if (result.data.category === 'red') results.pages_red++;
                    } else {
                        results.errors++;
                        gs.logWarning('[UIBMCore.scanAllPages] Failed to scan page ' + pages[i].name + ': ' + result.error);
                    }
                } catch (e) {
                    results.errors++;
                }
            }

            results.completed_at = new GlideDateTime().getDisplayValue();
            gs.log('[UIBMCore] Scan complete: ' + results.pages_scanned + ' pages, ' +
                   results.pages_red + ' red, ' + results.pages_yellow + ' yellow, ' +
                   results.pages_green + ' green, ' + results.errors + ' errors');

            return { ok: true, data: results };
        } catch (ex) {
            gs.logError('[UIBMCore.scanAllPages] Fatal error: ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Calculates complexity score (0-100) from page metrics.
     * Each metric is normalized and weighted.
     * @param {Object} metrics — component_count, nesting_depth, data_source_count, gliderecord_calls, external_deps
     * @returns {Number} score 0-100
     */
    scoreComplexity: function(metrics) {
        var w = this.WEIGHTS;

        // Normalize each metric to 0-100 scale
        // Component count: 0=0, 50=100 (linear, capped)
        var compScore = Math.min(100, (metrics.component_count / 50) * 100);
        // Nesting depth: 0=0, 10=100 (linear, capped)
        var nestScore = Math.min(100, (metrics.nesting_depth / 10) * 100);
        // Data source count: 0=0, 20=100
        var dsScore = Math.min(100, (metrics.data_source_count / 20) * 100);
        // GlideRecord calls: 0=0, 15=100
        var grScore = Math.min(100, (metrics.gliderecord_calls / 15) * 100);
        // External deps: 0=0, 10=100
        var extScore = Math.min(100, (metrics.external_deps / 10) * 100);

        var total = Math.round(
            compScore * (w.component_count / 100) +
            nestScore * (w.nesting_depth / 100) +
            dsScore * (w.data_source_count / 100) +
            grScore * (w.gliderecord_calls / 100) +
            extScore * (w.external_deps / 100)
        );

        return Math.max(0, Math.min(100, total));
    },

    // ═════════════════════════════════════════════════════════════════════
    // HEALTH GATE API (CI/CD Integration)
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Get health score for a specific page.
     * @param {String} pageSysId
     * @returns {Object} health score data
     */
    getHealthScore: function(pageSysId) {
        try {
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.orderByDesc('last_scanned');
            gr.setLimit(1);
            gr.query();

            if (!gr.next()) {
                return { ok: false, error: 'No health data found for page: ' + pageSysId };
            }

            // Get finding counts
            var findingCounts = this._getFindingCounts(pageSysId);

            // Get performance data
            var perfData = this._getLatestPerfData(pageSysId);

            var data = {
                page: gr.page_name.toString(),
                page_sys_id: pageSysId,
                complexity_score: parseInt(gr.complexity_score.toString(), 10),
                score_category: gr.score_category.toString(),
                findings: findingCounts,
                performance: perfData,
                gate: this._determineGate(gr.complexity_score, findingCounts),
                last_scanned: gr.last_scanned.toString()
            };

            return { ok: true, data: data };
        } catch (ex) {
            gs.logError('[UIBMCore.getHealthScore] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Instance-wide health gate for CI/CD pipelines.
     * @param {Number} threshold — complexity score threshold (default from system property)
     * @returns {Object} gate result with PASS/FAIL and failing pages
     */
    getInstanceHealth: function(threshold) {
        try {
            var gateThreshold = threshold || this.CI_GATE_THRESHOLD;
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.orderByDesc('last_scanned');
            gr.query();

            var pages = [];
            var passing = 0;
            var failing = 0;
            var seenPages = {};

            while (gr.next()) {
                var pageId = gr.page_sys_id.toString();
                if (seenPages[pageId]) continue;
                seenPages[pageId] = true;

                var score = parseInt(gr.complexity_score.toString(), 10);
                var findingCounts = this._getFindingCounts(pageId);

                var pageData = {
                    page: gr.page_name.toString(),
                    page_sys_id: pageId,
                    complexity_score: score,
                    score_category: gr.score_category.toString(),
                    critical_findings: findingCounts.critical,
                    gate: this._determineGate(score, findingCounts, gateThreshold)
                };

                if (pageData.gate === 'PASS') {
                    passing++;
                } else {
                    failing++;
                    pages.push(pageData);
                }
            }

            return {
                ok: true,
                data: {
                    pages_total: passing + failing,
                    pages_passing: passing,
                    pages_failing: failing,
                    overall_gate: failing > 0 ? 'FAIL' : 'PASS',
                    gate_threshold: gateThreshold,
                    failing_pages: pages
                }
            };
        } catch (ex) {
            gs.logError('[UIBMCore.getInstanceHealth] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // SAFE MODE MANAGER
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Enables Safe Mode for a frozen UI Builder page.
     * Sets session flag and records all current components for progressive re-enablement.
     * @param {String} pageSysId
     * @returns {Object} result
     */
    enableSafeMode: function(pageSysId) {
        try {
            var pageInfo = this._getPageInfo(pageSysId);
            if (!pageInfo) {
                return { ok: false, error: 'Page not found: ' + pageSysId };
            }

            // Set session-scoped flag — client script reads this to strip components
            gs.getSession().putClientData('uibm_safe_mode', pageSysId);

            // Record current component state in page health record
            var componentTree = this._buildComponentTree(pageSysId);
            var flatComponents = this._flattenComponentTree(componentTree);
            var componentIds = [];
            for (var i = 0; i < flatComponents.length; i++) {
                componentIds.push(flatComponents[i].sys_id);
            }

            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.query();
            var now = new GlideDateTime();
            if (gr.next()) {
                gr.safe_mode_active = true;
                gr.safe_mode_user = gs.getUserID();
                gr.safe_mode_enabled_at = now;
                gr.disabled_components = JSON.stringify(componentIds);
                gr.update();
            } else {
                gr.initialize();
                gr.page_sys_id = pageSysId;
                gr.page_name = pageInfo.name;
                gr.safe_mode_active = true;
                gr.safe_mode_user = gs.getUserID();
                gr.safe_mode_enabled_at = now;
                gr.disabled_components = JSON.stringify(componentIds);
                gr.insert();
            }

            gs.log('[UIBMCore] Safe Mode enabled for page: ' + pageInfo.name + ' by ' + gs.getUserName());

            return {
                ok: true,
                data: {
                    page_sys_id: pageSysId,
                    page_name: pageInfo.name,
                    safe_mode: true,
                    component_count: componentIds.length,
                    message: 'Safe Mode active. Navigate to the page to begin progressive re-enablement.'
                }
            };
        } catch (ex) {
            gs.logError('[UIBMCore.enableSafeMode] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Disables Safe Mode for a page.
     * @param {String} pageSysId
     * @returns {Object} result
     */
    disableSafeMode: function(pageSysId) {
        try {
            // Clear session flag
            gs.getSession().putClientData('uibm_safe_mode', '');

            // Update page health record
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.query();
            if (gr.next()) {
                gr.safe_mode_active = false;
                gr.safe_mode_user = '';
                gr.safe_mode_enabled_at = null;
                gr.disabled_components = '';
                gr.update();
            }

            gs.log('[UIBMCore] Safe Mode disabled for page: ' + pageSysId);

            return {
                ok: true,
                data: {
                    page_sys_id: pageSysId,
                    safe_mode: false,
                    message: 'Safe Mode disabled. All components will load normally.'
                }
            };
        } catch (ex) {
            gs.logError('[UIBMCore.disableSafeMode] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Disables a specific component on a page (used during Safe Mode binary search).
     * @param {String} pageSysId
     * @param {String} componentSysId — sys_ux_macroponent_component sys_id
     * @returns {Object} result
     */
    disableComponent: function(pageSysId, componentSysId) {
        try {
            // Mark the component as disabled in sys_ux_macroponent
            // We use sys_ux_macroponent (not _component) since that is the table with write privilege
            var grComp = new GlideRecord('sys_ux_macroponent');
            if (grComp.get(componentSysId)) {
                if (grComp.isValidField('active')) {
                    grComp.active = false;
                    grComp.update();
                } else if (grComp.isValidField('status')) {
                    // Some versions use a status field
                    grComp.status = 'disabled';
                    grComp.update();
                }
            }

            // Update disabled components list in page health
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.query();
            if (gr.next()) {
                var disabled = JSON.parse(gr.disabled_components.toString() || '[]');
                // Add to disabled list if not already there
                if (disabled.indexOf(componentSysId) === -1) {
                    disabled.push(componentSysId);
                    gr.disabled_components = JSON.stringify(disabled);
                    gr.update();
                }
            }

            return { ok: true, data: { component_disabled: componentSysId } };
        } catch (ex) {
            gs.logError('[UIBMCore.disableComponent] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // PERFORMANCE COLLECTOR (REST endpoint handler)
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Receives client-side performance metrics from the injected monitor script.
     * Stores as time-series data in the page health record (aggregated) and
     * creates findings if thresholds are exceeded.
     * @param {Object} payload — { page_sys_id, page_name, metrics: {...} }
     * @returns {Object} result
     */
    receiveMetrics: function(payload) {
        try {
            if (!payload || !payload.page_sys_id) {
                return { ok: false, error: 'Missing page_sys_id in payload' };
            }

            var m = payload.metrics || {};
            var pageSysId = payload.page_sys_id;
            var now = new GlideDateTime();

            // Update page health record with latest perf data
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.query();
            var found = false;
            if (gr.next()) {
                found = true;
                var prevAvg = parseInt(gr.avg_load_ms.toString() || '0', 10);
                var newLoad = parseInt(m.load_ms || '0', 10);

                // Compute rolling average
                if (prevAvg > 0) {
                    gr.avg_load_ms = Math.round((prevAvg + newLoad) / 2);
                } else {
                    gr.avg_load_ms = newLoad;
                }
                gr.max_load_ms = Math.max(parseInt(gr.max_load_ms.toString() || '0', 10), newLoad);
                gr.long_task_count = parseInt(m.long_task_count || '0', 10);
                gr.memory_used_mb = parseInt(m.memory_mb || '0', 10);
                gr.perf_trend = this._determineTrend(prevAvg, newLoad);
                gr.update();
            }

            // Check thresholds and create findings if exceeded
            // Dedup: only create if no open finding of same type+severity for this page in last hour
            var findings = [];
            var oneHourAgo = new GlideDateTime();
            oneHourAgo.addSeconds(-3600);

            function _hasRecentOpenFinding(findingType, severity, title) {
                var grExist = new GlideRecord('x_snc_uibm_finding');
                grExist.addQuery('page_sys_id', pageSysId);
                grExist.addQuery('finding_type', findingType);
                grExist.addQuery('severity', severity);
                grExist.addQuery('status', 'open');
                grExist.addQuery('title', title);
                grExist.addQuery('detected_at', '>=', oneHourAgo);
                grExist.setLimit(1);
                grExist.query();
                return grExist.next();
            }

            if (m.load_ms && m.load_ms > this.PERF_THRESHOLDS.load_ms) {
                var loadTitle = 'Page load time exceeds threshold';
                if (!_hasRecentOpenFinding('performance', 'critical', loadTitle)) {
                    findings.push(this._createPerfFinding(
                        pageSysId,
                        payload.page_name || '',
                        'performance',
                        'critical',
                        loadTitle,
                        'Page "' + (payload.page_name || pageSysId) + '" load time is ' + m.load_ms +
                        'ms (threshold: ' + this.PERF_THRESHOLDS.load_ms + 'ms).',
                        'Investigate component render times. Use the Dependency Analyzer to identify heavy components. Consider enabling Safe Mode to isolate the culprit.',
                        'medium'
                    ));
                }
            }

            if (m.long_task_count && m.long_task_count > this.PERF_THRESHOLDS.long_tasks) {
                var taskTitle = 'Excessive long tasks blocking main thread';
                if (!_hasRecentOpenFinding('performance', 'warning', taskTitle)) {
                    findings.push(this._createPerfFinding(
                        pageSysId,
                        payload.page_name || '',
                        'performance',
                        'warning',
                        taskTitle,
                        'Page "' + (payload.page_name || pageSysId) + '" has ' + m.long_task_count +
                        ' long tasks (>50ms) blocking the main thread.',
                        'Reduce synchronous JavaScript execution. Move heavy operations to data resources or web workers. Check for excessive GlideRecord calls in client scripts.',
                        'high'
                    ));
                }
            }

            if (m.memory_mb && m.memory_mb > this.PERF_THRESHOLDS.memory_mb) {
                var memTitle = 'High memory usage detected';
                if (!_hasRecentOpenFinding('performance', 'warning', memTitle)) {
                    findings.push(this._createPerfFinding(
                        pageSysId,
                        payload.page_name || '',
                        'performance',
                        'warning',
                        memTitle,
                        'Page "' + (payload.page_name || pageSysId) + '" is using ' + m.memory_mb +
                        'MB of JS heap memory (threshold: ' + this.PERF_THRESHOLDS.memory_mb + 'MB).',
                        'Check for memory leaks — event listeners not cleaned up, large data cached in client state, or circular references preventing garbage collection.',
                        'medium'
                    ));
                }
            }

            return {
                ok: true,
                data: {
                    received: true,
                    findings_created: findings.length,
                    page_sys_id: pageSysId
                }
            };
        } catch (ex) {
            gs.logError('[UIBMCore.receiveMetrics] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // RECOMMENDATION ENGINE
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Generates actionable recommendations for a page based on its health data
     * and findings. Rule-based (no BYOK required).
     * @param {String} pageSysId
     * @returns {Object} recommendations array
     */
    getRecommendations: function(pageSysId) {
        try {
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.setLimit(1);
            gr.query();
            if (!gr.next()) {
                return { ok: false, error: 'No health data for page' };
            }

            var recommendations = [];
            var score = parseInt(gr.complexity_score.toString() || '0', 10);
            var compCount = parseInt(gr.component_count.toString() || '0', 10);
            var nestDepth = parseInt(gr.nesting_depth.toString() || '0', 10);
            var dsCount = parseInt(gr.data_source_count.toString() || '0', 10);
            var grCalls = parseInt(gr.gliderecord_calls.toString() || '0', 10);
            var extDeps = parseInt(gr.external_deps.toString() || '0', 10);
            var pageName = gr.page_name.toString();

            // R1: High component count
            if (compCount > 30) {
                recommendations.push({
                    title: pageName + ' has ' + compCount + ' components — consider splitting',
                    category: 'maintainability',
                    severity: compCount > 50 ? 'critical' : 'warning',
                    description: 'Pages with 30+ components are difficult to maintain and likely to cause performance issues. Each additional component adds render time and increases the probability of dependency conflicts.',
                    action: 'Split into sub-pages using the Page Router component. Group related components into reusable components with well-defined inputs/outputs.',
                    effort: 'high'
                });
            }

            // R2: Deep nesting
            if (nestDepth >= 5) {
                recommendations.push({
                    title: pageName + ' has max nesting depth of ' + nestDepth + ' — high risk',
                    category: 'maintainability',
                    severity: nestDepth >= 7 ? 'critical' : 'warning',
                    description: 'Deeply nested component hierarchies (depth ' + nestDepth + ') are the primary cause of render cascading — one parent re-render triggers all children to re-render, multiplying the performance impact.',
                    action: 'Flatten the component tree by extracting deeply nested children into siblings connected via client-state parameters instead of parent-child composition.',
                    effort: 'high'
                });
            }

            // R3: Excessive GlideRecord calls
            if (grCalls > 5) {
                recommendations.push({
                    title: 'Components on ' + pageName + ' make ~' + grCalls + ' GlideRecord calls on render',
                    category: 'performance',
                    severity: grCalls > 10 ? 'critical' : 'warning',
                    description: 'GlideRecord calls in client scripts are synchronous and block the main thread. ' + grCalls + ' estimated calls on render will cause noticeable lag on any page with moderate data volume.',
                    action: 'Move data fetching to data resources with lazy loading. Use GlideAjax for on-demand queries instead of pre-loading all data. Cache results in client-state parameters.',
                    effort: 'medium'
                });
            }

            // R4: High data source count
            if (dsCount > 10) {
                recommendations.push({
                    title: pageName + ' declares ' + dsCount + ' data sources — consolidation needed',
                    category: 'performance',
                    severity: 'warning',
                    description: 'Each data source triggers a separate server round-trip. ' + dsCount + ' data sources means ' + dsCount + ' parallel requests on page load, which can overwhelm the server and cause connection pooling issues.',
                    action: 'Consolidate related data sources into composite data resources. Use a single data resource that returns multiple record sets via a Script Include, then distribute via client-state parameters.',
                    effort: 'medium'
                });
            }

            // R5: External dependencies
            if (extDeps > 3) {
                recommendations.push({
                    title: pageName + ' references ' + extDeps + ' external scoped apps — upgrade risk',
                    category: 'upgrade_risk',
                    severity: 'warning',
                    description: 'Cross-scope references to ' + extDeps + ' external apps create upgrade risk. If any referenced app changes its API or is removed, this page will break silently.',
                    action: 'Document all cross-scope dependencies. Create a dependency manifest for the page. Consider wrapping external calls in a local adapter component to isolate changes.',
                    effort: 'low'
                });
            }

            // R6: Red category
            if (score >= 61) {
                recommendations.push({
                    title: pageName + ' has a critical complexity score of ' + score + '/100',
                    category: 'maintainability',
                    severity: 'critical',
                    description: 'This page is in the RED category (score ' + score + '). It is highly likely to cause performance issues, break during upgrades, and be difficult to maintain.',
                    action: 'Prioritize this page for immediate refactoring. Start with the highest-impact recommendations above. Use Safe Mode to diagnose if the page is currently frozen.',
                    effort: 'high'
                });
            }

            // R7: Performance degradation
            var avgLoad = parseInt(gr.avg_load_ms.toString() || '0', 10);
            if (avgLoad > this.PERF_THRESHOLDS.load_ms) {
                recommendations.push({
                    title: pageName + ' average load time is ' + avgLoad + 'ms (threshold: ' + this.PERF_THRESHOLDS.load_ms + 'ms)',
                    category: 'performance',
                    severity: 'critical',
                    description: 'Real-time performance monitoring shows this page consistently exceeds the load time threshold. Users are experiencing noticeable delays.',
                    action: 'Profile the page using the Performance Monitor. Identify the slowest components via render timing. Consider lazy-loading below-the-fold components.',
                    effort: 'medium'
                });
            }

            // Persist recommendations as findings (dedup: skip if open finding with same title+page exists)
            var scanRunId = gr.scan_run_id.toString();
            var existingOpenTitles = {};
            var grExist = new GlideRecord('x_snc_uibm_finding');
            grExist.addQuery('page_sys_id', pageSysId);
            grExist.addQuery('finding_type', 'recommendation');
            grExist.addQuery('status', 'open');
            grExist.query();
            while (grExist.next()) {
                existingOpenTitles[grExist.title.toString()] = true;
            }
            for (var i = 0; i < recommendations.length; i++) {
                if (existingOpenTitles[recommendations[i].title]) continue;
                this._createFindingRecord({
                    page_sys_id: pageSysId,
                    page_name: pageName,
                    finding_type: 'recommendation',
                    severity: recommendations[i].severity,
                    status: 'open',
                    title: recommendations[i].title,
                    description: recommendations[i].description,
                    action: recommendations[i].action,
                    category: recommendations[i].category,
                    effort: recommendations[i].effort,
                    scan_run_id: scanRunId
                });
            }

            return { ok: true, data: recommendations };
        } catch (ex) {
            gs.logError('[UIBMCore.getRecommendations] ' + ex.message);
            return { ok: false, error: ex.message };
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // PAGE HEALTH RECORD MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Upserts a page health record.
     * @param {String} pageSysId
     * @param {Object} data — field-value pairs
     * @returns {String} record sys_id
     */
    updatePageHealthRecord: function(pageSysId, data) {
        var gr = new GlideRecord('x_snc_uibm_page_health');
        gr.addQuery('page_sys_id', pageSysId);
        gr.query();

        if (gr.next()) {
            // Update existing
            for (var field in data) {
                if (data.hasOwnProperty(field) && gr.isValidField(field)) {
                    gr[field] = data[field];
                }
            }
            return gr.update();
        } else {
            // Insert new
            gr.initialize();
            gr.page_sys_id = pageSysId;
            for (var field2 in data) {
                if (data.hasOwnProperty(field2) && gr.isValidField(field2)) {
                    gr[field2] = data[field2];
                }
            }
            return gr.insert();
        }
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — COMPONENT TREE BUILDING
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Builds a hierarchical component tree from sys_ux_macroponent for a page.
     * @private
     */
    _buildComponentTree: function(pageSysId) {
        var tree = {
            page_sys_id: pageSysId,
            type: 'page_root',
            children: []
        };

        try {
            // Get root-level macroponents for this page
            var gr = new GlideRecord('sys_ux_macroponent');
            gr.addQuery('sys_ux_page', pageSysId);
            // Root components have no parent or parent is the page itself
            gr.addNullQuery('parent_macroponent');
            gr.query();

            while (gr.next()) {
                var node = this._buildComponentNode(gr);
                tree.children.push(node);
            }
        } catch (e) {
            // Fallback: try sys_ui_page_component if macroponent table not available
            gs.logWarning('[UIBMCore._buildComponentTree] sys_ux_macroponent query failed, trying fallback: ' + e.message);
            tree = this._buildComponentTreeFallback(pageSysId);
        }

        return tree;
    },

    /**
     * Recursively builds a component node with children.
     * @private
     */
    _buildComponentNode: function(grMacroponent) {
        var node = {
            sys_id: grMacroponent.getUniqueValue(),
            name: grMacroponent.name ? grMacroponent.name.toString() : 'unnamed',
            type: grMacroponent.component ? grMacroponent.component.toString() : 'unknown',
            render_priority: grMacroponent.render_priority ? grMacroponent.render_priority.toString() : '',
            children: []
        };

        try {
            // Find children
            var grChildren = new GlideRecord('sys_ux_macroponent');
            grChildren.addQuery('parent_macroponent', node.sys_id);
            grChildren.query();

            while (grChildren.next()) {
                node.children.push(this._buildComponentNode(grChildren));
            }
        } catch (e) {
            // Table structure may differ — continue with empty children
        }

        return node;
    },

    /**
     * Fallback component tree builder using sys_ui_page_component.
     * @private
     */
    _buildComponentTreeFallback: function(pageSysId) {
        var tree = {
            page_sys_id: pageSysId,
            type: 'page_root',
            children: []
        };

        try {
            var gr = new GlideRecord('sys_ui_page_component');
            gr.addQuery('page', pageSysId);
            gr.addNullQuery('parent');
            gr.query();

            while (gr.next()) {
                var node = {
                    sys_id: gr.getUniqueValue(),
                    name: gr.name ? gr.name.toString() : 'unnamed',
                    type: gr.component ? gr.component.toString() : 'unknown',
                    children: []
                };
                tree.children.push(node);
            }
        } catch (e) {
            gs.logWarning('[UIBMCore._buildComponentTreeFallback] Fallback also failed: ' + e.message);
        }

        return tree;
    },

    /**
     * Flattens the component tree into a flat array.
     * @private
     */
    _flattenComponentTree: function(tree) {
        var flat = [];
        function traverse(node) {
            if (node.children) {
                for (var i = 0; i < node.children.length; i++) {
                    flat.push(node.children[i]);
                    traverse(node.children[i]);
                }
            }
        }
        traverse(tree);
        return flat;
    },

    /**
     * Calculates maximum nesting depth of the component tree.
     * @private
     */
    _maxDepth: function(node) {
        if (!node.children || node.children.length === 0) return 0;
        var maxChild = 0;
        for (var i = 0; i < node.children.length; i++) {
            maxChild = Math.max(maxChild, this._maxDepth(node.children[i]));
        }
        return maxChild + 1;
    },

    /**
     * Counts data sources declared on a page.
     * @private
     */
    _countDataSources: function(pageSysId) {
        var count = 0;
        try {
            var gr = new GlideRecord('sys_data_source');
            gr.addQuery('sys_ux_page', pageSysId);
            gr.query();
            count = gr.getRowCount();
        } catch (e) {
            // Fallback: count from client data parameters
            try {
                var gr2 = new GlideRecord('sys_ux_client_data_parameter');
                gr2.addQuery('page', pageSysId);
                gr2.query();
                count = gr2.getRowCount();
            } catch (e2) {
                // Table may not exist — return 0
            }
        }
        return count;
    },

    /**
     * Estimates GlideRecord call count by static analysis of client script bodies.
     * Searches for patterns: GlideRecord, GlideAjax, getRecord(), getData()
     * @private
     */
    _estimateGlideRecordCalls: function(flatComponents) {
        var patterns = ['GlideRecord', 'GlideAjax', 'getRecord(', 'getData(', 'glideRecord'];
        var count = 0;

        for (var i = 0; i < flatComponents.length; i++) {
            var comp = flatComponents[i];
            // Check if component has client script
            try {
                var gr = new GlideRecord('sys_ux_macroponent');
                if (gr.get(comp.sys_id)) {
                    var scriptBody = '';
                    // Check common script fields
                    if (gr.isValidField('client_script')) {
                        scriptBody = gr.client_script ? gr.client_script.toString() : '';
                    }
                    if (gr.isValidField('script')) {
                        scriptBody += gr.script ? gr.script.toString() : '';
                    }
                    if (gr.isValidField('js_script')) {
                        scriptBody += gr.js_script ? gr.js_script.toString() : '';
                    }

                    for (var p = 0; p < patterns.length; p++) {
                        var idx = scriptBody.indexOf(patterns[p]);
                        while (idx !== -1) {
                            count++;
                            idx = scriptBody.indexOf(patterns[p], idx + 1);
                        }
                    }
                }
            } catch (e) {
                // Continue to next component
            }
        }

        return count;
    },

    /**
     * Counts external scope dependencies (references to components from other scoped apps).
     * @private
     */
    _countExternalDependencies: function(flatComponents) {
        var count = 0;
        var seenScopes = {};

        for (var i = 0; i < flatComponents.length; i++) {
            var comp = flatComponents[i];
            // Component type often encodes scope: x_<scope>_component_name
            var typeMatch = comp.type.match(/^x_([a-z]+)_/);
            if (typeMatch) {
                var scope = typeMatch[1];
                if (scope !== 'snc_uibm' && !seenScopes[scope]) {
                    seenScopes[scope] = true;
                    count++;
                }
            }
        }

        return count;
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — SCORING HELPERS
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @private
     */
    _componentScoreBreakdown: function(metrics) {
        return {
            component_count: Math.min(100, Math.round((metrics.component_count / 50) * 100)),
            nesting_depth: Math.min(100, Math.round((metrics.nesting_depth / 10) * 100)),
            data_source_count: Math.min(100, Math.round((metrics.data_source_count / 20) * 100)),
            gliderecord_calls: Math.min(100, Math.round((metrics.gliderecord_calls / 15) * 100)),
            external_deps: Math.min(100, Math.round((metrics.external_deps / 10) * 100))
        };
    },

    /**
     * @private
     */
    _scoreCategory: function(score) {
        if (score <= 30) return 'green';
        if (score <= 60) return 'yellow';
        return 'red';
    },

    /**
     * @private
     */
    _determineGate: function(score, findingCounts, threshold) {
        var s = parseInt(score, 10) || 0;
        var gateThreshold = threshold || this.CI_GATE_THRESHOLD;
        if (s >= gateThreshold) return 'FAIL';
        if (findingCounts && findingCounts.critical > 0) return 'FAIL';
        return 'PASS';
    },

    /**
     * @private
     */
    _determineTrend: function(prevAvg, newLoad) {
        if (prevAvg === 0 || newLoad === 0) return 'unknown';
        var delta = newLoad - prevAvg;
        var pctChange = (delta / prevAvg) * 100;
        if (pctChange < -10) return 'improving';
        if (pctChange > 10) return 'degrading';
        return 'stable';
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — DATA QUERIES
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @private
     */
    _getPageInfo: function(pageSysId) {
        try {
            var gr = new GlideRecord('sys_ux_page');
            if (gr.get(pageSysId)) {
                return {
                    sys_id: pageSysId,
                    name: gr.name ? gr.name.toString() : 'unnamed',
                    route: gr.route ? gr.route.toString() : ''
                };
            }
        } catch (e) {
            gs.logWarning('[UIBMCore._getPageInfo] sys_ux_page query failed: ' + e.message);
        }
        return null;
    },

    /**
     * @private
     */
    _getAllUIBuilderPages: function() {
        var pages = [];
        try {
            var gr = new GlideRecord('sys_ux_page');
            gr.addActiveQuery();
            gr.query();
            while (gr.next()) {
                pages.push({
                    sys_id: gr.getUniqueValue(),
                    name: gr.name ? gr.name.toString() : 'unnamed'
                });
            }
        } catch (e) {
            gs.logWarning('[UIBMCore._getAllUIBuilderPages] Failed to list pages: ' + e.message);
        }
        return pages;
    },

    /**
     * @private
     */
    _getFindingCounts: function(pageSysId) {
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
        } catch (e) {
            // Continue
        }
        return counts;
    },

    /**
     * @private
     */
    _getLatestPerfData: function(pageSysId) {
        try {
            var gr = new GlideRecord('x_snc_uibm_page_health');
            gr.addQuery('page_sys_id', pageSysId);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) {
                return {
                    avg_load_ms: parseInt(gr.avg_load_ms.toString() || '0', 10),
                    max_load_ms: parseInt(gr.max_load_ms.toString() || '0', 10),
                    long_task_count: parseInt(gr.long_task_count.toString() || '0', 10),
                    memory_used_mb: parseInt(gr.memory_used_mb.toString() || '0', 10),
                    trend: gr.perf_trend.toString() || 'unknown'
                };
            }
        } catch (e) {}
        return { avg_load_ms: 0, trend: 'unknown' };
    },

    // ═════════════════════════════════════════════════════════════════════
    // PRIVATE — FINDING CREATION
    // ═════════════════════════════════════════════════════════════════════

    /**
     * @private
     */
    _createPerfFinding: function(pageSysId, pageName, type, severity, title, description, action, effort) {
        return this._createFindingRecord({
            page_sys_id: pageSysId,
            page_name: pageName,
            finding_type: type,
            severity: severity,
            status: 'open',
            title: title,
            description: description,
            action: action,
            category: 'performance',
            effort: effort,
            scan_run_id: gs.generateGUID()
        });
    },

    /**
     * @private
     */
    _createFindingRecord: function(data) {
        try {
            var gr = new GlideRecord('x_snc_uibm_finding');
            gr.initialize();
            gr.page_sys_id = data.page_sys_id;
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
            if (data.affected_component_ids) gr.affected_component_ids = data.affected_component_ids;
            if (data.cycle_path) gr.cycle_path = data.cycle_path;
            if (data.detail_json) gr.detail_json = data.detail_json;
            var id = gr.insert();
            return id;
        } catch (e) {
            gs.logError('[UIBMCore._createFindingRecord] ' + e.message);
            return null;
        }
    },

    type: 'UIBMCore'
};