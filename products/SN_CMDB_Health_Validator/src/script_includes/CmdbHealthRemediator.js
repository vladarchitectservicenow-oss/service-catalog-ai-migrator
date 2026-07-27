// CMDB Health Validator for AI Readiness — CmdbHealthRemediator
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Remediation engine: generates prioritized fix plans, creates tasks, tracks resolution.
// @class CmdbHealthRemediator @namespace x_snc_cah

var CmdbHealthRemediator = Class.create();
CmdbHealthRemediator.prototype = {
    initialize: function() {},

    /**
     * Generate prioritized remediation plan from a scan.
     * @param {string} scanId
     * @returns {object} {total_tasks, by_severity: {P0, P1, P2, P3}, tasks[]}
     */
    generateRemediationPlan: function(scanId) {
        var scanner = new CmdbHealthScanner();
        var scan = scanner.getScanDetail(scanId);

        if (!scan) {
            return { error: 'Scan not found: ' + scanId };
        }

        var tasks = [];
        var bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };

        // Process findings into remediation tasks
        var findings = scan.findings || [];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var taskData = {
                scan: scanId,
                type: this._determineTaskType(f),
                severity: f.severity || 'P2',
                dimension: f.dimension,
                ci_class: f.ci_class || '',
                ci_sys_id: f.ci_sys_id || '',
                finding_description: f.issue || '',
                remediation_action: this._generateAction(f),
                effort_estimate: this._estimateEffort(f),
                status: 'open'
            };

            var taskId = this.createRemediationTask(taskData);
            if (taskId) {
                taskData.task_id = taskId;
                tasks.push(taskData);
                bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
            }
        }

        return {
            scan_id: scanId,
            total_tasks: tasks.length,
            by_severity: bySeverity,
            tasks: tasks
        };
    },

    /**
     * Create a single remediation task.
     * @param {object} taskData
     * @returns {string} sys_id of created task
     */
    createRemediationTask: function(taskData) {
        var gr = new GlideRecord('x_snc_cah_remediation');
        gr.setValue('scan', taskData.scan);
        gr.setValue('type', taskData.type || 'manual_task');
        gr.setValue('severity', taskData.severity || 'P2');
        gr.setValue('dimension', taskData.dimension);
        gr.setValue('ci_class', taskData.ci_class || '');
        gr.setValue('ci_sys_id', taskData.ci_sys_id || '');
        gr.setValue('finding_description', taskData.finding_description);
        gr.setValue('remediation_action', taskData.remediation_action);
        gr.setValue('effort_estimate', taskData.effort_estimate || 'medium');
        gr.setValue('status', 'open');

        try {
            return gr.insert();
        } catch (e) {
            gs.error('CmdbHealthRemediator: Failed to create remediation task: ' + e.message);
            return '';
        }
    },

    /**
     * Get remediation status summary for a scan.
     * @param {string} scanId
     * @returns {object} {open, in_progress, resolved, dismissed, total}
     */
    getRemediationStatus: function(scanId) {
        var statuses = { open: 0, in_progress: 0, resolved: 0, dismissed: 0, total: 0 };

        var gr = new GlideRecord('x_snc_cah_remediation');
        gr.addQuery('scan', scanId);
        gr.query();

        while (gr.next()) {
            var st = gr.getValue('status');
            statuses[st] = (statuses[st] || 0) + 1;
            statuses.total++;
        }

        return statuses;
    },

    /**
     * Predict AI impact: which CMDB gaps will cause AI deployment failures.
     * @param {string} scanId
     * @param {object} aiScope - {ci_classes: [], use_cases: []}
     * @returns {object} {risk_level, blocked_use_cases[], critical_gaps[]}
     */
    predictAIImpact: function(scanId, aiScope) {
        var scanner = new CmdbHealthScanner();
        var scan = scanner.getScanDetail(scanId);

        if (!scan) {
            return { error: 'Scan not found: ' + scanId };
        }

        var targetClasses = aiScope.ci_classes || [];
        var useCases = aiScope.use_cases || [];
        var criticalGaps = [];
        var blockedUseCases = [];

        // Check each target CI class against scan findings
        var findings = scan.findings || [];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            if (targetClasses.length === 0 || targetClasses.indexOf(f.ci_class) !== -1) {
                if (f.severity === 'P0' || f.severity === 'P1') {
                    criticalGaps.push({
                        ci_class: f.ci_class,
                        dimension: f.dimension,
                        severity: f.severity,
                        issue: f.issue,
                        ai_risk: this._mapToAIRisk(f.dimension)
                    });
                }
            }
        }

        // Map gaps to blocked use cases
        for (var u = 0; u < useCases.length; u++) {
            var uc = useCases[u];
            var blocked = false;
            for (var g = 0; g < criticalGaps.length; g++) {
                if (this._gapBlocksUseCase(criticalGaps[g], uc)) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) {
                blockedUseCases.push(uc);
            }
        }

        // Determine risk level
        var riskLevel = 'low';
        if (criticalGaps.length >= 5 || blockedUseCases.length >= 3) {
            riskLevel = 'critical';
        } else if (criticalGaps.length >= 2 || blockedUseCases.length >= 1) {
            riskLevel = 'high';
        } else if (criticalGaps.length >= 1) {
            riskLevel = 'medium';
        }

        // Store AI impact on scan record
        var impactData = {
            risk_level: riskLevel,
            blocked_use_cases: blockedUseCases,
            critical_gaps: criticalGaps,
            assessed_at: new GlideDateTime().getValue()
        };

        var updateGr = new GlideRecord('x_snc_cah_health_scan');
        if (updateGr.get(scanId)) {
            updateGr.setValue('ai_impact_json', JSON.stringify(impactData));
            try {
                updateGr.update();
            } catch (e) {
                gs.error('CmdbHealthRemediator: Failed to store AI impact: ' + e.message);
            }
        }

        return {
            scan_id: scanId,
            risk_level: riskLevel,
            ai_readiness_score: scan.ai_readiness_score,
            critical_gaps_count: criticalGaps.length,
            blocked_use_cases: blockedUseCases,
            critical_gaps: criticalGaps
        };
    },

    /**
     * Resolve a remediation task.
     * @param {string} taskId
     * @param {string} resolutionNotes
     * @returns {boolean} success
     */
    resolveTask: function(taskId, resolutionNotes) {
        var gr = new GlideRecord('x_snc_cah_remediation');
        if (!gr.get(taskId)) {
            return false;
        }

        gr.setValue('status', 'resolved');
        gr.setValue('resolved_at', new GlideDateTime());
        gr.setValue('resolution_notes', resolutionNotes || '');

        try {
            gr.update();
            return true;
        } catch (e) {
            gs.error('CmdbHealthRemediator: Failed to resolve task: ' + e.message);
            return false;
        }
    },

    // ── Private helpers ──

    /**
     * Determine task type from finding.
     * @private
     */
    _determineTaskType: function(finding) {
        if (finding.dimension === 'duplicate') return 'auto_fix';
        if (finding.dimension === 'coverage') return 'review';
        return 'manual_task';
    },

    /**
     * Generate remediation action text.
     * @private
     */
    _generateAction: function(finding) {
        var actions = {
            completeness: 'Populate missing mandatory fields for ' + (finding.ci_class || 'CIs') + '. Use data import, integration, or manual entry.',
            staleness: 'Run Discovery against ' + (finding.ci_class || 'stale CIs') + ' to refresh last-updated timestamps.',
            relationship: 'Review and fix orphaned/broken relationships in cmdb_rel_ci. Remove dead references or restore missing CIs.',
            duplicate: 'Run duplicate remediation: identify and merge duplicate ' + (finding.ci_class || 'CIs') + ' records.',
            coverage: 'Deploy Discovery for missing CI classes or manually create baseline records.'
        };
        return actions[finding.dimension] || 'Review and remediate the identified issue.';
    },

    /**
     * Estimate effort for a finding.
     * @private
     */
    _estimateEffort: function(finding) {
        if (finding.severity === 'P0' && (finding.count || 0) > 100) return 'critical';
        if (finding.severity === 'P0' || finding.severity === 'P1') return 'high';
        if (finding.severity === 'P2') return 'medium';
        return 'low';
    },

    /**
     * Map dimension to AI risk description.
     * @private
     */
    _mapToAIRisk: function(dimension) {
        var risks = {
            completeness: 'AI agents receive incomplete CI context, causing incorrect automation decisions',
            staleness: 'AI operates on outdated infrastructure data, risking changes to decommissioned assets',
            relationship: 'AI cannot understand service topology, blocking impact analysis and root cause automation',
            duplicate: 'AI double-counts resources, inflating capacity estimates and creating conflicting actions',
            coverage: 'AI has blind spots — critical infrastructure components are invisible to automation'
        };
        return risks[dimension] || 'Unknown AI risk';
    },

    /**
     * Check if a gap blocks a specific AI use case.
     * @private
     */
    _gapBlocksUseCase: function(gap, useCase) {
        var uc = useCase.toLowerCase();
        if (gap.dimension === 'relationship' && (uc.indexOf('impact') !== -1 || uc.indexOf('topology') !== -1 || uc.indexOf('root cause') !== -1)) return true;
        if (gap.dimension === 'staleness' && (uc.indexOf('change') !== -1 || uc.indexOf('deploy') !== -1 || uc.indexOf('provision') !== -1)) return true;
        if (gap.dimension === 'completeness' && (uc.indexOf('ticket') !== -1 || uc.indexOf('incident') !== -1 || uc.indexOf('request') !== -1)) return true;
        if (gap.dimension === 'duplicate' && (uc.indexOf('capacity') !== -1 || uc.indexOf('inventory') !== -1 || uc.indexOf('report') !== -1)) return true;
        if (gap.dimension === 'coverage' && (uc.indexOf('discovery') !== -1 || uc.indexOf('monitor') !== -1 || uc.indexOf('scan') !== -1)) return true;
        return false;
    },

    type: 'CmdbHealthRemediator'
};
