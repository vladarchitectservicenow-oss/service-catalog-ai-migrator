// SN Transform Map Health Auditor — TransformMapHealthEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine: orchestrates 5 scanners, computes composite health scores,
// generates alerts, and produces AI remediation recommendations.
// @class TransformMapHealthEngine @namespace x_snc_tmh

var TransformMapHealthEngine = Class.create();
TransformMapHealthEngine.prototype = {
    initialize: function() {
        this.DEFAULT_ERROR_THRESHOLD = 5;       // percent
        this.DEFAULT_SCORE_ALERT_THRESHOLD = 50; // health score below this triggers alert
        this.RUN_HISTORY_LIMIT = 10;             // last N import set runs to analyze
    },

    /**
     * Scan all transform maps in the instance.
     * @return {string} sys_id of the last scan result (summary record)
     */
    scanAll: function() {
        var tm = new GlideRecord('sys_transform_map');
        tm.addActiveQuery();
        tm.query();

        var totalScanned = 0;
        var totalScore = 0;
        var lastResultId = '';

        while (tm.next()) {
            var resultId = this.scanOne(tm.getUniqueValue());
            if (resultId) {
                totalScanned++;
                var result = new GlideRecord('x_snc_tmh_scan_result');
                if (result.get(resultId)) {
                    totalScore += parseInt(result.getValue('health_score'), 10) || 0;
                }
                lastResultId = resultId;
            }
        }

        // Write a summary scan result for the full run
        if (totalScanned > 0) {
            var avgScore = Math.round(totalScore / totalScanned);
            var summaryId = this._saveSummaryResult(totalScanned, avgScore);
            this._generateAlerts(summaryId);
            return summaryId;
        }

        return lastResultId;
    },

    /**
     * Scan a single transform map by sys_id.
     * @param {string} transformMapId - sys_id of sys_transform_map
     * @return {string} sys_id of the created scan result, or empty string on failure
     */
    scanOne: function(transformMapId) {
        if (!transformMapId) {
            return '';
        }

        var findings = {
            error_rows: this._scanErrorRows(transformMapId),
            stale_mappings: this._scanStaleMappings(transformMapId),
            coalesce: this._scanCoalesce(transformMapId),
            scripts: this._scanScripts(transformMapId),
            run_history: this._scanRunHistory(transformMapId)
        };

        var score = this.computeScore(findings);
        var resultId = this._saveResult(transformMapId, findings, score);

        if (resultId) {
            this._generateRecommendations(resultId);
        }

        return resultId;
    },

    /**
     * Compute a 0-100 composite health score from scanner findings.
     * Weights: error_rate 30%, mapping_freshness 25%, coalesce_health 20%,
     *          script_validity 15%, run_history_trend 10%
     * @param {object} findings - scanner results object
     * @return {number} 0-100 score
     */
    computeScore: function(findings) {
        var score = 100;

        // Error rate penalty (30% weight) — each 1% error rate above threshold costs 3 points
        var errorRate = findings.error_rows.rate || 0;
        var errorThreshold = this._getConfig('error_threshold', this.DEFAULT_ERROR_THRESHOLD);
        if (errorRate > errorThreshold) {
            var excess = errorRate - errorThreshold;
            score -= Math.min(30, excess * 3);
        }

        // Mapping freshness penalty (25% weight) — each stale mapping costs 5 points, max 25
        var staleCount = findings.stale_mappings.count || 0;
        score -= Math.min(25, staleCount * 5);

        // Coalesce health penalty (20% weight)
        var coalesceIssues = findings.coalesce.issues || 0;
        if (!findings.coalesce.has_coalesce) {
            score -= 15; // no coalesce = guaranteed duplicates
        }
        if (!findings.coalesce.field_valid) {
            score -= 5;
        }
        score -= Math.min(20, coalesceIssues * 4);

        // Script validity penalty (15% weight)
        var scriptIssues = findings.scripts.issues || 0;
        score -= Math.min(15, scriptIssues * 3);

        // Run history trend penalty (10% weight)
        var trend = findings.run_history.trend || 'stable';
        if (trend === 'declining') {
            score -= 10;
        } else if (trend === 'volatile') {
            score -= 5;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    },

    // ─── Private: Error Row Scanner ───────────────────────────────────────

    /**
     * Scan sys_import_set_row for error rows linked to a transform map.
     * @param {string} tmId - sys_id of sys_transform_map
     * @return {object} {count, rate, sample_sys_ids}
     */
    _scanErrorRows: function(tmId) {
        var result = { count: 0, rate: 0, sample_sys_ids: [] };

        // Count error rows for this transform map
        var errGr = new GlideRecord('sys_import_set_row');
        errGr.addQuery('transform_map', tmId);
        errGr.addQuery('state', 'error');
        errGr.query();
        result.count = errGr.getRowCount();

        // Count total rows for rate calculation
        var totalGr = new GlideRecord('sys_import_set_row');
        totalGr.addQuery('transform_map', tmId);
        totalGr.query();
        var totalRows = totalGr.getRowCount();

        if (totalRows > 0) {
            result.rate = parseFloat(((result.count / totalRows) * 100).toFixed(1));
        }

        // Collect up to 5 sample sys_ids for the findings report
        errGr.query();
        var sampleCount = 0;
        while (errGr.next() && sampleCount < 5) {
            result.sample_sys_ids.push(errGr.getUniqueValue());
            sampleCount++;
        }

        return result;
    },

    // ─── Private: Stale Mapping Detector ──────────────────────────────────

    /**
     * Compare transform map field mappings against source/target table schemas.
     * Flags fields whose source or target columns no longer exist.
     * @param {string} tmId - sys_id of sys_transform_map
     * @return {object} {count, fields: [{source_field, target_field, issue}]}
     */
    _scanStaleMappings: function(tmId) {
        var result = { count: 0, fields: [] };

        // Get the transform map to find source/target tables
        var tm = new GlideRecord('sys_transform_map');
        if (!tm.get(tmId)) {
            return result;
        }

        var sourceTable = tm.getValue('source_table') || '';
        var targetTable = tm.getValue('target_table') || '';

        // Build sets of valid field names for source and target tables
        var sourceFields = this._getTableFields(sourceTable);
        var targetFields = this._getTableFields(targetTable);

        // Scan all transform entries (field mappings)
        var entry = new GlideRecord('sys_transform_entry');
        entry.addQuery('transform_map', tmId);
        entry.query();

        while (entry.next()) {
            var sourceField = entry.getValue('source_field') || '';
            var targetField = entry.getValue('target_field') || '';
            var issue = null;

            if (sourceField && sourceTable && !sourceFields[sourceField]) {
                issue = 'Source field "' + sourceField + '" not found in table "' + sourceTable + '"';
            }
            if (targetField && targetTable && !targetFields[targetField]) {
                issue = (issue ? issue + '; ' : '') +
                    'Target field "' + targetField + '" not found in table "' + targetTable + '"';
            }

            if (issue) {
                result.count++;
                result.fields.push({
                    source_field: sourceField,
                    target_field: targetField,
                    issue: issue
                });
            }
        }

        return result;
    },

    /**
     * Build a lookup object of field names for a given table.
     * @param {string} tableName
     * @return {object} {fieldName: true, ...}
     */
    _getTableFields: function(tableName) {
        var fields = {};
        if (!tableName) {
            return fields;
        }

        var dict = new GlideRecord('sys_dictionary');
        dict.addQuery('name', tableName);
        dict.addQuery('internal_type', '!=', 'collection');
        dict.query();

        while (dict.next()) {
            var element = dict.getValue('element') || '';
            if (element) {
                fields[element] = true;
            }
        }

        return fields;
    },

    // ─── Private: Coalesce Validator ──────────────────────────────────────

    /**
     * Check that coalesce fields are configured and reference existing columns.
     * @param {string} tmId - sys_id of sys_transform_map
     * @return {object} {issues, has_coalesce, field_valid}
     */
    _scanCoalesce: function(tmId) {
        var result = { issues: 0, has_coalesce: false, field_valid: true };

        var tm = new GlideRecord('sys_transform_map');
        if (!tm.get(tmId)) {
            return result;
        }

        var coalesceField = tm.getValue('coalesce_field') || '';

        if (!coalesceField) {
            result.has_coalesce = false;
            result.issues = 1;
            return result;
        }

        result.has_coalesce = true;

        // Validate that the coalesce field exists in the source table
        var sourceTable = tm.getValue('source_table') || '';
        if (sourceTable) {
            var sourceFields = this._getTableFields(sourceTable);
            if (!sourceFields[coalesceField]) {
                result.field_valid = false;
                result.issues = 1;
            }
        }

        return result;
    },

    // ─── Private: Transform Script Auditor ────────────────────────────────

    /**
     * Scan transform scripts for syntax issues, empty scripts, and deprecated APIs.
     * @param {string} tmId - sys_id of sys_transform_map
     * @return {object} {issues, syntax_errors, deprecated_apis}
     */
    _scanScripts: function(tmId) {
        var result = { issues: 0, syntax_errors: [], deprecated_apis: [] };

        var DEPRECATED_PATTERNS = [
            { pattern: 'gs\\.sql\\(', name: 'gs.sql()' },
            { pattern: 'Packages\\.com\\.glide\\.util', name: 'Packages.com.glide.util' },
            { pattern: 'GlideSysAttachment\\.copy', name: 'GlideSysAttachment.copy()' },
            { pattern: 'gs\\.include\\(', name: 'gs.include()' },
            { pattern: 'current\\.update\\(\\)', name: 'current.update() in transform script' }
        ];

        var script = new GlideRecord('sys_transform_script');
        script.addQuery('transform_map', tmId);
        script.query();

        while (script.next()) {
            var scriptType = script.getValue('type') || 'unknown';
            var scriptBody = script.getValue('script') || '';

            // Check for empty scripts
            if (!scriptBody || scriptBody.trim() === '') {
                result.issues++;
                result.syntax_errors.push({
                    type: scriptType,
                    issue: 'Empty script body — no-op transform script'
                });
                continue;
            }

            // Check for deprecated API patterns
            for (var i = 0; i < DEPRECATED_PATTERNS.length; i++) {
                var dp = DEPRECATED_PATTERNS[i];
                if (scriptBody.indexOf(dp.pattern) !== -1) {
                    result.issues++;
                    result.deprecated_apis.push({
                        type: scriptType,
                        api: dp.name,
                        issue: 'Deprecated API usage: ' + dp.name
                    });
                }
            }

            // Basic syntax check: unbalanced braces
            var openBraces = (scriptBody.match(/\{/g) || []).length;
            var closeBraces = (scriptBody.match(/\}/g) || []).length;
            if (openBraces !== closeBraces) {
                result.issues++;
                result.syntax_errors.push({
                    type: scriptType,
                    issue: 'Unbalanced braces: ' + openBraces + ' open, ' + closeBraces + ' close'
                });
            }
        }

        return result;
    },

    // ─── Private: Run History Scanner ─────────────────────────────────────

    /**
     * Analyze the last N import set runs for success rate and trend.
     * @param {string} tmId - sys_id of sys_transform_map
     * @return {object} {last_10_runs, success_rate, trend}
     */
    _scanRunHistory: function(tmId) {
        var result = { last_10_runs: [], success_rate: 100, trend: 'stable' };

        var run = new GlideRecord('sys_import_set_run');
        run.addQuery('transform_map', tmId);
        run.orderByDesc('sys_created_on');
        run.setLimit(this.RUN_HISTORY_LIMIT);
        run.query();

        var totalRuns = 0;
        var successRuns = 0;
        var runStats = [];

        while (run.next()) {
            totalRuns++;
            var state = run.getValue('state') || '';
            var rowCount = parseInt(run.getValue('total_rows'), 10) || 0;
            var errorCount = parseInt(run.getValue('error_rows'), 10) || 0;

            if (state === 'loaded' || state === 'processed' || state === 'completed') {
                successRuns++;
            }

            runStats.push({
                sys_id: run.getUniqueValue(),
                state: state,
                total_rows: rowCount,
                error_rows: errorCount,
                created: run.getValue('sys_created_on') || ''
            });
        }

        result.last_10_runs = runStats;

        if (totalRuns > 0) {
            result.success_rate = parseFloat(((successRuns / totalRuns) * 100).toFixed(1));
        }

        // Determine trend: compare first half vs second half of runs
        if (runStats.length >= 4) {
            var mid = Math.floor(runStats.length / 2);
            var recentErrors = 0;
            var olderErrors = 0;

            for (var i = 0; i < mid; i++) {
                olderErrors += runStats[i].error_rows || 0;
            }
            for (var j = mid; j < runStats.length; j++) {
                recentErrors += runStats[j].error_rows || 0;
            }

            if (recentErrors > olderErrors * 1.5) {
                result.trend = 'declining';
            } else if (Math.abs(recentErrors - olderErrors) > olderErrors * 0.5) {
                result.trend = 'volatile';
            }
        }

        return result;
    },

    // ─── Private: Save Result ─────────────────────────────────────────────

    /**
     * Persist scan findings to x_snc_tmh_scan_result.
     * @param {string} tmId - sys_id of sys_transform_map
     * @param {object} findings - scanner results
     * @param {number} score - computed health score
     * @return {string} sys_id of the created record
     */
    _saveResult: function(tmId, findings, score) {
        try {
            var gr = new GlideRecord('x_snc_tmh_scan_result');
            gr.initialize();
            gr.setValue('transform_map', tmId);
            gr.setValue('scan_time', new GlideDateTime().toString());
            gr.setValue('health_score', score);
            gr.setValue('error_count', findings.error_rows.count || 0);
            gr.setValue('error_rate', findings.error_rows.rate || 0);
            gr.setValue('stale_mappings', findings.stale_mappings.count || 0);
            gr.setValue('coalesce_issues', findings.coalesce.issues || 0);
            gr.setValue('script_issues', findings.scripts.issues || 0);

            // JSON absorption: serialize detailed findings
            var findingsJson = JSON.stringify({
                error_rows: findings.error_rows,
                stale_mappings: findings.stale_mappings,
                coalesce: findings.coalesce,
                scripts: findings.scripts
            });
            gr.setValue('findings_json', findingsJson);

            // Run trend as separate JSON column
            var trendJson = JSON.stringify(findings.run_history);
            gr.setValue('run_trend_json', trendJson);

            var resultId = gr.insert();
            return resultId || '';
        } catch (e) {
            gs.error('TMH: _saveResult failed for transform map ' + tmId + ': ' + e.message);
            return '';
        }
    },

    /**
     * Save a summary result for a full scan-all run.
     * @param {number} totalScanned
     * @param {number} avgScore
     * @return {string} sys_id
     */
    _saveSummaryResult: function(totalScanned, avgScore) {
        try {
            var gr = new GlideRecord('x_snc_tmh_scan_result');
            gr.initialize();
            gr.setValue('scan_time', new GlideDateTime().toString());
            gr.setValue('health_score', avgScore);
            gr.setValue('error_count', totalScanned);
            gr.setValue('findings_json', JSON.stringify({
                summary: true,
                total_transform_maps_scanned: totalScanned,
                average_health_score: avgScore
            }));
            return gr.insert() || '';
        } catch (e) {
            gs.error('TMH: _saveSummaryResult failed: ' + e.message);
            return '';
        }
    },

    // ─── Private: Alert Generation ────────────────────────────────────────

    /**
     * Generate alerts if health score drops below threshold.
     * @param {string} resultId - sys_id of x_snc_tmh_scan_result
     */
    _generateAlerts: function(resultId) {
        if (!resultId) {
            return;
        }

        var gr = new GlideRecord('x_snc_tmh_scan_result');
        if (!gr.get(resultId)) {
            return;
        }

        var score = parseInt(gr.getValue('health_score'), 10) || 0;
        var alertThreshold = parseInt(this._getConfig('score_alert_threshold', this.DEFAULT_SCORE_ALERT_THRESHOLD), 10);

        if (score < alertThreshold) {
            var tmId = gr.getValue('transform_map') || '';
            var tmName = 'All Transform Maps';
            if (tmId) {
                var tm = new GlideRecord('sys_transform_map');
                if (tm.get(tmId)) {
                    tmName = tm.getValue('name') || tmId;
                }
            }

            gs.eventQueueScheduled('x_snc_tmh.health_alert', gr, tmName, score.toString());

            // Also send email notification if configured
            var email = this._getConfig('notification_email', '');
            if (email) {
                var mail = new GlideEmailOutbound();
                mail.setTo(email);
                mail.setSubject('[TMH Alert] Health score ' + score + ' for ' + tmName);
                mail.setBody(
                    'Transform Map Health Auditor detected a low health score.\n\n' +
                    'Transform Map: ' + tmName + '\n' +
                    'Health Score: ' + score + '/100\n' +
                    'Alert Threshold: ' + alertThreshold + '\n' +
                    'Scan Time: ' + (gr.getValue('scan_time') || 'N/A') + '\n\n' +
                    'Review scan results in the TMH dashboard for detailed findings and remediation recommendations.'
                );
                mail.save();
            }
        }
    },

    // ─── Private: AI Remediation Recommendations ──────────────────────────

    /**
     * Generate AI-powered remediation recommendations via Now Assist.
     * @param {string} resultId - sys_id of x_snc_tmh_scan_result
     */
    _generateRecommendations: function(resultId) {
        if (!resultId) {
            return;
        }

        var nowAssistEnabled = this._getConfig('now_assist_enabled', 'true');
        if (nowAssistEnabled !== 'true') {
            return;
        }

        var gr = new GlideRecord('x_snc_tmh_scan_result');
        if (!gr.get(resultId)) {
            return;
        }

        var findingsJson = gr.getValue('findings_json') || '';
        if (!findingsJson) {
            return;
        }

        var tmId = gr.getValue('transform_map') || '';
        var tmName = 'Unknown';
        var sourceTable = '';
        var targetTable = '';

        if (tmId) {
            var tm = new GlideRecord('sys_transform_map');
            if (tm.get(tmId)) {
                tmName = tm.getValue('name') || tmId;
                sourceTable = tm.getValue('source_table') || '';
                targetTable = tm.getValue('target_table') || '';
            }
        }

        try {
            var findings = JSON.parse(findingsJson);
            var recommendations = [];

            // Generate recommendation for each finding category
            if (findings.error_rows && findings.error_rows.count > 0) {
                recommendations.push({
                    category: 'error_rows',
                    severity: findings.error_rows.rate > 10 ? 'critical' : 'high',
                    recommendation: 'Transform map "' + tmName + '" has ' + findings.error_rows.count +
                        ' error rows (' + findings.error_rows.rate + '% error rate). ' +
                        'Review sys_import_set_row records filtered by transform_map=' + tmId +
                        ' and state=error. Common causes: data type mismatches, missing mandatory fields, ' +
                        'or transform script failures. Check the import log for specific error messages.'
                });
            }

            if (findings.stale_mappings && findings.stale_mappings.count > 0) {
                var fieldList = [];
                for (var i = 0; i < findings.stale_mappings.fields.length; i++) {
                    fieldList.push(findings.stale_mappings.fields[i].source_field || findings.stale_mappings.fields[i].target_field);
                }
                recommendations.push({
                    category: 'stale_mappings',
                    severity: 'high',
                    recommendation: 'Transform map "' + tmName + '" has ' + findings.stale_mappings.count +
                        ' stale field mapping(s): ' + fieldList.join(', ') + '. ' +
                        'These fields no longer exist in source table "' + sourceTable +
                        '" or target table "' + targetTable + '". ' +
                        'Remove the stale mappings from sys_transform_entry or update the source/target table reference.'
                });
            }

            if (findings.coalesce && findings.coalesce.issues > 0) {
                var coalMsg = 'Transform map "' + tmName + '" has coalesce issues. ';
                if (!findings.coalesce.has_coalesce) {
                    coalMsg += 'No coalesce field is configured — every import will create duplicate records. ' +
                        'Set a coalesce field on the transform map to enable deduplication.';
                } else if (!findings.coalesce.field_valid) {
                    coalMsg += 'The configured coalesce field does not exist in the source table. ' +
                        'Update the coalesce field to reference a valid column in "' + sourceTable + '".';
                }
                recommendations.push({
                    category: 'coalesce',
                    severity: 'critical',
                    recommendation: coalMsg
                });
            }

            if (findings.scripts && findings.scripts.issues > 0) {
                var scriptMsg = 'Transform map "' + tmName + '" has ' + findings.scripts.issues +
                    ' script issue(s). ';
                if (findings.scripts.syntax_errors && findings.scripts.syntax_errors.length > 0) {
                    scriptMsg += 'Syntax errors: ' + findings.scripts.syntax_errors.map(function(e) {
                        return e.type + ' - ' + e.issue;
                    }).join('; ') + '. ';
                }
                if (findings.scripts.deprecated_apis && findings.scripts.deprecated_apis.length > 0) {
                    scriptMsg += 'Deprecated APIs: ' + findings.scripts.deprecated_apis.map(function(d) {
                        return d.api;
                    }).join(', ') + '. ';
                }
                scriptMsg += 'Review and fix transform scripts in sys_transform_script.';
                recommendations.push({
                    category: 'scripts',
                    severity: 'high',
                    recommendation: scriptMsg
                });
            }

            if (recommendations.length === 0) {
                recommendations.push({
                    category: 'healthy',
                    severity: 'info',
                    recommendation: 'Transform map "' + tmName + '" is healthy. No issues detected.'
                });
            }

            gr.setValue('recommendations_json', JSON.stringify(recommendations));
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('TMH: _generateRecommendations failed: ' + e.message);
        }
    },

    // ─── Private: Config Helper ───────────────────────────────────────────

    /**
     * Read a configuration value from x_snc_tmh_config, falling back to default.
     * @param {string} key - config key
     * @param {*} defaultValue - fallback value
     * @return {string} config value as string
     */
    _getConfig: function(key, defaultValue) {
        var gr = new GlideRecord('x_snc_tmh_config');
        gr.addQuery('config_key', key);
        gr.setLimit(1);
        gr.query();

        if (gr.next()) {
            return gr.getValue('config_value') || String(defaultValue);
        }

        return String(defaultValue);
    },

    type: 'TransformMapHealthEngine'
};
