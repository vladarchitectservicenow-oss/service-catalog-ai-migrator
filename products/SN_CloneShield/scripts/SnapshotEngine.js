// CloneShield — SnapshotEngine Serializer/Deserializer
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Low-level serialization and deserialization of ServiceNow artifacts.
// Knows the XML/JSON structure of each artifact type.
// @class SnapshotEngine @namespace x_snc_cs

var SnapshotEngine = Class.create();
SnapshotEngine.prototype = {
    initialize: function() {},

    /**
     * Capture all in-progress update sets as combined XML.
     * @param {string} eventId - CloneEvent sys_id to associate snapshots with
     * @returns {number} Count of snapshots created
     */
    captureUpdateSets: function(eventId) {
        var count = 0;
        try {
            var usGr = new GlideRecord('sys_update_set');
            usGr.addQuery('state', 1);  // 1 = 'in progress' (integer choice value)
            usGr.query();
            while (usGr.next()) {
                var usSysId = usGr.getValue('sys_id');
                var usName = usGr.getValue('name');

                var xmlGr = new GlideRecord('sys_update_xml');
                xmlGr.addQuery('update_set', usSysId);
                xmlGr.query();

                var xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<update_set name="' + this._xmlEscape(usName) + '">\n';
                while (xmlGr.next()) {
                    xmlContent += '  <record>\n';
                    xmlContent += '    <name>' + this._xmlEscape(xmlGr.getValue('name') || '') + '</name>\n';
                    xmlContent += '    <type>' + this._xmlEscape(xmlGr.getValue('type') || '') + '</type>\n';
                    xmlContent += '    <payload><![CDATA[' + (xmlGr.getValue('payload') || '') + ']]></payload>\n';
                    xmlContent += '  </record>\n';
                }
                xmlContent += '</update_set>';

                var checksum = this.computeChecksum(xmlContent);
                var sizeBytes = xmlContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'Update Set: ' + usName);
                snapGr.setValue('artifact_type', 'update_set');
                snapGr.setValue('source_table', 'sys_update_xml');
                snapGr.setValue('source_sys_id', usSysId);
                snapGr.setValue('content_xml', xmlContent.substring(0, 4000));
                if (xmlContent.length > 4000) {
                    snapGr.setValue('content_json', xmlContent.substring(4000, 8000));
                }
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureUpdateSets failed: ' + e.message);
        }
        return count;
    },

    /**
     * Capture draft Flow Designer flows as serialized JSON.
     * @param {string} eventId - CloneEvent sys_id
     * @returns {number} Count of snapshots created
     */
    captureFlows: function(eventId) {
        var count = 0;
        try {
            var flowGr = new GlideRecord('sys_hub_flow');
            flowGr.addQuery('status', 0);  // 0 = 'draft' (integer choice value)
            flowGr.query();
            while (flowGr.next()) {
                var flowSysId = flowGr.getValue('sys_id');
                var flowName = flowGr.getValue('name');

                var flowData = {
                    name: flowName,
                    description: flowGr.getValue('description') || '',
                    trigger_type: flowGr.getValue('trigger_type') || '',
                    active: flowGr.getValue('active'),
                    category: flowGr.getValue('category') || ''
                };

                var versionGr = new GlideRecord('sys_hub_flow_version');
                versionGr.addQuery('flow', flowSysId);
                versionGr.orderByDesc('sys_created_on');
                versionGr.setLimit(1);
                versionGr.query();
                if (versionGr.next()) {
                    flowData.snapshot = versionGr.getValue('snapshot') || '';
                    flowData.actions = versionGr.getValue('actions') || '';
                }

                var jsonContent = JSON.stringify(flowData);
                var checksum = this.computeChecksum(jsonContent);
                var sizeBytes = jsonContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'Flow: ' + flowName);
                snapGr.setValue('artifact_type', 'flow_designer');
                snapGr.setValue('source_table', 'sys_hub_flow');
                snapGr.setValue('source_sys_id', flowSysId);
                snapGr.setValue('content_json', jsonContent.substring(0, 4000));
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureFlows failed: ' + e.message);
        }
        return count;
    },

    /**
     * Capture modified Script Includes (source + metadata).
     * @param {string} eventId - CloneEvent sys_id
     * @returns {number} Count of snapshots created
     */
    captureScripts: function(eventId) {
        var count = 0;
        try {
            var siGr = new GlideRecord('sys_script_include');
            siGr.addQuery('sys_updated_on', '>=', gs.daysAgo(7));
            siGr.query();
            while (siGr.next()) {
                var siSysId = siGr.getValue('sys_id');
                var siName = siGr.getValue('name');

                var siData = {
                    name: siName,
                    description: siGr.getValue('description') || '',
                    script: siGr.getValue('script') || '',
                    api_name: siGr.getValue('api_name') || '',
                    access: siGr.getValue('access') || '',
                    active: siGr.getValue('active')
                };

                var jsonContent = JSON.stringify(siData);
                var checksum = this.computeChecksum(jsonContent);
                var sizeBytes = jsonContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'Script Include: ' + siName);
                snapGr.setValue('artifact_type', 'script_include');
                snapGr.setValue('source_table', 'sys_script_include');
                snapGr.setValue('source_sys_id', siSysId);
                snapGr.setValue('content_json', jsonContent.substring(0, 4000));
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureScripts failed: ' + e.message);
        }
        return count;
    },

    /**
     * Capture modified UI Policies (policy + actions).
     * @param {string} eventId - CloneEvent sys_id
     * @returns {number} Count of snapshots created
     */
    captureUIPolicies: function(eventId) {
        var count = 0;
        try {
            var policyGr = new GlideRecord('sys_ui_policy');
            policyGr.addQuery('sys_updated_on', '>=', gs.daysAgo(7));
            policyGr.query();
            while (policyGr.next()) {
                var policySysId = policyGr.getValue('sys_id');
                var policyName = policyGr.getValue('short_description') || policyGr.getValue('name') || '';

                var policyData = {
                    name: policyName,
                    table: policyGr.getValue('table') || '',
                    active: policyGr.getValue('active'),
                    on_load: policyGr.getValue('on_load'),
                    reverse_if_false: policyGr.getValue('reverse_if_false'),
                    conditions: policyGr.getValue('conditions') || '',
                    script_true: policyGr.getValue('script_true') || '',
                    script_false: policyGr.getValue('script_false') || '',
                    actions: []
                };

                var actionGr = new GlideRecord('sys_ui_policy_action');
                actionGr.addQuery('ui_policy', policySysId);
                actionGr.query();
                while (actionGr.next()) {
                    policyData.actions.push({
                        field: actionGr.getValue('field') || '',
                        visible: actionGr.getValue('visible'),
                        mandatory: actionGr.getValue('mandatory'),
                        read_only: actionGr.getValue('read_only')
                    });
                }

                var jsonContent = JSON.stringify(policyData);
                var checksum = this.computeChecksum(jsonContent);
                var sizeBytes = jsonContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'UI Policy: ' + policyName);
                snapGr.setValue('artifact_type', 'ui_policy');
                snapGr.setValue('source_table', 'sys_ui_policy');
                snapGr.setValue('source_sys_id', policySysId);
                snapGr.setValue('content_json', jsonContent.substring(0, 4000));
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureUIPolicies failed: ' + e.message);
        }
        return count;
    },

    /**
     * Capture modified Business Rules.
     * @param {string} eventId - CloneEvent sys_id
     * @returns {number} Count of snapshots created
     */
    captureBusinessRules: function(eventId) {
        var count = 0;
        try {
            var brGr = new GlideRecord('sys_script');
            brGr.addQuery('sys_updated_on', '>=', gs.daysAgo(7));
            brGr.addQuery('type', 'script');
            brGr.query();
            while (brGr.next()) {
                var brSysId = brGr.getValue('sys_id');
                var brName = brGr.getValue('name') || '';

                var brData = {
                    name: brName,
                    description: brGr.getValue('description') || '',
                    table: brGr.getValue('collection') || '',
                    active: brGr.getValue('active'),
                    when: brGr.getValue('when') || '',
                    condition: brGr.getValue('condition') || '',
                    script: brGr.getValue('script') || '',
                    order: brGr.getValue('order') || 0
                };

                var jsonContent = JSON.stringify(brData);
                var checksum = this.computeChecksum(jsonContent);
                var sizeBytes = jsonContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'Business Rule: ' + brName);
                snapGr.setValue('artifact_type', 'business_rule');
                snapGr.setValue('source_table', 'sys_script');
                snapGr.setValue('source_sys_id', brSysId);
                snapGr.setValue('content_json', jsonContent.substring(0, 4000));
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureBusinessRules failed: ' + e.message);
        }
        return count;
    },

    /**
     * Capture modified UI Builder pages and widgets.
     * @param {string} eventId - CloneEvent sys_id
     * @returns {number} Count of snapshots created
     */
    captureUIBuilder: function(eventId) {
        var count = 0;
        try {
            var pageGr = new GlideRecord('sys_ux_page');
            pageGr.addQuery('sys_updated_on', '>=', gs.daysAgo(7));
            pageGr.query();
            while (pageGr.next()) {
                var pageSysId = pageGr.getValue('sys_id');
                var pageName = pageGr.getValue('name') || '';

                var pageData = {
                    name: pageName,
                    description: pageGr.getValue('description') || '',
                    category: pageGr.getValue('category') || '',
                    config: pageGr.getValue('config') || ''
                };

                var jsonContent = JSON.stringify(pageData);
                var checksum = this.computeChecksum(jsonContent);
                var sizeBytes = jsonContent.length;

                var snapGr = new GlideRecord('x_snc_cs_snapshot');
                snapGr.initialize();
                snapGr.setValue('name', 'UI Builder Page: ' + pageName);
                snapGr.setValue('artifact_type', 'ui_builder_page');
                snapGr.setValue('source_table', 'sys_ux_page');
                snapGr.setValue('source_sys_id', pageSysId);
                snapGr.setValue('content_json', jsonContent.substring(0, 4000));
                snapGr.setValue('clone_event', eventId);
                snapGr.setValue('status', 'active');
                snapGr.setValue('created_by', gs.getUserName());
                snapGr.setValue('checksum', checksum);
                snapGr.setValue('size_bytes', sizeBytes);
                snapGr.insert();
                count++;
            }
        } catch (e) {
            gs.error('SnapshotEngine.captureUIBuilder failed: ' + e.message);
        }
        return count;
    },

    /**
     * Restore an update set from its snapshot.
     * @param {GlideRecord} snapGr - Snapshot record (already fetched)
     * @param {string} mode - 'overwrite' or 'merge'
     * @returns {boolean} True if restore succeeded
     */
    restoreUpdateSet: function(snapGr, mode) {
        try {
            var sourceSysId = snapGr.getValue('source_sys_id');
            var contentXml = snapGr.getValue('content_xml') || '';
            if (snapGr.getValue('content_json')) {
                contentXml += snapGr.getValue('content_json');
            }

            if (mode === 'overwrite') {
                var delGr = new GlideRecord('sys_update_xml');
                delGr.addQuery('update_set', sourceSysId);
                delGr.query();
                while (delGr.next()) {
                    delGr.deleteRecord();
                }
            }

            var xmlDoc = new XMLDocument(contentXml);
            var records = xmlDoc.getDocumentElement().getElementsByTagName('record');
            for (var i = 0; i < records.getLength(); i++) {
                var record = records.item(i);
                var recName = this._getElementText(record, 'name');
                var recType = this._getElementText(record, 'type');
                var payload = this._getElementText(record, 'payload');

                if (mode === 'merge') {
                    var existGr = new GlideRecord('sys_update_xml');
                    existGr.addQuery('update_set', sourceSysId);
                    existGr.addQuery('name', recName);
                    existGr.addQuery('type', recType);
                    existGr.setLimit(1);
                    existGr.query();
                    if (existGr.next()) {
                        continue;
                    }
                }

                var newGr = new GlideRecord('sys_update_xml');
                newGr.initialize();
                newGr.setValue('update_set', sourceSysId);
                newGr.setValue('name', recName);
                newGr.setValue('type', recType);
                newGr.setValue('payload', payload);
                newGr.insert();
            }
            return true;
        } catch (e) {
            gs.error('SnapshotEngine.restoreUpdateSet failed: ' + e.message);
            return false;
        }
    },

    /**
     * Restore a Flow Designer flow from its snapshot.
     * @param {GlideRecord} snapGr - Snapshot record
     * @param {string} mode - 'overwrite' or 'merge'
     * @returns {boolean} True if restore succeeded
     */
    restoreFlow: function(snapGr, mode) {
        try {
            var sourceSysId = snapGr.getValue('source_sys_id');
            var jsonContent = snapGr.getValue('content_json') || '';
            var flowData = JSON.parse(jsonContent);

            var flowGr = new GlideRecord('sys_hub_flow');
            if (!flowGr.get(sourceSysId)) {
                flowGr.initialize();
                flowGr.setValue('name', flowData.name);
                flowGr.setValue('description', flowData.description);
                flowGr.setValue('trigger_type', flowData.trigger_type);
                flowGr.setValue('active', flowData.active);
                flowGr.setValue('category', flowData.category);
                var newFlowId = flowGr.insert();
                sourceSysId = newFlowId;
            } else if (mode === 'overwrite') {
                flowGr.setValue('name', flowData.name);
                flowGr.setValue('description', flowData.description);
                flowGr.setValue('trigger_type', flowData.trigger_type);
                flowGr.setValue('active', flowData.active);
                flowGr.setValue('category', flowData.category);
                flowGr.update();
            }

            // Restore flow version (snapshot + actions) — the actual flow logic
            if (flowData.snapshot || flowData.actions) {
                var versionGr = new GlideRecord('sys_hub_flow_version');
                versionGr.addQuery('flow', sourceSysId);
                versionGr.orderByDesc('sys_created_on');
                versionGr.setLimit(1);
                versionGr.query();
                if (versionGr.next()) {
                    if (flowData.snapshot) { versionGr.setValue('snapshot', flowData.snapshot); }
                    if (flowData.actions) { versionGr.setValue('actions', flowData.actions); }
                    versionGr.update();
                } else {
                    versionGr.initialize();
                    versionGr.setValue('flow', sourceSysId);
                    if (flowData.snapshot) { versionGr.setValue('snapshot', flowData.snapshot); }
                    if (flowData.actions) { versionGr.setValue('actions', flowData.actions); }
                    versionGr.insert();
                }
            }

            return true;
        } catch (e) {
            gs.error('SnapshotEngine.restoreFlow failed: ' + e.message);
            return false;
        }
    },

    /**
     * Generic restore for non-XML artifact types (scripts, UI policies, BRs, UI Builder).
     * Writes JSON content back to the source table.
     * @param {GlideRecord} snapGr - Snapshot record
     * @param {string} mode - 'overwrite' or 'merge'
     * @returns {boolean} True if restore succeeded
     */
    restoreGeneric: function(snapGr, mode) {
        try {
            var sourceTable = snapGr.getValue('source_table');
            var sourceSysId = snapGr.getValue('source_sys_id');
            var jsonContent = snapGr.getValue('content_json') || '';
            var data = JSON.parse(jsonContent);

            var targetGr = new GlideRecord(sourceTable);
            if (targetGr.get(sourceSysId)) {
                if (mode === 'overwrite') {
                    for (var key in data) {
                        if (data.hasOwnProperty(key) && key !== 'actions') {
                            targetGr.setValue(key, data[key]);
                        }
                    }
                    targetGr.update();

                    // Restore UI Policy actions separately
                    if (data.actions && data.actions.length > 0 && sourceTable === 'sys_ui_policy') {
                        this._restoreUIPolicyActions(sourceSysId, data.actions, mode);
                    }
                }
            } else {
                targetGr.initialize();
                for (var k in data) {
                    if (data.hasOwnProperty(k) && k !== 'actions') {
                        targetGr.setValue(k, data[k]);
                    }
                }
                var newId = targetGr.insert();

                // Restore UI Policy actions for newly created policy
                if (data.actions && data.actions.length > 0 && sourceTable === 'sys_ui_policy') {
                    this._restoreUIPolicyActions(newId, data.actions, mode);
                }
            }
            return true;
        } catch (e) {
            gs.error('SnapshotEngine.restoreGeneric failed: ' + e.message);
            return false;
        }
    },

    /**
     * Restore UI Policy actions from snapshot data.
     * @param {string} policySysId - sys_id of the UI Policy
     * @param {Array} actions - Array of action objects from snapshot
     * @param {string} mode - 'overwrite' or 'merge'
     * @private
     */
    _restoreUIPolicyActions: function(policySysId, actions, mode) {
        if (mode === 'overwrite') {
            var delGr = new GlideRecord('sys_ui_policy_action');
            delGr.addQuery('ui_policy', policySysId);
            delGr.query();
            while (delGr.next()) {
                delGr.deleteRecord();
            }
        }

        for (var i = 0; i < actions.length; i++) {
            var action = actions[i];
            var actGr = new GlideRecord('sys_ui_policy_action');
            actGr.initialize();
            actGr.setValue('ui_policy', policySysId);
            actGr.setValue('field', action.field || '');
            actGr.setValue('visible', action.visible);
            actGr.setValue('mandatory', action.mandatory);
            actGr.setValue('read_only', action.read_only);
            actGr.insert();
        }
    },

    /**
     * Detect conflicts between a snapshot and the current state of the artifact.
     * @param {string} snapshotId - sys_id of the snapshot
     * @returns {Array} Array of conflict objects { field, snapshot_value, current_value }
     */
    detectConflicts: function(snapshotId) {
        var conflicts = [];
        try {
            var snapGr = new GlideRecord('x_snc_cs_snapshot');
            if (!snapGr.get(snapshotId)) {
                return conflicts;
            }

            var sourceTable = snapGr.getValue('source_table');
            var sourceSysId = snapGr.getValue('source_sys_id');
            var storedChecksum = snapGr.getValue('checksum');

            var currentGr = new GlideRecord(sourceTable);
            if (!currentGr.get(sourceSysId)) {
                conflicts.push({
                    field: '_existence',
                    snapshot_value: 'exists',
                    current_value: 'deleted'
                });
                return conflicts;
            }

            var jsonContent = snapGr.getValue('content_json') || '';
            if (!jsonContent) {
                var xmlContent = snapGr.getValue('content_xml') || '';
                var currentChecksum = this.computeChecksum(xmlContent);
                if (currentChecksum !== storedChecksum) {
                    conflicts.push({
                        field: '_content',
                        snapshot_value: storedChecksum,
                        current_value: currentChecksum
                    });
                }
                return conflicts;
            }

            var snapData = JSON.parse(jsonContent);
            for (var key in snapData) {
                if (snapData.hasOwnProperty(key) && key !== 'actions') {
                    var currentVal = currentGr.getValue(key) || '';
                    var snapVal = snapData[key];
                    if (String(currentVal) !== String(snapVal)) {
                        conflicts.push({
                            field: key,
                            snapshot_value: String(snapVal),
                            current_value: String(currentVal)
                        });
                    }
                }
            }
        } catch (e) {
            gs.error('SnapshotEngine.detectConflicts failed: ' + e.message);
        }
        return conflicts;
    },

    /**
     * Compute SHA-256 checksum of content for conflict detection.
     * Uses GlideDigest for SHA-256 hashing.
     * @param {string} content - Content to hash
     * @returns {string} Hex-encoded SHA-256 hash
     */
    computeChecksum: function(content) {
        try {
            var digest = new GlideDigest();
            return digest.sha256(content || '');
        } catch (e) {
            gs.error('SnapshotEngine.computeChecksum failed: ' + e.message);
            return '';
        }
    },

    // ─── Private helpers ────────────────────────────────────────────

    _xmlEscape: function(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    },

    _getElementText: function(parent, tagName) {
        var elements = parent.getElementsByTagName(tagName);
        if (elements && elements.getLength() > 0) {
            return elements.item(0).getTextContent() || '';
        }
        return '';
    },

    type: 'SnapshotEngine'
};
