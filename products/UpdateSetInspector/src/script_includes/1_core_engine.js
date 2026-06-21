/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * UpdateSet Inspector — Core Engine
 * Consolidates: USIContentParser, USICollisionDetector, USIDependencyAnalyzer, USIRiskScorer
 * These four components form the analysis core — parsing, collision detection,
 * dependency mapping, and risk scoring of ServiceNow update sets.
 */

// ============================================================
// USIContentParser — parses sys_update_xml payloads into structured data
// ============================================================
var USIContentParser = Class.create();
USIContentParser.prototype = {
    initialize: function() {},

    /**
     * Parse all sys_update_xml records for a given update set
     * @param {String} updateSetSysId - sys_id of the sys_update_set record
     * @return {Object} { ok: boolean, entries: Array, count: number, error: String }
     */
    parseUpdateSet: function(updateSetSysId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        var entries = [];
        try {
            var gr = new GlideRecord('sys_update_xml');
            gr.addQuery('update_set', updateSetSysId);
            gr.orderBy('name');
            gr.query();
            while (gr.next()) {
                var entry = this._parseEntry(gr);
                if (entry) {
                    entries.push(entry);
                }
            }
            return { ok: true, entries: entries, count: entries.length };
        } catch (ex) {
            gs.log('USIContentParser.parseUpdateSet error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, entries: [], count: 0 };
        }
    },

    /**
     * Parse a single sys_update_xml GlideRecord into structured data
     * @param {GlideRecord} gr - current sys_update_xml record
     * @return {Object|null} structured entry
     */
    _parseEntry: function(gr) {
        try {
            var payload = gr.getValue('payload');
            if (!payload) {
                return null;
            }
            var doc = new XMLDocument2();
            doc.parse(payload);
            var tableName = this._getNodeText(doc, '//table');
            var recordName = this._getNodeText(doc, '//name');
            var action = this._getNodeText(doc, '//action');
            var recordSysId = this._getNodeText(doc, '//sys_id');
            var fields = this._extractFields(doc, payload);
            return {
                name: gr.getValue('name'),
                target_table: tableName,
                record_name: recordName,
                action: action,
                record_sys_id: recordSysId,
                fields: fields,
                type: this._classifyRecordType(tableName)
            };
        } catch (ex) {
            gs.log('USIContentParser._parseEntry error: ' + ex.message, 'USI');
            return null;
        }
    },

    /**
     * Safely get node text from XMLDocument2
     */
    _getNodeText: function(doc, xpath) {
        try {
            var node = doc.selectNode(xpath);
            if (node) {
                return node.getNodeValue();
            }
        } catch (e) {
            // xpath not found — return empty
        }
        return '';
    },

    /**
     * Extract field-level changes from the payload XML
     * Looks for child elements within the <payload> root
     */
    _extractFields: function(doc, rawPayload) {
        var fields = [];
        try {
            // XMLDocument2 — iterate top-level child elements of root
            var root = doc.getDocumentElement();
            if (!root) {
                return fields;
            }
            var children = root.getChildNodes();
            for (var i = 0; i < children.size(); i++) {
                var child = children.get(i);
                var nodeName = child.getNodeName();
                // Skip metadata nodes: table, name, action, sys_id, sys_scope, sys_updated_by, etc.
                if (nodeName === 'table' || nodeName === 'name' || nodeName === 'action' ||
                    nodeName === 'sys_id' || nodeName === 'sys_scope' || nodeName === 'sys_updated_by' ||
                    nodeName === 'sys_updated_on' || nodeName === 'sys_created_on' || nodeName === 'sys_created_by' ||
                    nodeName === 'sys_mod_count' || nodeName === 'sys_package' || nodeName === 'sys_policy') {
                    continue;
                }
                if (nodeName.charAt(0) === '#') {
                    continue; // skip text nodes, comments
                }
                var nodeValue = child.getTextContent();
                fields.push({
                    field: nodeName,
                    value: nodeValue ? nodeValue.substring(0, 500) : '',
                    is_script: this._isScriptField(nodeName, nodeValue)
                });
            }
        } catch (ex) {
            gs.log('USIContentParser._extractFields error: ' + ex.message, 'USI');
        }
        return fields;
    },

    /**
     * Determine if a field contains script content
     */
    _isScriptField: function(fieldName, value) {
        var scriptFields = ['script', 'active', 'condition', 'filter_condition', 'advanced_condition',
                           'message', 'description', 'css', 'html', 'template'];
        for (var i = 0; i < scriptFields.length; i++) {
            if (fieldName.indexOf(scriptFields[i]) > -1) {
                return true;
            }
        }
        return false;
    },

    /**
     * Classify a record type for risk scoring
     */
    _classifyRecordType: function(tableName) {
        if (!tableName) {
            return 'unknown';
        }
        var redTables = ['sys_security_acl', 'sys_script', 'sys_script_include',
                         'sys_ui_action', 'sys_metadata', 'sys_transform_script',
                         'sys_transform_entry', 'sys_processor', 'sys_validation_script'];
        var yellowTables = ['sys_ui_policy', 'sys_script_client', 'sys_ui_form_section',
                            'sysevent_email', 'sysevent_email_action', 'sys_notification',
                            'sys_ui_page', 'sys_ui_macro', 'sys_ui_script'];
        var greenTables = ['sys_ui_list', 'sys_home', 'sys_ui_css', 'sys_ui_palette',
                           'sys_ui_chart', 'sys_ui_related_list', 'sys_ui_context_menu'];
        var i;
        for (i = 0; i < redTables.length; i++) {
            if (tableName === redTables[i]) {
                return 'red';
            }
        }
        for (i = 0; i < yellowTables.length; i++) {
            if (tableName === yellowTables[i]) {
                return 'yellow';
            }
        }
        for (i = 0; i < greenTables.length; i++) {
            if (tableName === greenTables[i]) {
                return 'green';
            }
        }
        return 'unknown';
    },

    type: 'USIContentParser'
};

// ============================================================
// USICollisionDetector — detects cross-update-set record collisions
// ============================================================
var USICollisionDetector = Class.create();
USICollisionDetector.prototype = {
    initialize: function() {
        this.parser = new USIContentParser();
    },

    /**
     * Detect collisions across all in-progress and complete update sets
     * @param {String} scanBatchId - batch ID for this scan
     * @return {Object} { ok: boolean, collisions: Array, count: number }
     */
    detectAllCollisions: function(scanBatchId) {
        if (!scanBatchId) {
            scanBatchId = 'USI_' + gs.generateGUID();
        }
        try {
            var index = this._buildCollisionIndex();
            var collisions = this._findCollisions(index, scanBatchId);
            this._persistCollisions(collisions, scanBatchId);
            return { ok: true, collisions: collisions, count: collisions.length, scan_batch_id: scanBatchId };
        } catch (ex) {
            gs.log('USICollisionDetector.detectAllCollisions error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, collisions: [], count: 0 };
        }
    },

    /**
     * Detect collisions for a specific update set against all others
     */
    detectForUpdateSet: function(updateSetSysId, scanBatchId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        if (!scanBatchId) {
            scanBatchId = 'USI_' + gs.generateGUID();
        }
        try {
            var targetSet = this._getUpdateSetName(updateSetSysId);
            var targetEntries = this.parser.parseUpdateSet(updateSetSysId);
            if (!targetEntries.ok) {
                return { ok: false, error: targetEntries.error };
            }
            var allIndex = this._buildCollisionIndex();
            var collisions = [];
            for (var i = 0; i < targetEntries.entries.length; i++) {
                var entry = targetEntries.entries[i];
                var key = entry.target_table + '||' + entry.record_sys_id;
                if (allIndex[key] && allIndex[key].update_sets.length > 1) {
                    var collision = this._buildCollisionRecord(key, allIndex[key], targetSet, entry, scanBatchId);
                    collisions.push(collision);
                }
            }
            this._persistCollisions(collisions, scanBatchId);
            return { ok: true, collisions: collisions, count: collisions.length, scan_batch_id: scanBatchId };
        } catch (ex) {
            gs.log('USICollisionDetector.detectForUpdateSet error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, collisions: [], count: 0 };
        }
    },

    /**
     * Build index: { table_sysid → { update_sets: [], fields: {} } }
     */
    _buildCollisionIndex: function() {
        var index = {};
        try {
            var gr = new GlideRecord('sys_update_xml');
            gr.addQuery('update_set.state', 'IN', 'in progress,complete');
            gr.orderBy('update_set');
            gr.query();
            while (gr.next()) {
                var updateSetName = gr.update_set.getDisplayValue();
                var payload = gr.getValue('payload');
                if (!payload) {
                    continue;
                }
                var doc = new XMLDocument2();
                doc.parse(payload);
                var tableName = this._getNodeText(doc, '//table');
                var recordSysId = this._getNodeText(doc, '//sys_id');
                if (!tableName || !recordSysId) {
                    continue;
                }
                var key = tableName + '||' + recordSysId;
                if (!index[key]) {
                    index[key] = { update_sets: [], fields: {} };
                }
                if (index[key].update_sets.indexOf(updateSetName) === -1) {
                    index[key].update_sets.push(updateSetName);
                }
                // Track fields modified per update set
                var fields = this._extractFieldNames(doc);
                for (var i = 0; i < fields.length; i++) {
                    if (!index[key].fields[fields[i]]) {
                        index[key].fields[fields[i]] = [];
                    }
                    if (index[key].fields[fields[i]].indexOf(updateSetName) === -1) {
                        index[key].fields[fields[i]].push(updateSetName);
                    }
                }
            }
        } catch (ex) {
            gs.log('USICollisionDetector._buildCollisionIndex error: ' + ex.message, 'USI');
        }
        return index;
    },

    /**
     * Find collisions from the index — entries with >1 update set
     */
    _findCollisions: function(index, scanBatchId) {
        var collisions = [];
        for (var key in index) {
            if (index[key].update_sets.length > 1) {
                var sepIdx = key.indexOf('||');
                var tableName = key.substring(0, sepIdx);
                var recordSysId = key.substring(sepIdx + 2);
                var fieldConflicts = [];
                var hasFieldConflict = false;
                for (var field in index[key].fields) {
                    if (index[key].fields[field].length > 1) {
                        hasFieldConflict = true;
                        fieldConflicts.push({
                            field: field,
                            update_sets: index[key].fields[field]
                        });
                    }
                }
                collisions.push({
                    target_table: tableName,
                    target_record_sys_id: recordSysId,
                    update_sets: index[key].update_sets,
                    update_set_a: index[key].update_sets[0],
                    update_set_b: index[key].update_sets[1],
                    field_conflicts: fieldConflicts,
                    has_field_conflict: hasFieldConflict,
                    severity: hasFieldConflict ? 'HIGH' : 'MEDIUM',
                    finding_type: 'collision',
                    scan_batch_id: scanBatchId,
                    description: 'Record ' + tableName + ' (' + recordSysId + ') modified in ' +
                        index[key].update_sets.length + ' update sets: ' + index[key].update_sets.join(', ')
                });
            }
        }
        return collisions;
    },

    /**
     * Build a collision record for a specific update set
     */
    _buildCollisionRecord: function(key, indexEntry, targetSet, entry, scanBatchId) {
        var otherSets = [];
        for (var i = 0; i < indexEntry.update_sets.length; i++) {
            if (indexEntry.update_sets[i] !== targetSet) {
                otherSets.push(indexEntry.update_sets[i]);
            }
        }
        return {
            target_table: entry.target_table,
            target_record_sys_id: entry.record_sys_id,
            target_record_name: entry.record_name,
            update_set_a: targetSet,
            update_set_b: otherSets.join(', '),
            update_sets: indexEntry.update_sets,
            field_conflicts: [],
            has_field_conflict: false,
            severity: 'MEDIUM',
            finding_type: 'collision',
            scan_batch_id: scanBatchId,
            description: 'Record ' + entry.record_name + ' (' + entry.target_table + ') also modified in: ' + otherSets.join(', ')
        };
    },

    /**
     * Extract field names from payload XML
     */
    _extractFieldNames: function(doc) {
        var fields = [];
        try {
            var root = doc.getDocumentElement();
            if (!root) {
                return fields;
            }
            var children = root.getChildNodes();
            for (var i = 0; i < children.size(); i++) {
                var child = children.get(i);
                var nodeName = child.getNodeName();
                if (nodeName.charAt(0) !== '#' && nodeName !== 'table' && nodeName !== 'name' &&
                    nodeName !== 'action' && nodeName !== 'sys_id') {
                    fields.push(nodeName);
                }
            }
        } catch (e) {
            // ignore
        }
        return fields;
    },

    /**
     * Persist collisions to x_usi_inspector_finding table
     */
    _persistCollisions: function(collisions, scanBatchId) {
        try {
            // Clear old collision findings for this batch
            var oldGr = new GlideRecord('x_usi_inspector_finding');
            oldGr.addQuery('finding_type', 'collision');
            oldGr.addQuery('scan_batch_id', scanBatchId);
            oldGr.query();
            oldGr.deleteMultiple();
        } catch (e) {
            gs.log('USICollisionDetector._persistCollisions clear error: ' + e.message, 'USI');
        }
        for (var i = 0; i < collisions.length; i++) {
            try {
                var c = collisions[i];
                var gr = new GlideRecord('x_usi_inspector_finding');
                gr.initialize();
                gr.setValue('finding_type', 'collision');
                gr.setValue('update_set_a', c.update_set_a);
                gr.setValue('update_set_b', c.update_set_b || '');
                gr.setValue('target_table', c.target_table);
                gr.setValue('target_record_name', c.target_record_name || '');
                gr.setValue('target_record_sys_id', c.target_record_sys_id || '');
                gr.setValue('field_conflicts', JSON.stringify(c.field_conflicts || []));
                gr.setValue('severity', c.severity);
                gr.setValue('status', 'new');
                gr.setValue('risk_level', c.severity === 'HIGH' ? 'RED' : 'YELLOW');
                gr.setValue('scan_batch_id', scanBatchId);
                gr.setValue('description', c.description || '');
                gr.insert();
            } catch (ex) {
                gs.log('USICollisionDetector._persistCollisions insert error: ' + ex.message, 'USI');
            }
        }
    },

    /**
     * Get update set name from sys_id
     */
    _getUpdateSetName: function(updateSetSysId) {
        try {
            var gr = new GlideRecord('sys_update_set');
            if (gr.get(updateSetSysId)) {
                return gr.getValue('name');
            }
        } catch (e) {
            // ignore
        }
        return '';
    },

    _getNodeText: function(doc, xpath) {
        try {
            var node = doc.selectNode(xpath);
            if (node) {
                return node.getNodeValue();
            }
        } catch (e) {
            // xpath not found
        }
        return '';
    },

    type: 'USICollisionDetector'
};

// ============================================================
// USIDependencyAnalyzer — maps reference dependencies and deployment order
// ============================================================
var USIDependencyAnalyzer = Class.create();
USIDependencyAnalyzer.prototype = {
    initialize: function() {
        this.parser = new USIContentParser();
    },

    /**
     * Analyze dependencies for a specific update set
     * @param {String} updateSetSysId
     * @param {String} scanBatchId
     * @return {Object} { ok, dependencies, missing_dependencies, deployment_order }
     */
    analyzeUpdateSet: function(updateSetSysId, scanBatchId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        if (!scanBatchId) {
            scanBatchId = 'USI_' + gs.generateGUID();
        }
        try {
            var entries = this.parser.parseUpdateSet(updateSetSysId);
            if (!entries.ok) {
                return { ok: false, error: entries.error };
            }
            var dependencies = [];
            var missingDeps = [];
            var allUpdateSetRecords = this._getAllUpdateSetRecords();

            for (var i = 0; i < entries.entries.length; i++) {
                var entry = entries.entries[i];
                var refs = this._extractReferences(entry);
                for (var j = 0; j < refs.length; j++) {
                    var ref = refs[j];
                    var isMissing = !this._isRecordInAnyUpdateSet(ref, allUpdateSetRecords) &&
                                    !this._isSystemRecord(ref);
                    if (isMissing) {
                        ref.is_missing = true;
                        missingDeps.push(ref);
                    } else {
                        ref.is_missing = false;
                        dependencies.push(ref);
                    }
                }
            }

            this._persistFindings(dependencies, missingDeps, scanBatchId);

            var deploymentOrder = this._computeDeploymentOrder(updateSetSysId, dependencies);
            return {
                ok: true,
                dependencies: dependencies,
                missing_dependencies: missingDeps,
                deployment_order: deploymentOrder,
                scan_batch_id: scanBatchId
            };
        } catch (ex) {
            gs.log('USIDependencyAnalyzer.analyzeUpdateSet error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, dependencies: [], missing_dependencies: [] };
        }
    },

    /**
     * Extract reference field values from an update set entry
     */
    _extractReferences: function(entry) {
        var refs = [];
        if (!entry.fields) {
            return refs;
        }
        for (var i = 0; i < entry.fields.length; i++) {
            var field = entry.fields[i];
            // Reference fields typically end in _ref or contain sys_id-like values
            if (field.field && field.field.indexOf('_ref') > -1) {
                refs.push({
                    source_table: entry.target_table,
                    source_record: entry.record_name,
                    target_table: field.field.replace('_ref', ''),
                    target_record_sys_id: field.value,
                    target_record_name: '',
                    is_missing: false
                });
            }
            // Check if value looks like a sys_id (32 hex chars)
            if (field.value && field.value.length === 32 && /^[a-f0-9]+$/i.test(field.value)) {
                refs.push({
                    source_table: entry.target_table,
                    source_record: entry.record_name,
                    target_table: 'unknown',
                    target_record_sys_id: field.value,
                    target_record_name: '',
                    is_missing: false
                });
            }
        }
        return refs;
    },

    /**
     * Get all record sys_ids across all update sets
     */
    _getAllUpdateSetRecords: function() {
        var recordSet = {};
        try {
            var gr = new GlideRecord('sys_update_xml');
            gr.addQuery('update_set.state', 'IN', 'in progress,complete');
            gr.query();
            while (gr.next()) {
                var payload = gr.getValue('payload');
                if (!payload) {
                    continue;
                }
                var doc = new XMLDocument2();
                doc.parse(payload);
                var sysId = '';
                try {
                    var node = doc.selectNode('//sys_id');
                    if (node) {
                        sysId = node.getNodeValue();
                    }
                } catch (e) {
                    // ignore
                }
                if (sysId) {
                    recordSet[sysId] = true;
                }
            }
        } catch (ex) {
            gs.log('USIDependencyAnalyzer._getAllUpdateSetRecords error: ' + ex.message, 'USI');
        }
        return recordSet;
    },

    /**
     * Check if a referenced record exists in any update set
     */
    _isRecordInAnyUpdateSet: function(ref, allRecords) {
        return allRecords[ref.target_record_sys_id] === true;
    },

    /**
     * Check if a record is a system/OOTB record (not custom)
     */
    _isSystemRecord: function(ref) {
        if (!ref.target_table || ref.target_table === 'unknown') {
            return true; // can't determine — treat as system to avoid false positives
        }
        // Tables that are always OOTB — no missing dependency concern
        var systemTables = ['sys_user', 'sys_user_group', 'sys_user_role', 'sys_choice',
                           'sys_dictionary', 'sys_db_object', 'sys_metadata', 'sys_scope',
                           'sys_app', 'sys_plugin', 'sys_update_set', 'sys_update_xml'];
        for (var i = 0; i < systemTables.length; i++) {
            if (ref.target_table === systemTables[i]) {
                return true;
            }
        }
        return false;
    },

    /**
     * Compute deployment order using topological sort
     */
    _computeDeploymentOrder: function(updateSetSysId, dependencies) {
        // Simplified: if this update set has dependencies on other update sets,
        // those must be deployed first. Return ordered list.
        var order = [];
        var updateSetName = '';
        try {
            var gr = new GlideRecord('sys_update_set');
            if (gr.get(updateSetSysId)) {
                updateSetName = gr.getValue('name');
            }
        } catch (e) {
            // ignore
        }
        order.push({ name: updateSetName, position: 1, reason: 'Target update set' });
        // Group dependencies by target update set (inferred from target_record_sys_id)
        var depSets = {};
        for (var i = 0; i < dependencies.length; i++) {
            var dep = dependencies[i];
            if (dep.target_record_sys_id) {
                depSets[dep.target_table] = depSets[dep.target_table] || [];
                depSets[dep.target_table].push(dep);
            }
        }
        var pos = 0;
        for (var table in depSets) {
            pos++;
            order.push({
                name: 'Update set containing ' + table + ' records',
                position: pos,
                reason: 'Provides ' + depSets[table].length + ' referenced ' + table + ' records'
            });
        }
        return order;
    },

    /**
     * Persist dependency findings to x_usi_inspector_finding
     */
    _persistFindings: function(dependencies, missingDeps, scanBatchId) {
        try {
            // Clear old dependency findings for this batch
            var oldGr = new GlideRecord('x_usi_inspector_finding');
            oldGr.addQuery('finding_type', 'IN', 'dependency,missing_dependency');
            oldGr.addQuery('scan_batch_id', scanBatchId);
            oldGr.query();
            oldGr.deleteMultiple();
        } catch (e) {
            gs.log('USIDependencyAnalyzer._persistFindings clear error: ' + e.message, 'USI');
        }
        // Persist dependencies
        for (var i = 0; i < dependencies.length; i++) {
            this._insertFinding(dependencies[i], 'dependency', 'LOW', scanBatchId);
        }
        // Persist missing dependencies
        for (var j = 0; j < missingDeps.length; j++) {
            this._insertFinding(missingDeps[j], 'missing_dependency', 'HIGH', scanBatchId);
        }
    },

    _insertFinding: function(dep, findingType, severity, scanBatchId) {
        try {
            var gr = new GlideRecord('x_usi_inspector_finding');
            gr.initialize();
            gr.setValue('finding_type', findingType);
            gr.setValue('update_set_a', dep.source_record || '');
            gr.setValue('update_set_b', dep.target_table || '');
            gr.setValue('target_table', dep.target_table || '');
            gr.setValue('target_record_name', dep.target_record_name || '');
            gr.setValue('target_record_sys_id', dep.target_record_sys_id || '');
            gr.setValue('severity', severity);
            gr.setValue('status', 'new');
            gr.setValue('risk_level', severity === 'HIGH' ? 'RED' : 'GREEN');
            gr.setValue('scan_batch_id', scanBatchId);
            gr.setValue('description', (findingType === 'missing_dependency' ? 'Missing dependency: ' : 'Dependency: ') +
                dep.source_table + '.' + dep.source_record + ' references ' + dep.target_table +
                ' (' + dep.target_record_sys_id + ')');
            gr.insert();
        } catch (ex) {
            gs.log('USIDependencyAnalyzer._insertFinding error: ' + ex.message, 'USI');
        }
    },

    type: 'USIDependencyAnalyzer'
};

// ============================================================
// USIRiskScorer — classifies update set risk as RED/YELLOW/GREEN
// ============================================================
var USIRiskScorer = Class.create();
USIRiskScorer.prototype = {
    initialize: function() {
        this.parser = new USIContentParser();
    },

    /**
     * Score risk for a specific update set
     * @param {String} updateSetSysId
     * @return {Object} { ok, risk_level, breakdown, record_count, error }
     */
    scoreUpdateSet: function(updateSetSysId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        try {
            var entries = this.parser.parseUpdateSet(updateSetSysId);
            if (!entries.ok) {
                return { ok: false, error: entries.error };
            }
            return this._computeRisk(entries.entries);
        } catch (ex) {
            gs.log('USIRiskScorer.scoreUpdateSet error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Compute risk from parsed entries
     */
    _computeRisk: function(entries) {
        var breakdown = { red: 0, yellow: 0, green: 0, unknown: 0 };
        var affectedTables = {};
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var type = entry.type || 'unknown';
            breakdown[type] = (breakdown[type] || 0) + 1;
            affectedTables[entry.target_table] = (affectedTables[entry.target_table] || 0) + 1;
        }
        var riskLevel = 'GREEN';
        if (breakdown.red > 0) {
            riskLevel = 'RED';
        } else if (breakdown.yellow > 0) {
            riskLevel = 'YELLOW';
        }
        return {
            ok: true,
            risk_level: riskLevel,
            breakdown: breakdown,
            record_count: entries.length,
            affected_tables: affectedTables,
            recommendation: this._getRecommendation(riskLevel, breakdown)
        };
    },

    /**
     * Get recommendation based on risk level
     */
    _getRecommendation: function(riskLevel, breakdown) {
        switch (riskLevel) {
            case 'RED':
                return 'DO NOT DEPLOY without CAB review. Contains ' + breakdown.red +
                    ' code execution records (ACLs, business rules, script includes). ' +
                    'Full regression testing required.';
            case 'YELLOW':
                return 'REVIEW WITH CAUTION. Contains ' + breakdown.yellow +
                    ' UI/UX impacting records. User acceptance testing recommended.';
            case 'GREEN':
                return 'APPROVE. Contains only cosmetic changes (list views, homepages, stylesheets). ' +
                    'Low risk deployment.';
            default:
                return 'Unable to determine risk level.';
        }
    },

    type: 'USIRiskScorer'
};