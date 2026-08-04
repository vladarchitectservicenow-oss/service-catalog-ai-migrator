// ConfigSync — Instance Configuration Drift Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine for configuration fingerprinting, comparison, and risk scoring.
// @class ConfigSyncEngine @namespace x_csync

var ConfigSyncEngine = Class.create();
ConfigSyncEngine.prototype = {
    initialize: function() {
        this.ARTIFACT_TYPES = [
            { table: 'sys_properties',     field: 'value',  nameField: 'name',  riskWeight: 0.4, label: 'sys_properties' },
            { table: 'sys_script',          field: 'script', nameField: 'name',  riskWeight: 0.8, label: 'sys_script' },
            { table: 'sys_security_acl',    field: 'script', nameField: 'name',  riskWeight: 0.9, label: 'sys_security_acl' },
            { table: 'sys_script_client',   field: 'script', nameField: 'name',  riskWeight: 0.5, label: 'sys_script_client' },
            { table: 'sys_ui_policy',       field: 'script_true', nameField: 'name', riskWeight: 0.5, label: 'sys_ui_policy' },
            { table: 'sys_dictionary',      field: 'default_value', nameField: 'element', riskWeight: 0.6, label: 'sys_dictionary' },
            { table: 'sys_trigger',         field: 'script', nameField: 'name',  riskWeight: 0.7, label: 'sys_trigger' },
            { table: 'sys_script_include',  field: 'script', nameField: 'name',  riskWeight: 0.7, label: 'sys_script_include' }
        ];
    },

    /**
     * Fingerprint all configured artifact types and store as a snapshot.
     * @param {string} instanceName - Identifier for this instance (e.g., "dev362840")
     * @param {string} snapshotName - Human-readable name for the snapshot
     * @param {string} snapshotType - "manual", "scheduled", or "pre_clone"
     * @returns {string} sys_id of the created snapshot, or empty string on failure
     */
    fingerprintInstance: function(instanceName, snapshotName, snapshotType) {
        try {
            var artifacts = [];
            for (var i = 0; i < this.ARTIFACT_TYPES.length; i++) {
                var at = this.ARTIFACT_TYPES[i];
                var gr = new GlideRecord(at.table);
                gr.addQuery('sys_scope', 'global');
                gr.setLimit(500);
                gr.query();
                while (gr.next()) {
                    var payload = this._normalizePayload(gr, at);
                    var hash = this._sha256(payload);
                    artifacts.push({
                        type: at.label,
                        name: gr.getValue(at.nameField) || '',
                        sys_id: gr.getUniqueValue() || '',
                        hash: hash,
                        fields_summary: this._summarizeFields(gr, at)
                    });
                }
            }

            var snap = new GlideRecord('x_csync_snapshot');
            snap.initialize();
            snap.setValue('name', snapshotName);
            snap.setValue('instance', instanceName);
            snap.setValue('snapshot_type', snapshotType);
            snap.setValue('artifact_count', artifacts.length);
            snap.setValue('artifacts_json', JSON.stringify(artifacts));
            var snapId = snap.insert();
            return snapId || '';
        } catch (e) {
            gs.error('ConfigSyncEngine.fingerprintInstance failed: ' + e.message);
            return '';
        }
    },

    /**
     * Compare two snapshots and produce a drift report.
     * @param {string} baselineId - sys_id of the baseline snapshot
     * @param {string} targetId - sys_id of the target snapshot
     * @returns {object} DriftReport { drift_score, items[], gate, total_artifacts, drift_count }
     */
    compareSnapshots: function(baselineId, targetId) {
        var report = { drift_score: 100, items: [], gate: 'PASS', total_artifacts: 0, drift_count: 0 };

        try {
            var baseline = this._loadSnapshot(baselineId);
            var target = this._loadSnapshot(targetId);
            if (!baseline || !target) {
                report.gate = 'FAIL';
                report.drift_score = 0;
                return report;
            }

            var baselineMap = this._buildArtifactMap(baseline.artifacts);
            var targetMap = this._buildArtifactMap(target.artifacts);
            report.total_artifacts = baseline.artifacts.length;

            // Check for removed artifacts (in baseline but not in target)
            for (var key in baselineMap) {
                if (!baselineMap.hasOwnProperty(key)) continue;
                if (!targetMap[key]) {
                    var item = this._createDriftItem(baselineMap[key], null, 'removed', baselineId, targetId);
                    report.items.push(item);
                }
            }

            // Check for added or modified artifacts
            for (var tKey in targetMap) {
                if (!targetMap.hasOwnProperty(tKey)) continue;
                if (!baselineMap[tKey]) {
                    var addedItem = this._createDriftItem(null, targetMap[tKey], 'added', baselineId, targetId);
                    report.items.push(addedItem);
                } else if (baselineMap[tKey].hash !== targetMap[tKey].hash) {
                    var modItem = this._createDriftItem(baselineMap[tKey], targetMap[tKey], 'modified', baselineId, targetId);
                    report.items.push(modItem);
                }
            }

            report.drift_count = report.items.length;

            // Calculate composite drift score
            if (report.items.length > 0) {
                var totalRisk = 0;
                for (var j = 0; j < report.items.length; j++) {
                    totalRisk += report.items[j].risk_score;
                }
                var avgRisk = totalRisk / report.items.length;
                report.drift_score = Math.max(0, Math.round(100 - avgRisk));
            }

            // Determine gate
            if (report.drift_score < 50) {
                report.gate = 'FAIL';
            } else if (report.drift_score < 80) {
                report.gate = 'WARN';
            } else {
                report.gate = 'PASS';
            }

            // Persist drift items
            for (var k = 0; k < report.items.length; k++) {
                this._saveDriftItem(report.items[k]);
            }

            return report;
        } catch (e) {
            gs.error('ConfigSyncEngine.compareSnapshots failed: ' + e.message);
            report.gate = 'FAIL';
            report.drift_score = 0;
            return report;
        }
    },

    /**
     * Calculate risk score (0-100) for a single drift item.
     * @param {object} driftItem - Drift item with artifact_type and change_type
     * @returns {number} Risk score 0-100
     */
    calculateRiskScore: function(driftItem) {
        var baseWeight = 0.5;
        for (var i = 0; i < this.ARTIFACT_TYPES.length; i++) {
            if (this.ARTIFACT_TYPES[i].label === driftItem.artifact_type) {
                baseWeight = this.ARTIFACT_TYPES[i].riskWeight;
                break;
            }
        }

        var changeMultiplier = 1.0;
        if (driftItem.change_type === 'removed') {
            changeMultiplier = 1.2;
        } else if (driftItem.change_type === 'added') {
            changeMultiplier = 0.8;
        }

        return Math.min(100, Math.round(baseWeight * changeMultiplier * 100));
    },

    /**
     * Generate a structural diff between two artifact payloads.
     * @param {object} artifactA - Baseline artifact
     * @param {object} artifactB - Target artifact
     * @returns {object} DiffResult { type, fields_diff, summary }
     */
    generateDiff: function(artifactA, artifactB) {
        var result = { type: 'identical', fields_diff: {}, summary: '' };
        if (!artifactA && artifactB) {
            result.type = 'added';
            result.summary = 'New artifact: ' + (artifactB.name || 'unknown');
            return result;
        }
        if (artifactA && !artifactB) {
            result.type = 'removed';
            result.summary = 'Removed artifact: ' + (artifactA.name || 'unknown');
            return result;
        }
        if (!artifactA || !artifactB) {
            return result;
        }

        var diffFields = {};
        var allKeys = {};
        for (var k in artifactA.fields_summary) {
            if (artifactA.fields_summary.hasOwnProperty(k)) allKeys[k] = true;
        }
        for (var k2 in artifactB.fields_summary) {
            if (artifactB.fields_summary.hasOwnProperty(k2)) allKeys[k2] = true;
        }

        var hasDiff = false;
        for (var key in allKeys) {
            if (!allKeys.hasOwnProperty(key)) continue;
            var valA = artifactA.fields_summary[key] || '';
            var valB = artifactB.fields_summary[key] || '';
            if (valA !== valB) {
                diffFields[key] = { before: valA, after: valB };
                hasDiff = true;
            }
        }

        if (hasDiff) {
            result.type = 'modified';
            result.fields_diff = diffFields;
            var changedFields = [];
            for (var fk in diffFields) {
                if (diffFields.hasOwnProperty(fk)) changedFields.push(fk);
            }
            result.summary = 'Changed fields: ' + changedFields.join(', ');
        }

        return result;
    },

    /**
     * Get drift timeline data for an instance pair over N days.
     * @param {string} instanceName - Instance identifier
     * @param {number} days - Number of days to look back
     * @returns {object} TimelineData { points[] }
     */
    getDriftTimeline: function(instanceName, days) {
        var timeline = { points: [] };
        try {
            var cutoff = new GlideDateTime();
            cutoff.addDays(-1 * (days || 30));

            var snap = new GlideRecord('x_csync_snapshot');
            snap.addQuery('instance', instanceName);
            snap.addQuery('sys_created_on', '>=', cutoff);
            snap.orderBy('sys_created_on');
            snap.query();

            while (snap.next()) {
                var driftCount = this._countDriftItems(snap.getUniqueValue());
                timeline.points.push({
                    snapshot_id: snap.getUniqueValue(),
                    name: snap.getValue('name') || '',
                    created_at: snap.getValue('sys_created_on') || '',
                    artifact_count: parseInt(snap.getValue('artifact_count') || '0', 10),
                    drift_count: driftCount
                });
            }
            return timeline;
        } catch (e) {
            gs.error('ConfigSyncEngine.getDriftTimeline failed: ' + e.message);
            return timeline;
        }
    },

    /**
     * Pre-clone / pre-upgrade safety gate check.
     * @param {string} baselineId - sys_id of the baseline snapshot
     * @param {string} targetId - sys_id of the target snapshot
     * @returns {object} GateReport { drift_score, gate, risk_items[], deployable }
     */
    checkGate: function(baselineId, targetId) {
        var report = this.compareSnapshots(baselineId, targetId);
        var highRiskItems = [];
        for (var i = 0; i < report.items.length; i++) {
            if (report.items[i].risk_score >= 70) {
                highRiskItems.push(report.items[i]);
            }
        }
        return {
            drift_score: report.drift_score,
            gate: report.gate,
            risk_items: highRiskItems,
            deployable: report.gate === 'PASS',
            total_drift: report.drift_count,
            total_artifacts: report.total_artifacts
        };
    },

    // ── Private helpers ──

    _normalizePayload: function(gr, artifactType) {
        var fields = {};
        var keyFields = this._getKeyFields();
        for (var i = 0; i < keyFields.length; i++) {
            var name = keyFields[i];
            // Skip volatile fields that differ between instances
            if (name === 'sys_created_on' || name === 'sys_updated_on' ||
                name === 'sys_created_by' || name === 'sys_updated_by' ||
                name === 'sys_mod_count' || name === 'sys_id') {
                continue;
            }
            var val = gr.getValue(name);
            if (val !== null && val !== undefined) {
                fields[name] = val;
            }
        }
        // Sort keys for deterministic hashing
        var sortedKeys = Object.keys(fields).sort();
        var normalized = '';
        for (var j = 0; j < sortedKeys.length; j++) {
            normalized += sortedKeys[j] + '=' + fields[sortedKeys[j]] + '\n';
        }
        return normalized;
    },

    _sha256: function(input) {
        var digest = new GlideDigest();
        return digest.sha256_digest(input);
    },

    _summarizeFields: function(gr, artifactType) {
        var summary = {};
        var keyFields = this._getKeyFields();
        for (var i = 0; i < keyFields.length; i++) {
            var val = gr.getValue(keyFields[i]);
            if (val !== null && val !== undefined && val !== '') {
                summary[keyFields[i]] = val;
            }
        }
        return summary;
    },

    _getKeyFields: function() {
        var prop = gs.getProperty('x_csync.key_fields', '');
        if (prop) {
            return prop.split(',').map(function(f) { return f.trim(); });
        }
        // Default key fields
        return ['name', 'active', 'script', 'condition', 'order', 'type',
                'value', 'description', 'access', 'when', 'action_insert',
                'action_update', 'action_delete', 'operation', 'element',
                'mandatory', 'read_only', 'default_value', 'trigger_type',
                'next_action', 'reverse_if_false'];
    },

    _loadSnapshot: function(snapshotId) {
        var snap = new GlideRecord('x_csync_snapshot');
        if (!snap.get(snapshotId)) {
            return null;
        }
        var artifactsJson = snap.getValue('artifacts_json') || '[]';
        var artifacts = JSON.parse(artifactsJson);
        return {
            sys_id: snapshotId,
            name: snap.getValue('name') || '',
            instance: snap.getValue('instance') || '',
            artifacts: artifacts
        };
    },

    _buildArtifactMap: function(artifacts) {
        var map = {};
        for (var i = 0; i < artifacts.length; i++) {
            var a = artifacts[i];
            var key = a.type + '::' + (a.sys_id || a.name);
            map[key] = a;
        }
        return map;
    },

    _createDriftItem: function(baselineArtifact, targetArtifact, changeType, baselineId, targetId) {
        var artifact = baselineArtifact || targetArtifact;
        var diff = this.generateDiff(baselineArtifact, targetArtifact);
        var riskScore = this.calculateRiskScore({
            artifact_type: artifact.type,
            change_type: changeType
        });

        return {
            snapshot_baseline: baselineId,
            snapshot_target: targetId,
            artifact_type: artifact.type,
            artifact_name: artifact.name || '',
            artifact_sys_id: artifact.sys_id || '',
            risk_score: riskScore,
            change_type: changeType,
            diff_summary: JSON.stringify(diff),
            ai_analysis: '',
            remediation_status: 'pending',
            detected_at: new GlideDateTime().toString()
        };
    },

    _saveDriftItem: function(item) {
        try {
            // Deduplication: skip if a matching drift item already exists
            var existing = new GlideRecord('x_csync_drift_item');
            existing.addQuery('snapshot_baseline', item.snapshot_baseline);
            existing.addQuery('snapshot_target', item.snapshot_target);
            existing.addQuery('artifact_type', item.artifact_type);
            existing.addQuery('artifact_name', item.artifact_name);
            existing.setLimit(1);
            existing.query();
            if (existing.next()) {
                return;
            }

            var di = new GlideRecord('x_csync_drift_item');
            di.initialize();
            di.setValue('snapshot_baseline', item.snapshot_baseline);
            di.setValue('snapshot_target', item.snapshot_target);
            di.setValue('artifact_type', item.artifact_type);
            di.setValue('artifact_name', item.artifact_name);
            di.setValue('artifact_sys_id', item.artifact_sys_id);
            di.setValue('risk_score', item.risk_score);
            di.setValue('change_type', item.change_type);
            di.setValue('diff_summary', item.diff_summary);
            di.setValue('ai_analysis', item.ai_analysis || '');
            di.setValue('remediation_status', item.remediation_status);
            di.setValue('detected_at', item.detected_at || '');
            di.setWorkflow(false);
            di.insert();
        } catch (e) {
            gs.error('ConfigSyncEngine._saveDriftItem failed: ' + e.message);
        }
    },

    _countDriftItems: function(snapshotId) {
        var di = new GlideRecord('x_csync_drift_item');
        di.addQuery('snapshot_baseline', snapshotId);
        di.addOrCondition('snapshot_target', snapshotId);
        di.query();
        return di.getRowCount();
    },

    type: 'ConfigSyncEngine'
};
