// TestReach — ATF Coverage Analyzer & Test Gap Detector
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// TestReachRiskEngine — Risk scoring, upgrade gap analysis, test skeleton generation,
// CI/CD gate checks, and dashboard data aggregation.
// @class TestReachRiskEngine @namespace x_snc_testreach

var TestReachRiskEngine = Class.create();
TestReachRiskEngine.prototype = {

    /**
     * Computes composite risk score from coverage data + criticality weights.
     *
     * @param {string} appScope - Scope prefix (e.g., "x_hr_core")
     * @param {string} upgradeTarget - Target release (e.g., "xanadu")
     * @returns {object} {risk_score: 0-100, details: {untested_count, low_coverage_count, total_artifacts, coverage_pct, top_risks: [], recommendation: ""}}
     */
    computeRiskScore: function(appScope, upgradeTarget) {
        var snapGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
        snapGr.addQuery('app_scope', appScope);
        snapGr.addQuery('snapshot_type', 'coverage');
        snapGr.query();

        var untestedCount = 0;
        var lowCoverageCount = 0;
        var totalArtifacts = 0;
        var totalCriticality = 0;
        var topRisks = [];

        while (snapGr.next()) {
            totalArtifacts++;
            var coveragePct = parseFloat(snapGr.getValue('coverage_pct') || 0);
            var criticality = parseInt(snapGr.getValue('criticality') || 1, 10);
            totalCriticality += criticality;

            if (coveragePct === 0) {
                untestedCount++;
                topRisks.push({
                    name: snapGr.getValue('artifact_name') || '',
                    type: snapGr.getValue('artifact_type') || '',
                    criticality: criticality
                });
            } else if (coveragePct < 50) {
                lowCoverageCount++;
            }
        }

        // Sort top risks by criticality descending, take top 10
        topRisks.sort(function(a, b) { return b.criticality - a.criticality; });
        topRisks = topRisks.slice(0, 10);

        var criticalityAvg = totalArtifacts > 0 ? (totalCriticality / totalArtifacts) : 1;
        var riskScore = Math.min(100, Math.round((untestedCount * criticalityAvg * 10) + (lowCoverageCount * 5)));

        var testedCount = totalArtifacts - untestedCount;
        var coveragePctAgg = totalArtifacts > 0 ? parseFloat(((testedCount / totalArtifacts) * 100).toFixed(2)) : 0;

        var details = {
            untested_count: untestedCount,
            low_coverage_count: lowCoverageCount,
            total_artifacts: totalArtifacts,
            coverage_pct: coveragePctAgg,
            top_risks: topRisks,
            recommendation: this._generateRecommendation(riskScore, untestedCount, appScope)
        };

        // Persist risk score
        var riskGr = new GlideRecord('x_snc_testreach_risk_score');
        riskGr.addQuery('app_scope', appScope);
        riskGr.addQuery('upgrade_target', upgradeTarget);
        riskGr.query();
        if (riskGr.next()) {
            riskGr.setValue('risk_score', riskScore);
            riskGr.setValue('untested_count', untestedCount);
            riskGr.setValue('low_coverage_count', lowCoverageCount);
            riskGr.setValue('total_artifacts', totalArtifacts);
            riskGr.setValue('coverage_pct', coveragePctAgg);
            riskGr.setValue('details_json', JSON.stringify(details));
            riskGr.setValue('computed_ts', new GlideDateTime().getValue());
            riskGr.setValue('threshold_pass', riskScore <= 50);
            try {
                riskGr.update();
            } catch (e) {
                gs.error('TestReachRiskEngine.computeRiskScore: update failed: ' + e.message);
            }
        } else {
            riskGr.initialize();
            riskGr.setValue('app_scope', appScope);
            riskGr.setValue('app_name', this._getAppName(appScope));
            riskGr.setValue('upgrade_target', upgradeTarget);
            riskGr.setValue('risk_score', riskScore);
            riskGr.setValue('untested_count', untestedCount);
            riskGr.setValue('low_coverage_count', lowCoverageCount);
            riskGr.setValue('total_artifacts', totalArtifacts);
            riskGr.setValue('coverage_pct', coveragePctAgg);
            riskGr.setValue('details_json', JSON.stringify(details));
            riskGr.setValue('computed_ts', new GlideDateTime().getValue());
            riskGr.setValue('threshold_pass', riskScore <= 50);
            try {
                riskGr.insert();
            } catch (e) {
                gs.error('TestReachRiskEngine.computeRiskScore: insert failed: ' + e.message);
            }
        }

        return {
            risk_score: riskScore,
            details: details
        };
    },

    /**
     * Cross-references Upgrade Preview skipped records with coverage data.
     *
     * @param {string} upgradeTarget - Target release (e.g., "xanadu")
     * @returns {array} [{artifact_name, artifact_type, app_scope, risk_level, skipped, coverage_pct}]
     */
    generateUpgradeGapReport: function(upgradeTarget) {
        var gaps = [];

        // Query upgrade history log for skipped records
        var upgradeGr = new GlideRecord('sys_upgrade_history_log');
        upgradeGr.addQuery('state', 'skipped');
        upgradeGr.orderByDesc('sys_created_on');
        upgradeGr.setLimit(500);
        upgradeGr.query();

        while (upgradeGr.next()) {
            var recordType = upgradeGr.getValue('record_type') || '';
            var recordSysId = upgradeGr.getValue('record_sys_id') || '';

            // Check if this skipped record has coverage data
            var snapGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
            snapGr.addQuery('artifact_sys_id', recordSysId);
            snapGr.addQuery('snapshot_type', 'coverage');
            snapGr.query();

            if (snapGr.next()) {
                var coveragePct = parseFloat(snapGr.getValue('coverage_pct') || 0);
                var riskLevel = 'low';
                if (coveragePct === 0) {
                    riskLevel = 'critical';
                } else if (coveragePct < 50) {
                    riskLevel = 'high';
                } else if (coveragePct < 100) {
                    riskLevel = 'medium';
                }

                gaps.push({
                    artifact_name: snapGr.getValue('artifact_name') || recordType,
                    artifact_type: snapGr.getValue('artifact_type') || recordType,
                    app_scope: snapGr.getValue('app_scope') || '',
                    risk_level: riskLevel,
                    skipped: true,
                    coverage_pct: coveragePct,
                    record_type: recordType,
                    record_sys_id: recordSysId
                });
            } else {
                // Skipped record not in our coverage data — unknown risk
                gaps.push({
                    artifact_name: recordType,
                    artifact_type: recordType,
                    app_scope: '',
                    risk_level: 'unknown',
                    skipped: true,
                    coverage_pct: -1,
                    record_type: recordType,
                    record_sys_id: recordSysId
                });
            }
        }

        return gaps;
    },

    /**
     * Creates stub ATF test records for an untested artifact.
     * Uses GenAI Controller for step descriptions when available.
     *
     * @param {string} artifactSysId - Sys ID of the artifact
     * @param {string} artifactType - Type: business_rule, script_include, etc.
     * @returns {object} {test_sys_id: "", steps: [{order, description, config}]}
     */
    generateTestSkeleton: function(artifactSysId, artifactType) {
        var steps = [];
        var testSysId = '';

        // Get artifact details
        var artifactName = '';
        var artifactTable = '';
        var artifactScript = '';

        if (artifactType === 'business_rule') {
            var brGr = new GlideRecord('sys_script');
            if (brGr.get(artifactSysId)) {
                artifactName = brGr.getValue('name') || '';
                artifactTable = brGr.getValue('collection') || '';
                artifactScript = brGr.getValue('script') || '';
            }
        } else if (artifactType === 'script_include') {
            var siGr = new GlideRecord('sys_script_include');
            if (siGr.get(artifactSysId)) {
                artifactName = siGr.getValue('name') || '';
                artifactScript = siGr.getValue('script') || '';
            }
        }

        // Generate step descriptions using GenAI Controller if available
        var stepDescriptions = this._generateStepDescriptions(artifactName, artifactType, artifactScript);

        // Create the ATF test record
        var testGr = new GlideRecord('sys_atf_test');
        testGr.initialize();
        testGr.setValue('name', '[TestReach] Test stub for: ' + artifactName);
        testGr.setValue('description', 'Auto-generated test skeleton for ' + artifactType + ' "' + artifactName + '". Review and customize before use.');
        testGr.setValue('sys_scope', 'x_snc_testreach');
        testGr.setValue('active', true);
        try {
            testSysId = testGr.insert();
        } catch (e) {
            gs.error('TestReachRiskEngine.generateTestSkeleton: test insert failed: ' + e.message);
            return { test_sys_id: '', steps: [] };
        }

        // Create ATF step records
        for (var i = 0; i < stepDescriptions.length; i++) {
            var stepGr = new GlideRecord('sys_atf_step');
            stepGr.initialize();
            stepGr.setValue('test', testSysId);
            stepGr.setValue('name', stepDescriptions[i].name);
            stepGr.setValue('description', stepDescriptions[i].description);
            stepGr.setValue('order', i + 1);
            stepGr.setValue('active', true);
            stepGr.setValue('sys_scope', 'x_snc_testreach');

            var configXml = this._buildStepConfig(artifactType, artifactTable, stepDescriptions[i]);
            stepGr.setValue('config', configXml);

            try {
                var stepSysId = stepGr.insert();
                steps.push({
                    order: i + 1,
                    description: stepDescriptions[i].description,
                    config: configXml,
                    step_sys_id: stepSysId
                });
            } catch (e) {
                gs.error('TestReachRiskEngine.generateTestSkeleton: step insert failed: ' + e.message);
            }
        }

        // Update the coverage snapshot with skeleton info
        var snapGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
        snapGr.addQuery('artifact_sys_id', artifactSysId);
        snapGr.addQuery('snapshot_type', 'coverage');
        snapGr.query();
        if (snapGr.next()) {
            var skeletonJson = {
                generated: true,
                test_sys_id: testSysId,
                steps: steps,
                ai_generated: stepDescriptions.length > 0
            };
            snapGr.setValue('skeleton_json', JSON.stringify(skeletonJson));
            try {
                snapGr.update();
            } catch (e) {
                gs.error('TestReachRiskEngine.generateTestSkeleton: snapshot update failed: ' + e.message);
            }
        }

        return {
            test_sys_id: testSysId,
            steps: steps
        };
    },

    /**
     * CI/CD gate check. Returns pass/fail against configured threshold.
     *
     * @param {string} appScope - Scope prefix
     * @param {number} threshold - Risk score threshold (0-100, default 60)
     * @returns {object} {pass: boolean, coverage_pct: number, risk_score: number, untested_count: number, threshold: number, recommendation: string}
     */
    checkCIThreshold: function(appScope, threshold) {
        threshold = threshold || 60;

        var riskGr = new GlideRecord('x_snc_testreach_risk_score');
        riskGr.addQuery('app_scope', appScope);
        riskGr.orderByDesc('computed_ts');
        riskGr.setLimit(1);
        riskGr.query();

        if (riskGr.next()) {
            var riskScore = parseInt(riskGr.getValue('risk_score') || 0, 10);
            var coveragePct = parseFloat(riskGr.getValue('coverage_pct') || 0);
            var untestedCount = parseInt(riskGr.getValue('untested_count') || 0, 10);
            var pass = riskScore <= threshold;

            return {
                pass: pass,
                coverage_pct: coveragePct,
                risk_score: riskScore,
                untested_count: untestedCount,
                threshold: threshold,
                recommendation: pass
                    ? 'Coverage gate passed. Risk score ' + riskScore + ' is within threshold ' + threshold + '.'
                    : 'Coverage gate FAILED. Risk score ' + riskScore + ' exceeds threshold ' + threshold + '. Generate test skeletons for ' + untestedCount + ' untested artifacts.'
            };
        }

        // No risk score computed yet — run analysis first
        return {
            pass: false,
            coverage_pct: 0,
            risk_score: 100,
            untested_count: 0,
            threshold: threshold,
            recommendation: 'No risk score available. Run coverage analysis first via POST /execute with action=analyze.'
        };
    },

    /**
     * Aggregated dashboard payload for UI Builder.
     *
     * @param {string} appScope - Scope prefix
     * @returns {object} {heatmap: [], risk: {}, trend: [], gaps: [], summary: {app_scope, app_name, coverage_pct, total_artifacts, untested_count, low_coverage_count}}
     */
    getDashboardData: function(appScope) {
        // Heatmap data
        var heatmap = [];
        var snapGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
        snapGr.addQuery('app_scope', appScope);
        snapGr.addQuery('snapshot_type', 'coverage');
        snapGr.orderBy('coverage_pct');
        snapGr.query();
        while (snapGr.next()) {
            heatmap.push({
                artifact_name: snapGr.getValue('artifact_name') || '',
                artifact_type: snapGr.getValue('artifact_type') || '',
                artifact_table: snapGr.getValue('artifact_table') || '',
                coverage_pct: parseFloat(snapGr.getValue('coverage_pct') || 0),
                tested_by_count: parseInt(snapGr.getValue('tested_by_count') || 0, 10),
                criticality: parseInt(snapGr.getValue('criticality') || 1, 10)
            });
        }

        // Risk score
        var risk = {};
        var riskGr = new GlideRecord('x_snc_testreach_risk_score');
        riskGr.addQuery('app_scope', appScope);
        riskGr.orderByDesc('computed_ts');
        riskGr.setLimit(1);
        riskGr.query();
        if (riskGr.next()) {
            risk = {
                risk_score: parseInt(riskGr.getValue('risk_score') || 0, 10),
                coverage_pct: parseFloat(riskGr.getValue('coverage_pct') || 0),
                untested_count: parseInt(riskGr.getValue('untested_count') || 0, 10),
                total_artifacts: parseInt(riskGr.getValue('total_artifacts') || 0, 10),
                threshold_pass: riskGr.getValue('threshold_pass') === 'true' || riskGr.getValue('threshold_pass') === true
            };
        }

        // Trend data
        var trend = [];
        var trendGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
        trendGr.addQuery('app_scope', appScope);
        trendGr.addQuery('snapshot_type', 'trend');
        trendGr.orderByDesc('snapshot_ts');
        trendGr.setLimit(12);
        trendGr.query();
        while (trendGr.next()) {
            var trendJson = trendGr.getValue('trend_json') || '{}';
            try {
                var parsed = JSON.parse(trendJson);
                if (parsed.weekly_snapshots) {
                    for (var i = 0; i < parsed.weekly_snapshots.length; i++) {
                        trend.push(parsed.weekly_snapshots[i]);
                    }
                }
            } catch (e) {
                // skip malformed JSON
            }
        }

        // Gap data (zero-coverage artifacts)
        var gaps = [];
        var gapGr = new GlideRecord('x_snc_testreach_coverage_snapshot');
        gapGr.addQuery('app_scope', appScope);
        gapGr.addQuery('snapshot_type', 'gap');
        gapGr.orderByDesc('criticality');
        gapGr.setLimit(20);
        gapGr.query();
        while (gapGr.next()) {
            gaps.push({
                artifact_name: gapGr.getValue('artifact_name') || '',
                artifact_type: gapGr.getValue('artifact_type') || '',
                criticality: parseInt(gapGr.getValue('criticality') || 1, 10)
            });
        }

        // Summary aggregation for callers (GET /status, Service Portal widget)
        // (computed inline in the return below)

        return {
            heatmap: heatmap,
            risk: risk,
            trend: trend,
            gaps: gaps,
            summary: {
                app_scope: appScope,
                app_name: this._getAppName(appScope),
                coverage_pct: risk.coverage_pct || 0,
                total_artifacts: risk.total_artifacts || 0,
                untested_count: risk.untested_count || 0,
                tested_count: (risk.total_artifacts || 0) - (risk.untested_count || 0),
                low_coverage_count: 0
            }
        };
    },

    /**
     * Generates human-readable step descriptions for test skeleton.
     * Uses GenAI Controller when available; falls back to template-based descriptions.
     *
     * @param {string} artifactName - Name of the artifact
     * @param {string} artifactType - Type of artifact
     * @param {string} artifactScript - Script content of the artifact
     * @returns {array} [{name: "", description: ""}]
     * @private
     */
    _generateStepDescriptions: function(artifactName, artifactType, artifactScript) {
        var steps = [];

        // Attempt GenAI Controller integration
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenerativeAI) {
                var genAI = new sn_generative_ai.GenerativeAI();
                var prompt = 'Generate 3-5 ATF test step descriptions for testing a ServiceNow ' + artifactType +
                    ' named "' + artifactName + '". The artifact script is:\n\n' + (artifactScript || '(no script available)') +
                    '\n\nReturn each step as: Step N: [name] — [description]. Keep descriptions under 200 characters each.';
                var response = genAI.generate(prompt);
                if (response && response.length > 0) {
                    var lines = response.split('\n');
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (line.indexOf('Step') === 0) {
                            var parts = line.split(' — ');
                            var name = parts[0].replace(/^Step \d+: /, '').trim();
                            var desc = parts.length > 1 ? parts[1].trim() : name;
                            steps.push({ name: name, description: desc });
                        }
                    }
                }
            }
        } catch (e) {
            gs.warn('TestReachRiskEngine._generateStepDescriptions: GenAI unavailable, using templates: ' + e.message);
        }

        // Fallback: template-based descriptions
        if (steps.length === 0) {
            if (artifactType === 'business_rule') {
                steps.push({ name: 'Open form and trigger BR', description: 'Open the form on the target table and perform the action that triggers the business rule "' + artifactName + '".' });
                steps.push({ name: 'Verify record update', description: 'Verify that the record was created/updated as expected by the business rule logic.' });
                steps.push({ name: 'Verify field values', description: 'Check that all fields modified by the business rule have the expected values.' });
            } else if (artifactType === 'script_include') {
                steps.push({ name: 'Call Script Include method', description: 'Execute the primary method of Script Include "' + artifactName + '" with valid input parameters.' });
                steps.push({ name: 'Verify return value', description: 'Assert that the return value matches the expected output format and content.' });
                steps.push({ name: 'Test error handling', description: 'Call the method with invalid/null parameters and verify graceful error handling.' });
            } else if (artifactType === 'client_script') {
                steps.push({ name: 'Load form with client script', description: 'Open the form where the client script "' + artifactName + '" is configured to run.' });
                steps.push({ name: 'Trigger client script event', description: 'Perform the UI action (onLoad/onChange/onSubmit) that triggers the client script.' });
                steps.push({ name: 'Verify UI behavior', description: 'Confirm the expected UI behavior (field visibility, value changes, messages).' });
            } else if (artifactType === 'flow') {
                steps.push({ name: 'Trigger flow', description: 'Perform the action or create the record that triggers the flow "' + artifactName + '".' });
                steps.push({ name: 'Verify flow execution', description: 'Check that the flow executed successfully and all steps completed.' });
                steps.push({ name: 'Verify output', description: 'Confirm the flow\'s output records, approvals, or notifications were created correctly.' });
            } else {
                steps.push({ name: 'Execute artifact', description: 'Trigger or execute the ' + artifactType + ' "' + artifactName + '".' });
                steps.push({ name: 'Verify result', description: 'Confirm the expected outcome of the ' + artifactType + ' execution.' });
                steps.push({ name: 'Check edge case', description: 'Test with boundary or edge-case inputs to verify robustness.' });
            }
        }

        return steps;
    },

    /**
     * Builds ATF step config XML for the given artifact type.
     *
     * @param {string} artifactType - Type of artifact
     * @param {string} artifactTable - Table name (for form-based steps)
     * @param {object} stepDesc - {name, description}
     * @returns {string} XML config string
     * @private
     */
    _buildStepConfig: function(artifactType, artifactTable, stepDesc) {
        var config = '<config>';
        config += '<step_type>form</step_type>';
        if (artifactTable) {
            config += '<table>' + artifactTable + '</table>';
        }
        config += '<description>' + this._escapeXml(stepDesc.description) + '</description>';
        config += '<field_values></field_values>';
        config += '</config>';
        return config;
    },

    /**
     * Generates a human-readable recommendation based on risk score.
     *
     * @param {number} riskScore - 0-100 risk score
     * @param {number} untestedCount - Number of untested artifacts
     * @param {string} appScope - Scope prefix
     * @returns {string} Recommendation text
     * @private
     */
    _generateRecommendation: function(riskScore, untestedCount, appScope) {
        if (riskScore >= 80) {
            return 'CRITICAL: ' + untestedCount + ' untested artifacts in ' + appScope + '. Generate test skeletons immediately and add coverage before next upgrade. Risk score ' + riskScore + '/100.';
        } else if (riskScore >= 50) {
            return 'HIGH: ' + untestedCount + ' untested artifacts in ' + appScope + '. Prioritize test creation for high-criticality artifacts. Risk score ' + riskScore + '/100.';
        } else if (riskScore >= 30) {
            return 'MEDIUM: ' + untestedCount + ' untested artifacts in ' + appScope + '. Schedule test creation in current sprint. Risk score ' + riskScore + '/100.';
        } else {
            return 'LOW: Coverage is adequate for ' + appScope + '. Maintain current testing practices. Risk score ' + riskScore + '/100.';
        }
    },

    /**
     * Gets the human-readable app name from sys_app.
     *
     * @param {string} appScope - Scope prefix
     * @returns {string} App name or scope prefix if not found
     * @private
     */
    _getAppName: function(appScope) {
        var appGr = new GlideRecord('sys_app');
        appGr.addQuery('scope', appScope);
        appGr.setLimit(1);
        appGr.query();
        if (appGr.next()) {
            return appGr.getValue('name') || appScope;
        }
        return appScope;
    },

    /**
     * Escapes XML special characters.
     *
     * @param {string} str - Input string
     * @returns {string} XML-safe string
     * @private
     */
    _escapeXml: function(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&apos;');
    },


    /**
     * Action dispatcher. Single entry point for POST /api/x_snc_testreach/execute.
     *
     * @param {object} body - {action, app_scope, params}
     * @returns {object} {ok: bool, data?: object, error?: string, http_status: number}
     */
    dispatch: function(body) {
        body = body || {};
        var action = body.action;
        var appScope = body.app_scope;
        var params = body.params || {};
        var validActions = ['analyze', 'risk_score', 'upgrade_gap', 'generate_skeleton', 'coverage_check'];

        if (validActions.indexOf(action) === -1) {
            return {
                ok: false,
                error: "Unknown action: '" + action + "'. Valid actions: " + validActions.join(', '),
                http_status: 400
            };
        }
        if (!appScope && action !== 'analyze') {
            return { ok: false, error: 'app_scope is required for action ' + action, http_status: 400 };
        }

        try {
            var coverageEngine = new TestReachCoverageEngine();
            var result;
            switch (action) {
                case 'analyze':
                    var scopeToAnalyze = appScope || '';
                    if (!scopeToAnalyze) {
                        var gr = new GlideRecord('sys_app');
                        gr.addQuery('vendor_prefix', 'x_');
                        gr.addQuery('scope', '!=', 'x_snc_testreach');
                        gr.setLimit(1);
                        gr.query();
                        if (gr.next()) scopeToAnalyze = gr.getValue('scope');
                    }
                    if (!scopeToAnalyze) {
                        return { ok: false, error: 'No app_scope provided and no scoped apps found.', http_status: 400 };
                    }
                    var snapshotSysId = coverageEngine.snapshotCoverage(scopeToAnalyze);
                    result = {
                        snapshot_id: snapshotSysId,
                        app_scope: scopeToAnalyze,
                        message: 'Coverage snapshot written successfully.'
                    };
                    break;
                case 'risk_score':
                    result = this.computeRiskScore(appScope, params.upgrade_target || '');
                    break;
                case 'upgrade_gap':
                    result = { items: this.generateUpgradeGapReport(params.upgrade_target || '') };
                    break;
                case 'generate_skeleton':
                    if (!params.artifact_sys_id) {
                        return { ok: false, error: 'params.artifact_sys_id is required for generate_skeleton.', http_status: 400 };
                    }
                    result = this.generateTestSkeleton(params.artifact_sys_id, params.artifact_type || 'business_rule');
                    break;
                case 'coverage_check':
                    result = this.checkCIThreshold(appScope, params.threshold || 60);
                    break;
            }
            return { ok: true, data: result, http_status: 200 };
        } catch (e) {
            return { ok: false, error: 'Internal error: ' + (e.message || e.toString()), http_status: 500 };
        }
    },

    type: 'TestReachRiskEngine'
};
