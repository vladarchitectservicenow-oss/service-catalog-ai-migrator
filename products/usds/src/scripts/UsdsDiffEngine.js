// ServiceNow Update Set Diff & Review Studio — UsdsDiffEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core diff, conflict detection, backup/restore, and AI risk scoring engine.
// @class UsdsDiffEngine @namespace x_snc_usds

var UsdsDiffEngine = Class.create();
UsdsDiffEngine.prototype = {
    initialize: function() {
        this.TABLE_CRITICALITY = {
            'incident': 10, 'change_request': 10, 'problem': 9,
            'sc_req_item': 8, 'sc_request': 8, 'sc_cat_item': 7,
            'sys_user': 9, 'sys_user_group': 8, 'sys_user_role': 9,
            'sys_script_include': 7, 'sys_script': 7, 'sys_ui_action': 6,
            'sys_ui_policy': 6, 'sys_ui_script': 5, 'sys_ui_page': 5,
            'sys_properties': 6, 'sys_email': 5, 'sys_attachment': 4,
            'sys_ui_macro': 4, 'sys_ui_list': 4, 'sys_ui_form': 4,
            'sys_ui_section': 4, 'sys_ui_view': 4,
            'sys_choice': 3, 'sys_dictionary': 3, 'sys_db_object': 3
        };
    },

    parseUpdateSet: function(updateSetId) {
        var payload = { tables: {}, update_set_id: updateSetId, record_count: 0 };
        var gr = new GlideRecord('sys_update_xml');
        gr.addQuery('update_set', updateSetId);
        gr.addQuery('category', '!=', 'Customer Update');
        gr.query();
        while (gr.next()) {
            var name = gr.getValue('name') || '';
            var targetName = gr.getValue('target_name') || '';
            var type = gr.getValue('type') || '';
            var payloadStr = gr.getValue('payload') || '';
            var action = gr.getValue('action') || '';
            var parts = targetName.split('.');
            if (parts.length < 2) continue;
            var tableName = parts[0];
            var recordSysId = parts.slice(1).join('.');
            if (!payload.tables[tableName]) payload.tables[tableName] = {};
            var changeType = 'update';
            if (action === 'INSERT' || action === 'insert') changeType = 'insert';
            else if (action === 'DELETE' || action === 'delete') changeType = 'delete';
            if (!payload.tables[tableName][recordSysId]) {
                payload.tables[tableName][recordSysId] = { type: changeType, fields: {}, name: name };
            }
            if (payloadStr) {
                try {
                    var fieldChanges = this._extractFieldsFromPayload(payloadStr, type);
                    for (var fieldName in fieldChanges) {
                        payload.tables[tableName][recordSysId].fields[fieldName] = fieldChanges[fieldName];
                    }
                } catch (e) {
                    gs.debug('[USDS] Failed to parse payload for ' + name + ': ' + e.message);
                }
            }
            payload.record_count++;
        }
        return payload;
    },

    _extractFieldsFromPayload: function(payloadStr, type) {
        var fields = {};
        if (!payloadStr) return fields;
        var dictRegex = /<sys_dictionary[^>]*>[\s\S]*?<element>([^<]+)<\/element>[\s\S]*?<value[^>]*>([^<]*)<\/value>/gi;
        var match;
        while ((match = dictRegex.exec(payloadStr)) !== null) {
            fields[match[1]] = match[2] || '';
        }
        var fieldRegex = /<(\w+)>([^<]*)<\/\1>/g;
        while ((match = fieldRegex.exec(payloadStr)) !== null) {
            var fName = match[1];
            if (fName !== 'sys_dictionary' && fName !== 'sys_update_xml' &&
                fName !== 'payload' && fName !== 'name' && fName !== 'target_name' &&
                fName !== 'type' && fName !== 'action' && fName !== 'category' &&
                fName !== 'update_set' && fName !== 'sys_id' && fName !== 'sys_updated_on' &&
                fName !== 'sys_updated_by' && fName !== 'sys_created_on' && fName !== 'sys_created_by') {
                fields[fName] = match[2] || '';
            }
        }
        return fields;
    },

    diffFieldLevel: function(setA, setB) {
        var result = {
            additions: [], modifications: [], deletions: [], unchanged: [],
            summary: { total: 0, added: 0, modified: 0, deleted: 0, unchanged: 0 }
        };
        var allTables = {};
        for (var t in setA.tables) allTables[t] = true;
        for (var t in setB.tables) allTables[t] = true;
        for (var tableName in allTables) {
            var recordsA = (setA.tables && setA.tables[tableName]) || {};
            var recordsB = (setB.tables && setB.tables[tableName]) || {};
            var allRecords = {};
            for (var r in recordsA) allRecords[r] = true;
            for (var r in recordsB) allRecords[r] = true;
            for (var recordSysId in allRecords) {
                var recA = recordsA[recordSysId];
                var recB = recordsB[recordSysId];
                if (!recA && recB) {
                    result.additions.push({ table: tableName, sys_id: recordSysId, name: recB.name || recordSysId, fields: recB.fields, type: recB.type });
                    result.summary.added++;
                } else if (recA && !recB) {
                    result.deletions.push({ table: tableName, sys_id: recordSysId, name: recA.name || recordSysId, fields: recA.fields, type: recA.type });
                    result.summary.deleted++;
                } else {
                    var fieldChanges = this._compareRecordFields(tableName, recordSysId, recA, recB);
                    if (fieldChanges.length > 0) {
                        result.modifications.push({ table: tableName, sys_id: recordSysId, name: recB.name || recA.name || recordSysId, changes: fieldChanges });
                        result.summary.modified++;
                    } else {
                        result.unchanged.push({ table: tableName, sys_id: recordSysId, name: recB.name || recA.name || recordSysId });
                        result.summary.unchanged++;
                    }
                }
                result.summary.total++;
            }
        }
        return result;
    },

    _compareRecordFields: function(tableName, recordSysId, recA, recB) {
        var changes = [];
        var allFields = {};
        for (var f in recA.fields) allFields[f] = true;
        for (var f in recB.fields) allFields[f] = true;
        for (var fieldName in allFields) {
            var valA = (recA.fields && recA.fields[fieldName]) || '';
            var valB = (recB.fields && recB.fields[fieldName]) || '';
            if (valA !== valB) {
                changes.push({ field: fieldName, old_value: valA, new_value: valB, change_type: valA === '' ? 'added' : (valB === '' ? 'removed' : 'modified') });
            }
        }
        return changes;
    },

    detectConflicts: function(setA, setB) {
        var conflicts = [];
        for (var tableName in setA.tables) {
            if (!setB.tables || !setB.tables[tableName]) continue;
            var recordsA = setA.tables[tableName];
            var recordsB = setB.tables[tableName];
            for (var recordSysId in recordsA) {
                if (!recordsB[recordSysId]) continue;
                var recA = recordsA[recordSysId];
                var recB = recordsB[recordSysId];
                for (var fieldName in recA.fields) {
                    if (recB.fields && recB.fields.hasOwnProperty(fieldName)) {
                        var valA = recA.fields[fieldName] || '';
                        var valB = recB.fields[fieldName] || '';
                        if (valA !== valB) {
                            conflicts.push({ table: tableName, sys_id: recordSysId, field: fieldName, value_a: valA, value_b: valB, severity: 'BLOCKING', name: recA.name || recB.name || recordSysId });
                        }
                    }
                }
                var hasBlocking = false;
                for (var f in recA.fields) {
                    if (recB.fields && recB.fields.hasOwnProperty(f) && recA.fields[f] !== recB.fields[f]) { hasBlocking = true; break; }
                }
                if (!hasBlocking) {
                    var fieldsA = Object.keys(recA.fields);
                    var fieldsB = Object.keys(recB.fields || {});
                    var overlap = false;
                    for (var i = 0; i < fieldsA.length; i++) { if (fieldsB.indexOf(fieldsA[i]) === -1) { overlap = true; break; } }
                    if (overlap || fieldsA.length !== fieldsB.length) {
                        conflicts.push({ table: tableName, sys_id: recordSysId, field: '(multiple fields)', value_a: 'Set A: ' + fieldsA.join(', '), value_b: 'Set B: ' + fieldsB.join(', '), severity: 'WARNING', name: recA.name || recB.name || recordSysId });
                    }
                }
            }
        }
        return conflicts;
    },

    createBackup: function(updateSetId) {
        var snapshot = { records: [], record_count: 0, created_at: new GlideDateTime().getValue() };
        var gr = new GlideRecord('sys_update_xml');
        gr.addQuery('update_set', updateSetId);
        gr.addQuery('category', '!=', 'Customer Update');
        gr.query();
        var processed = {};
        while (gr.next()) {
            var targetName = gr.getValue('target_name') || '';
            var parts = targetName.split('.');
            if (parts.length < 2) continue;
            var tableName = parts[0];
            var recordSysId = parts.slice(1).join('.');
            var key = tableName + '.' + recordSysId;
            if (processed[key]) continue;
            processed[key] = true;
            try {
                var recordGr = new GlideRecord(tableName);
                if (recordGr.get(recordSysId)) {
                    var fields = {};
                    var elements = recordGr.getElements();
                    for (var i = 0; i < elements.length; i++) {
                        try { var val = recordGr.getValue(elements[i]); if (val !== null && val !== undefined) fields[elements[i]] = '' + val; } catch (e) {}
                    }
                    snapshot.records.push({ table: tableName, sys_id: recordSysId, fields: fields });
                    snapshot.record_count++;
                }
            } catch (e) { gs.error('[USDS] Backup failed for ' + tableName + '.' + recordSysId + ': ' + e.message); }
        }
        return snapshot;
    },

    restoreBackup: function(snapshot) {
        var result = { restored_count: 0, failed: [] };
        if (!snapshot || !snapshot.records) { result.failed.push({ error: 'Invalid snapshot: no records array' }); return result; }
        for (var i = 0; i < snapshot.records.length; i++) {
            var rec = snapshot.records[i];
            try {
                var gr = new GlideRecord(rec.table);
                if (gr.get(rec.sys_id)) {
                    for (var fieldName in rec.fields) {
                        if (fieldName !== 'sys_id' && fieldName !== 'sys_created_on' && fieldName !== 'sys_created_by' && fieldName !== 'sys_updated_on' && fieldName !== 'sys_updated_by') {
                            try { gr.setValue(fieldName, rec.fields[fieldName]); } catch (e) { gs.debug('[USDS] Cannot restore field ' + fieldName + ': ' + e.message); }
                        }
                    }
                    try { gr.update(); result.restored_count++; } catch (e) { result.failed.push({ table: rec.table, sys_id: rec.sys_id, error: 'Update failed: ' + e.message }); }
                } else { result.failed.push({ table: rec.table, sys_id: rec.sys_id, error: 'Record not found' }); }
            } catch (e) { result.failed.push({ table: rec.table, sys_id: rec.sys_id, error: e.message }); }
        }
        return result;
    },

    scoreAllChanges: function(diffResult) {
        var scores = [];
        var changes = [];
        for (var i = 0; i < (diffResult && diffResult.additions ? diffResult.additions.length : 0); i++) {
            var add = diffResult.additions[i];
            if (!add.fields) continue;
            for (var f in add.fields) {
                changes.push({ table: add.table, sys_id: add.sys_id, field: f, old_value: '', new_value: add.fields[f] });
            }
        }
        for (var i = 0; i < (diffResult && diffResult.modifications ? diffResult.modifications.length : 0); i++) {
            var mod = diffResult.modifications[i];
            if (!mod.changes) continue;
            for (var j = 0; j < mod.changes.length; j++) {
                changes.push({ table: mod.table, sys_id: mod.sys_id, field: mod.changes[j].field, old_value: mod.changes[j].old_value, new_value: mod.changes[j].new_value });
            }
        }
        for (var i = 0; i < (diffResult && diffResult.deletions ? diffResult.deletions.length : 0); i++) {
            var del = diffResult.deletions[i];
            if (!del.fields) continue;
            for (var f in del.fields) {
                changes.push({ table: del.table, sys_id: del.sys_id, field: f, old_value: del.fields[f], new_value: '' });
            }
        }
        for (var i = 0; i < changes.length; i++) {
            var risk = this.scoreRisk(changes[i]);
            scores.push({ table: changes[i].table, sys_id: changes[i].sys_id, field: changes[i].field, score: risk.score, explanation: risk.explanation });
        }
        return scores;
    },

    scoreRisk: function(change) {
        var tableWeight = this.TABLE_CRITICALITY[change.table] || 5;
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenAIController) {
                var genAI = new sn_generative_ai.GenAIController();
                var prompt = 'Analyze this ServiceNow change for risk:\nTable: ' + change.table + '\nField: ' + change.field + '\nOld value: ' + (change.old_value || '(empty)') + '\nNew value: ' + (change.new_value || '(empty)') + '\nReturn JSON: { "score": 0-100, "explanation": "string" }';
                var aiResult = genAI.generate(prompt, { provider: 'now_assist', max_tokens: 200 });
                if (aiResult) {
                    try { var parsed = JSON.parse(aiResult); return { score: Math.min(100, Math.max(0, parseInt(parsed.score, 10) || 0)), explanation: parsed.explanation || 'AI risk assessment' }; } catch (parseErr) { gs.debug('[USDS] AI response parse failed: ' + parseErr.message); }
                }
            }
        } catch (aiErr) { gs.debug('[USDS] AI risk scoring unavailable: ' + aiErr.message); }
        var score = tableWeight * 5;
        var explanation = 'Heuristic risk assessment';
        if (change.field === 'condition' || change.field === 'script') { score += 20; explanation = 'Script/condition change on ' + change.table; }
        else if (change.field === 'active') { score += 15; explanation = 'Active flag change on ' + change.table; }
        else if (change.field === 'order') { score += 10; explanation = 'Execution order change on ' + change.table; }
        else if (change.field === 'roles' || change.field === 'requires_roles') { score += 25; explanation = 'Security role change on ' + change.table; }
        if (change.old_value === '' && change.new_value !== '') { score += 5; explanation += '; new field value added'; }
        else if (change.old_value !== '' && change.new_value === '') { score += 10; explanation += '; field value removed'; }
        return { score: Math.min(100, score), explanation: explanation };
    },

    summarizeChanges: function(diffResult) {
        var s = diffResult.summary;
        var lines = ['Update Set Diff Summary', 'Total records changed: ' + s.total, 'Additions: ' + s.added + ' | Modifications: ' + s.modified + ' | Deletions: ' + s.deleted + ' | Unchanged: ' + s.unchanged];
        var tableMods = {};
        for (var i = 0; i < diffResult.modifications.length; i++) { var mod = diffResult.modifications[i]; if (!tableMods[mod.table]) tableMods[mod.table] = []; tableMods[mod.table].push(mod); }
        if (Object.keys(tableMods).length > 0) {
            lines.push('\nModified tables:');
            for (var table in tableMods) { var mods = tableMods[table]; var fieldCount = 0; for (var j = 0; j < mods.length; j++) fieldCount += mods[j].changes.length; lines.push('  - ' + table + ': ' + mods.length + ' records, ' + fieldCount + ' field changes'); }
        }
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenAIController) {
                var genAI = new sn_generative_ai.GenAIController();
                var aiSummary = genAI.generate('Summarize this ServiceNow update set diff in 2-3 sentences for a developer:\n' + lines.join('\n'), { provider: 'now_assist', max_tokens: 150 });
                if (aiSummary) return aiSummary;
            }
        } catch (e) { gs.debug('[USDS] AI summarization unavailable: ' + e.message); }
        return lines.join('\n');
    },

    type: 'UsdsDiffEngine'
};