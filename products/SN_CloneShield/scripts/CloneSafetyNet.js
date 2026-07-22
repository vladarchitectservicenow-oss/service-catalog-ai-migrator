// CloneShield — CloneSafetyNet Orchestrator
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Top-level orchestrator: detects clone events, coordinates snapshots,
// manages restore lifecycle, and serves dashboard data.
// @class CloneSafetyNet @namespace x_snc_cs

var CloneSafetyNet = Class.create();
CloneSafetyNet.prototype = {
    initialize: function() {
        this.engine = new SnapshotEngine();
    },

    /**
     * Entry point from scheduled job. Polls sys_clone_history for new clone events.
     * If a clone is detected (status='In Progress' within last 5 min), triggers
     * the full snapshot sequence across all artifact types.
     * @returns {Object} { detected: boolean, event_id: string|null, snapshot_count: number }
     */
    snapshotAll: function() {
        var result = { detected: false, event_id: null, snapshot_count: 0 };
        try {
            var gr = new GlideRecord('sys_clone_history');
            gr.addQuery('status', 'In Progress');
            gr.addQuery('sys_created_on', '>=', gs.minutesAgo(5));
            gr.setLimit(1);
            gr.query();
            if (!gr.next()) {
                return result;
            }
            result.detected = true;

            var eventGr = new GlideRecord('x_snc_cs_clone_event');
            eventGr.initialize();
            eventGr.setValue('detected_on', new GlideDateTime());
            eventGr.setValue('clone_type', this._inferCloneType(gr));
            eventGr.setValue('status', 'snapshotting');
            eventGr.setValue('instance_name', gs.getProperty('instance_name', ''));
            var eventId = eventGr.insert();
            result.event_id = eventId;

            var count = 0;
            count += this.engine.captureUpdateSets(eventId);
            count += this.engine.captureFlows(eventId);
            count += this.engine.captureScripts(eventId);
            count += this.engine.captureUIPolicies(eventId);
            count += this.engine.captureBusinessRules(eventId);
            count += this.engine.captureUIBuilder(eventId);
            result.snapshot_count = count;

            eventGr.setValue('snapshot_count', count);
            eventGr.setValue('status', 'completed');
            eventGr.setValue('completed_on', new GlideDateTime());
            eventGr.update();
        } catch (e) {
            gs.error('CloneSafetyNet.snapshotAll failed: ' + e.message);
            if (result.event_id) {
                var failGr = new GlideRecord('x_snc_cs_clone_event');
                if (failGr.get(result.event_id)) {
                    failGr.setValue('status', 'failed');
                    failGr.update();
                }
            }
        }
        return result;
    },

    /**
     * Restore a single artifact from its snapshot.
     * @param {string} snapshotId - sys_id of the snapshot record
     * @param {string} mode - 'overwrite', 'merge', or 'dry_run'
     * @returns {Object} { status: string, conflicts: Array, restored_count: number, errors: Array }
     */
    restoreArtifact: function(snapshotId, mode) {
        var result = { status: 'ok', conflicts: [], restored_count: 0, errors: [] };
        try {
            var snapGr = new GlideRecord('x_snc_cs_snapshot');
            if (!snapGr.get(snapshotId)) {
                result.status = 'error';
                result.errors.push('Snapshot not found: ' + snapshotId);
                return result;
            }

            var artifactType = snapGr.getValue('artifact_type');
            var conflicts = this.engine.detectConflicts(snapshotId);
            result.conflicts = conflicts;

            if (mode === 'dry_run') {
                result.status = 'dry_run';
                return result;
            }

            if (conflicts.length > 0 && mode === 'overwrite') {
                result.status = 'conflict_warning';
            }

            var restored = false;
            if (artifactType === 'update_set') {
                restored = this.engine.restoreUpdateSet(snapGr, mode);
            } else if (artifactType === 'flow_designer') {
                restored = this.engine.restoreFlow(snapGr, mode);
            } else {
                restored = this.engine.restoreGeneric(snapGr, mode);
            }

            if (restored) {
                result.restored_count = 1;
                snapGr.setValue('status', 'restored');
                snapGr.setValue('restored_on', new GlideDateTime());
                snapGr.update();
            } else {
                result.status = 'error';
                result.errors.push('Restore failed for snapshot: ' + snapshotId);
            }
        } catch (e) {
            result.status = 'error';
            result.errors.push(e.message);
            gs.error('CloneSafetyNet.restoreArtifact failed: ' + e.message);
        }
        return result;
    },

    /**
     * Dashboard data provider. Returns structured data based on action parameter.
     * @param {string} action - 'history', 'conflicts', 'calendar', or 'health'
     * @returns {Object} Action-specific response payload
     */
    getStatus: function(action) {
        var result = {};
        try {
            switch (action) {
                case 'history':
                    result.snapshots = this._getSnapshotHistory();
                    result.total_count = result.snapshots.length;
                    break;
                case 'conflicts':
                    result.conflicts = this._getUnresolvedConflicts();
                    result.unresolved_count = result.conflicts.length;
                    break;
                case 'calendar':
                    result.upcoming_clones = this._getUpcomingClones();
                    result.next_clone = result.upcoming_clones.length > 0 ? result.upcoming_clones[0] : null;
                    break;
                case 'health':
                    result.storage_used = this._getStorageUsed();
                    result.storage_limit = gs.getProperty('x_snc_cs.storage_limit', 104857600);
                    result.snapshot_count = this._getSnapshotCount();
                    result.last_snapshot = this._getLastSnapshotTime();
                    break;
                default:
                    result.error = 'Unknown action: ' + action;
                    break;
            }
        } catch (e) {
            result.error = e.message;
            gs.error('CloneSafetyNet.getStatus failed: ' + e.message);
        }
        return result;
    },

    /**
     * Export snapshots as downloadable XML.
     * @param {Array} snapshotIds - Array of snapshot sys_ids
     * @returns {string} Combined XML string of all requested snapshots
     */
    exportSnapshots: function(snapshotIds) {
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<snapshots>\n';
        try {
            for (var i = 0; i < snapshotIds.length; i++) {
                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                if (snapGr.get(snapshotIds[i])) {
                    xml += '  <snapshot>\n';
                    xml += '    <sys_id>' + snapGr.getValue('sys_id') + '</sys_id>\n';
                    xml += '    <name>' + this._xmlEscape(snapGr.getValue('name')) + '</name>\n';
                    xml += '    <artifact_type>' + snapGr.getValue('artifact_type') + '</artifact_type>\n';
                    xml += '    <source_table>' + snapGr.getValue('source_table') + '</source_table>\n';
                    xml += '    <source_sys_id>' + snapGr.getValue('source_sys_id') + '</source_sys_id>\n';
                    xml += '    <content><![CDATA[' + (snapGr.getValue('content_xml') || '') + (snapGr.getValue('content_json') || '') + ']]></content>\n';
                    xml += '    <checksum>' + snapGr.getValue('checksum') + '</checksum>\n';
                    xml += '  </snapshot>\n';

                    snapGr.setValue('status', 'exported');
                    snapGr.update();
                }
            }
        } catch (e) {
            gs.error('CloneSafetyNet.exportSnapshots failed: ' + e.message);
        }
        xml += '</snapshots>';
        return xml;
    },

    /**
     * Manual snapshot trigger from dashboard.
     * @param {Array} artifactTypes - Array of artifact type strings to snapshot
     * @returns {Object} { snapshot_id: string, artifact_count: number, size_bytes: number }
     */
    manualSnapshot: function(artifactTypes) {
        var result = { snapshot_id: null, artifact_count: 0, size_bytes: 0 };
        try {
            var eventGr = new GlideRecord('x_snc_cs_clone_event');
            eventGr.initialize();
            eventGr.setValue('detected_on', new GlideDateTime());
            eventGr.setValue('clone_type', 'full');
            eventGr.setValue('status', 'snapshotting');
            eventGr.setValue('instance_name', gs.getProperty('instance_name', ''));
            var eventId = eventGr.insert();
            result.snapshot_id = eventId;

            var count = 0;
            for (var i = 0; i < artifactTypes.length; i++) {
                var type = artifactTypes[i];
                var captured = 0;
                if (type === 'update_set') {
                    captured = this.engine.captureUpdateSets(eventId);
                } else if (type === 'flow_designer') {
                    captured = this.engine.captureFlows(eventId);
                } else if (type === 'script_include') {
                    captured = this.engine.captureScripts(eventId);
                } else if (type === 'ui_policy') {
                    captured = this.engine.captureUIPolicies(eventId);
                } else if (type === 'business_rule') {
                    captured = this.engine.captureBusinessRules(eventId);
                } else if (type === 'ui_builder_page' || type === 'ui_builder_widget') {
                    captured = this.engine.captureUIBuilder(eventId);
                }
                count += captured;
            }
            result.artifact_count = count;

            eventGr.setValue('snapshot_count', count);
            eventGr.setValue('status', 'completed');
            eventGr.setValue('completed_on', new GlideDateTime());
            eventGr.update();
        } catch (e) {
            gs.error('CloneSafetyNet.manualSnapshot failed: ' + e.message);
        }
        return result;
    },

    // ─── Private helpers ────────────────────────────────────────────

    _inferCloneType: function(cloneHistoryGr) {
        var type = cloneHistoryGr.getValue('clone_type') || '';
        if (type) return type.toLowerCase();
        return 'full';
    },

    _getSnapshotHistory: function() {
        var snapshots = [];
        var gr = new GlideRecord('x_snc_cs_snapshot');
        gr.addQuery('sys_created_on', '>=', gs.daysAgo(30));
        gr.orderByDesc('sys_created_on');
        gr.setLimit(100);
        gr.query();
        while (gr.next()) {
            snapshots.push({
                sys_id: gr.getValue('sys_id'),
                name: gr.getValue('name'),
                artifact_type: gr.getValue('artifact_type'),
                status: gr.getValue('status'),
                created_by: gr.getValue('created_by'),
                size_bytes: parseInt(gr.getValue('size_bytes'), 10) || 0,
                created_on: gr.getValue('sys_created_on')
            });
        }
        return snapshots;
    },

    _getUnresolvedConflicts: function() {
        var conflicts = [];
        var gr = new GlideRecord('x_snc_cs_snapshot');
        gr.addQuery('status', 'active');
        gr.setLimit(50);
        gr.query();
        while (gr.next()) {
            var c = this.engine.detectConflicts(gr.getValue('sys_id'));
            if (c.length > 0) {
                conflicts.push({
                    snapshot_id: gr.getValue('sys_id'),
                    snapshot_name: gr.getValue('name'),
                    artifact_type: gr.getValue('artifact_type'),
                    conflict_count: c.length,
                    details: c
                });
            }
        }
        return conflicts;
    },

    _getUpcomingClones: function() {
        var clones = [];
        var gr = new GlideRecord('sys_clone_schedule');
        gr.addQuery('active', true);
        gr.orderBy('next_run');
        gr.setLimit(10);
        gr.query();
        while (gr.next()) {
            clones.push({
                name: gr.getValue('name'),
                next_run: gr.getValue('next_run'),
                clone_type: gr.getValue('type') || 'full',
                target_instance: gr.getValue('target_instance') || ''
            });
        }
        return clones;
    },

    _getStorageUsed: function() {
        var ga = new GlideAggregate('x_snc_cs_snapshot');
        ga.addAggregate('SUM', 'size_bytes');
        ga.addQuery('status', 'active');
        ga.query();
        if (ga.next()) {
            return parseInt(ga.getAggregate('SUM', 'size_bytes'), 10) || 0;
        }
        return 0;
    },

    _getSnapshotCount: function() {
        var ga = new GlideAggregate('x_snc_cs_snapshot');
        ga.addAggregate('COUNT');
        ga.addQuery('status', 'active');
        ga.query();
        if (ga.next()) {
            return parseInt(ga.getAggregate('COUNT'), 10) || 0;
        }
        return 0;
    },

    _getLastSnapshotTime: function() {
        var gr = new GlideRecord('x_snc_cs_clone_event');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('completed_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('completed_on');
        }
        return null;
    },

    _xmlEscape: function(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    },

    type: 'CloneSafetyNet'
};
