// UpgradeGuard — Test Case Generator, Migration Step Generator, and Report Engine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Generates regression test checklists, migration steps, and exportable
// reports (JSON, CSV) from UpgradeGuardEngine analysis results.
// @class UpgradeGuardReporter @namespace x_upgradeguardsn

var UpgradeGuardReporter = Class.create();
UpgradeGuardReporter.prototype = {

    /**
     * Initialize with an analysis run ID.
     * @param {string} runId - analysis run ID from UpgradeGuardEngine
     */
    initialize: function(runId) {
        this.runId = runId || '';
    },

    /**
     * Generate test cases for all analysis results in this run.
     * Creates one test case per flagged component, prioritized by risk score.
     * @return {Array} array of generated test case objects
     */
    generateTestCases: function() {
        var analysisRecords = this._getAnalysisRecords();
        if (analysisRecords.length === 0) {
            return [];
        }
        var testCases = [];
        for (var i = 0; i < analysisRecords.length; i++) {
            var ar = analysisRecords[i];
            var tc = this._buildTestCase(ar);
            testCases.push(tc);
            this._persistTestCase(tc);
        }
        return testCases;
    },

    /**
     * Generate migration steps for breaking-change analysis records.
     * @return {Array} array of analysis records with migration_steps populated
     */
    generateMigrationSteps: function() {
        var analysisRecords = this._getAnalysisRecords();
        var updated = [];
        for (var i = 0; i < analysisRecords.length; i++) {
            var ar = analysisRecords[i];
            if (ar.change_type !== 'breaking') {
                continue;
            }
            var steps = this._buildMigrationSteps(ar);
            ar.migration_steps = steps;
            this._updateAnalysisRecord(ar.sys_id, { migration_steps: steps });
            updated.push(ar);
        }
        return updated;
    },

    /**
     * Generate a summary report for the analysis run.
     * @param {string} format - 'json' or 'csv'
     * @return {string} report content
     */
    generateReport: function(format) {
        var analysisRecords = this._getAnalysisRecords();
        var testCases = this._getTestCases();
        if (format === 'csv') {
            return this._generateCsvReport(analysisRecords, testCases);
        }
        return this._generateJsonReport(analysisRecords, testCases);
    },

    /**
     * Get summary statistics for the analysis run.
     * @return {Object} stats object with counts by severity and change type
     */
    getSummary: function() {
        var analysisRecords = this._getAnalysisRecords();
        var testCases = this._getTestCases();
        var stats = {
            run_id: this.runId,
            total_components: analysisRecords.length,
            breaking_count: 0,
            additive_count: 0,
            neutral_count: 0,
            critical_count: 0,
            high_count: 0,
            medium_count: 0,
            low_count: 0,
            total_test_cases: testCases.length,
            test_cases_passed: 0,
            test_cases_failed: 0,
            test_cases_not_run: 0,
            avg_risk_score: 0
        };
        var totalRisk = 0;
        for (var i = 0; i < analysisRecords.length; i++) {
            var ar = analysisRecords[i];
            switch (ar.change_type) {
                case 'breaking': stats.breaking_count++; break;
                case 'additive': stats.additive_count++; break;
                default: stats.neutral_count++;
            }
            switch (ar.severity) {
                case 'critical': stats.critical_count++; break;
                case 'high': stats.high_count++; break;
                case 'medium': stats.medium_count++; break;
                default: stats.low_count++;
            }
            totalRisk += parseInt(ar.risk_score || 0, 10);
        }
        if (analysisRecords.length > 0) {
            stats.avg_risk_score = Math.round(totalRisk / analysisRecords.length);
        }
        for (var j = 0; j < testCases.length; j++) {
            var tc = testCases[j];
            switch (tc.execution_status) {
                case 'passed': stats.test_cases_passed++; break;
                case 'failed': stats.test_cases_failed++; break;
                default: stats.test_cases_not_run++;
            }
        }
        return stats;
    },

    /**
     * Full pipeline: generate test cases + migration steps + report.
     * @param {string} format - 'json' or 'csv'
     * @return {string} report content
     */
    runFullReport: function(format) {
        this.generateTestCases();
        this.generateMigrationSteps();
        return this.generateReport(format || 'json');
    },

    // ── Private: Test Case Generation ──

    _buildTestCase: function(analysisRecord) {
        var testName = 'Verify ' + analysisRecord.component_name +
            ' after ' + analysisRecord.release_family + ' upgrade';
        var description = 'Regression test for ' + analysisRecord.component_type +
            ' "' + analysisRecord.component_name + '" — flagged as ' +
            analysisRecord.change_type + ' change (risk: ' +
            analysisRecord.risk_score + '/' + analysisRecord.severity + ').';
        var steps = this._buildTestSteps(analysisRecord);
        var expected = this._buildExpectedResult(analysisRecord);
        var priority = this._mapRiskToPriority(analysisRecord.severity);
        var testType = analysisRecord.change_type === 'breaking' ? 'migration' : 'regression';
        return {
            analysis_record: analysisRecord.sys_id,
            test_name: testName,
            test_description: description,
            test_type: testType,
            priority: priority,
            test_steps: steps,
            expected_result: expected,
            migration_action: analysisRecord.change_type === 'breaking' ?
                'Replace deprecated API with recommended alternative' : '',
            migration_code_snippet: '',
            assigned_to: '',
            execution_status: 'not_run',
            execution_date: '',
            execution_notes: '',
            analysis_run_id: this.runId
        };
    },

    _buildTestSteps: function(ar) {
        var steps = [];
        steps.push('1. Navigate to the affected component in the instance.');
        steps.push('2. Review the release note: ' + (ar.release_note_summary || 'N/A'));
        if (ar.change_type === 'breaking') {
            steps.push('3. Apply migration steps if provided.');
            steps.push('4. Execute the component in a sub-production instance.');
            steps.push('5. Verify no errors in system logs.');
        } else {
            steps.push('3. Execute the component as normal.');
            steps.push('4. Verify behavior matches pre-upgrade expectations.');
        }
        steps.push('Final. Document results and mark test case as Passed/Failed.');
        return steps.join('\n');
    },

    _buildExpectedResult: function(ar) {
        if (ar.change_type === 'breaking') {
            return 'Component functions correctly after migration. No errors in logs. ' +
                'Deprecated API references removed or replaced.';
        }
        return 'Component functions identically to pre-upgrade behavior. ' +
            'No unexpected changes in output or performance.';
    },

    _mapRiskToPriority: function(severity) {
        switch (severity) {
            case 'critical': return 'critical';
            case 'high': return 'high';
            case 'medium': return 'medium';
            default: return 'low';
        }
    },

    _persistTestCase: function(tc) {
        var gr = new GlideRecord('x_upgradeguardsn_test_case');
        gr.initialize();
        gr.setValue('analysis_record', tc.analysis_record || '');
        gr.setValue('test_name', tc.test_name || '');
        gr.setValue('test_description', tc.test_description || '');
        gr.setValue('test_type', tc.test_type || '');
        gr.setValue('priority', tc.priority || '');
        gr.setValue('test_steps', tc.test_steps || '');
        gr.setValue('expected_result', tc.expected_result || '');
        gr.setValue('migration_action', tc.migration_action || '');
        gr.setValue('migration_code_snippet', tc.migration_code_snippet || '');
        gr.setValue('assigned_to', tc.assigned_to || '');
        gr.setValue('execution_status', 'not_run');
        gr.setValue('analysis_run_id', this.runId);
        try {
            gr.insert();
        } catch (e) {
            gs.error('UpgradeGuardReporter._persistTestCase: insert failed for ' +
                tc.test_name + ' — ' + e.message);
        }
    },

    // ── Private: Migration Steps ──

    _buildMigrationSteps: function(ar) {
        var steps = [];
        steps.push('Component: ' + ar.component_name + ' (' + ar.component_type + ')');
        steps.push('Affected API(s): ' + (ar.affected_api || 'N/A'));
        steps.push('Release Note: ' + (ar.release_note_summary || 'N/A'));
        if (ar.migration_guide_url) {
            steps.push('Migration Guide: ' + ar.migration_guide_url);
        }
        steps.push('Action: Review the component source code for deprecated API usage.');
        steps.push('Action: Replace deprecated calls with recommended alternatives.');
        steps.push('Action: Test in sub-production instance before upgrade.');
        steps.push('Action: Update unit tests to cover new API usage.');
        return steps.join('\n');
    },

    // ── Private: Report Generation ──

    _generateJsonReport: function(analysisRecords, testCases) {
        var report = {
            run_id: this.runId,
            generated_at: new GlideDateTime().toString(),
            summary: this.getSummary(),
            analysis_results: [],
            test_cases: []
        };
        for (var i = 0; i < analysisRecords.length; i++) {
            var ar = analysisRecords[i];
            report.analysis_results.push({
                component_type: ar.component_type,
                component_name: ar.component_name,
                module: ar.module,
                change_type: ar.change_type,
                risk_score: ar.risk_score,
                severity: ar.severity,
                affected_api: ar.affected_api,
                release_note_summary: ar.release_note_summary,
                migration_steps: ar.migration_steps
            });
        }
        for (var j = 0; j < testCases.length; j++) {
            var tc = testCases[j];
            report.test_cases.push({
                test_name: tc.test_name,
                test_type: tc.test_type,
                priority: tc.priority,
                execution_status: tc.execution_status,
                test_steps: tc.test_steps,
                expected_result: tc.expected_result
            });
        }
        return JSON.stringify(report, null, 2);
    },

    _generateCsvReport: function(analysisRecords, testCases) {
        var lines = [];
        lines.push('Component Type,Component Name,Module,Change Type,Risk Score,Severity,Affected API,Release Note Summary');
        for (var i = 0; i < analysisRecords.length; i++) {
            var ar = analysisRecords[i];
            lines.push([
                this._csvEscape(ar.component_type),
                this._csvEscape(ar.component_name),
                this._csvEscape(ar.module),
                this._csvEscape(ar.change_type),
                ar.risk_score,
                this._csvEscape(ar.severity),
                this._csvEscape(ar.affected_api),
                this._csvEscape(ar.release_note_summary)
            ].join(','));
        }
        lines.push('');
        lines.push('Test Name,Test Type,Priority,Status,Expected Result');
        for (var j = 0; j < testCases.length; j++) {
            var tc = testCases[j];
            lines.push([
                this._csvEscape(tc.test_name),
                this._csvEscape(tc.test_type),
                this._csvEscape(tc.priority),
                this._csvEscape(tc.execution_status),
                this._csvEscape(tc.expected_result)
            ].join(','));
        }
        return lines.join('\n');
    },

    _csvEscape: function(val) {
        if (!val) return '';
        var s = val.toString();
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    },

    // ── Private: Data Access ──

    _getAnalysisRecords: function() {
        var records = [];
        var gr = new GlideRecord('x_upgradeguardsn_analysis');
        gr.addQuery('analysis_run_id', this.runId);
        gr.orderBy('risk_score');
        gr.setLimit(1000);
        gr.query();
        while (gr.next()) {
            records.push({
                sys_id: gr.getUniqueValue(),
                component_type: gr.getValue('component_type'),
                component_name: gr.getValue('component_name'),
                component_sys_id: gr.getValue('component_sys_id'),
                scope: gr.getValue('scope'),
                module: gr.getValue('module'),
                source_code: gr.getValue('source_code'),
                usage_count: parseInt(gr.getValue('usage_count') || '0', 10),
                last_modified: gr.getValue('last_modified'),
                release_family: gr.getValue('release_family'),
                change_type: gr.getValue('change_type'),
                affected_api: gr.getValue('affected_api'),
                release_note_url: gr.getValue('release_note_url'),
                release_note_summary: gr.getValue('release_note_summary'),
                migration_guide_url: gr.getValue('migration_guide_url'),
                risk_score: parseInt(gr.getValue('risk_score') || '0', 10),
                severity: gr.getValue('severity'),
                risk_factors: gr.getValue('risk_factors'),
                migration_steps: gr.getValue('migration_steps'),
                analysis_run_id: gr.getValue('analysis_run_id'),
                analysis_date: gr.getValue('analysis_date'),
                status: gr.getValue('status')
            });
        }
        return records;
    },

    _getTestCases: function() {
        var records = [];
        var gr = new GlideRecord('x_upgradeguardsn_test_case');
        gr.addQuery('analysis_run_id', this.runId);
        gr.orderBy('priority');
        gr.setLimit(1000);
        gr.query();
        while (gr.next()) {
            records.push({
                sys_id: gr.getUniqueValue(),
                analysis_record: gr.getValue('analysis_record'),
                test_name: gr.getValue('test_name'),
                test_description: gr.getValue('test_description'),
                test_type: gr.getValue('test_type'),
                priority: gr.getValue('priority'),
                test_steps: gr.getValue('test_steps'),
                expected_result: gr.getValue('expected_result'),
                migration_action: gr.getValue('migration_action'),
                migration_code_snippet: gr.getValue('migration_code_snippet'),
                assigned_to: gr.getValue('assigned_to'),
                execution_status: gr.getValue('execution_status'),
                execution_date: gr.getValue('execution_date'),
                execution_notes: gr.getValue('execution_notes'),
                analysis_run_id: gr.getValue('analysis_run_id')
            });
        }
        return records;
    },

    _updateAnalysisRecord: function(sysId, updates) {
        var gr = new GlideRecord('x_upgradeguardsn_analysis');
        if (!gr.get(sysId)) {
            gs.warn('UpgradeGuardReporter._updateAnalysisRecord: record not found ' + sysId);
            return;
        }
        for (var key in updates) {
            if (updates.hasOwnProperty(key)) {
                gr.setValue(key, updates[key]);
            }
        }
        try {
            gr.update();
        } catch (e) {
            gs.error('UpgradeGuardReporter._updateAnalysisRecord: update failed for ' +
                sysId + ' — ' + e.message);
        }
    },

    type: 'UpgradeGuardReporter'
};
