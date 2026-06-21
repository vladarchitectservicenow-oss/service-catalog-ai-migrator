/**
 * Copyright (c) 2026 Vladimir Kapustin
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * UpdateSet Inspector — Support Services
 * Consolidates: USIReportGenerator, USIBackupManager, USIAIChangeSummarizer
 * These three components form the reporting, backup, and AI layer.
 */

// ============================================================
// USIReportGenerator — generates CAB review reports
// ============================================================
var USIReportGenerator = Class.create();
USIReportGenerator.prototype = {
    initialize: function() {
        this.parser = new USIContentParser();
        this.riskScorer = new USIRiskScorer();
        this.collisionDetector = new USICollisionDetector();
        this.dependencyAnalyzer = new USIDependencyAnalyzer();
    },

    /**
     * Generate a full CAB report for an update set
     * @param {String} updateSetSysId
     * @return {Object} { ok, report_html, report_json, error }
     */
    generateReport: function(updateSetSysId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        try {
            var scanBatchId = 'USI_CAB_' + gs.generateGUID();

            // Collect all data
            var content = this.parser.parseUpdateSet(updateSetSysId);
            var risk = this.riskScorer.scoreUpdateSet(updateSetSysId);
            var collisions = this.collisionDetector.detectForUpdateSet(updateSetSysId, scanBatchId);
            var deps = this.dependencyAnalyzer.analyzeUpdateSet(updateSetSysId, scanBatchId);
            var updateSetName = this._getUpdateSetName(updateSetSysId);

            // Build structured report data
            var reportData = {
                update_set_name: updateSetName,
                update_set_sys_id: updateSetSysId,
                generated_at: new GlideDateTime().toString(),
                generated_by: gs.getUserName(),
                executive_summary: this._buildExecutiveSummary(updateSetName, content, risk, collisions, deps),
                affected_tables: risk.ok ? risk.affected_tables : {},
                risk_assessment: {
                    level: risk.ok ? risk.risk_level : 'UNKNOWN',
                    breakdown: risk.ok ? risk.breakdown : {},
                    recommendation: risk.ok ? risk.recommendation : 'Unable to assess'
                },
                collision_warnings: collisions.ok ? collisions.collisions : [],
                collision_count: collisions.ok ? collisions.count : 0,
                missing_dependencies: deps.ok ? deps.missing_dependencies : [],
                missing_dep_count: deps.ok ? deps.missing_dependencies.length : 0,
                deployment_order: deps.ok ? deps.deployment_order : [],
                record_count: content.ok ? content.count : 0,
                key_changes: this._extractKeyChanges(content)
            };

            // Generate HTML
            var html = this._renderHTML(reportData);

            // Persist as audit record
            this._persistReport(updateSetSysId, updateSetName, reportData, html, scanBatchId);

            return {
                ok: true,
                report_html: html,
                report_json: JSON.stringify(reportData),
                scan_batch_id: scanBatchId
            };
        } catch (ex) {
            gs.log('USIReportGenerator.generateReport error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Build executive summary from collected data
     */
    _buildExecutiveSummary: function(updateSetName, content, risk, collisions, deps) {
        var recordCount = content.ok ? content.count : 0;
        var riskLevel = risk.ok ? risk.risk_level : 'UNKNOWN';
        var collisionCount = collisions.ok ? collisions.count : 0;
        var missingDepCount = deps.ok ? deps.missing_dependencies.length : 0;
        var summary = 'Update set "' + updateSetName + '" contains ' + recordCount +
            ' record(s) with an overall risk level of ' + riskLevel + '.';
        if (collisionCount > 0) {
            summary += ' WARNING: ' + collisionCount + ' collision(s) detected with other update sets.';
        }
        if (missingDepCount > 0) {
            summary += ' WARNING: ' + missingDepCount + ' missing dependency/dependencies detected.';
        }
        return summary;
    },

    /**
     * Extract key changes (significant fields only)
     */
    _extractKeyChanges: function(content) {
        var changes = [];
        if (!content.ok) {
            return changes;
        }
        var significantFields = ['active', 'state', 'status', 'assignment_group', 'assigned_to',
                                 'script', 'condition', 'filter_condition', 'order', 'priority'];
        for (var i = 0; i < content.entries.length && changes.length < 50; i++) {
            var entry = content.entries[i];
            for (var j = 0; j < entry.fields.length; j++) {
                var field = entry.fields[j];
                if (significantFields.indexOf(field.field) > -1) {
                    changes.push({
                        record: entry.record_name,
                        table: entry.target_table,
                        action: entry.action,
                        field: field.field,
                        value_preview: field.value.substring(0, 200)
                    });
                }
            }
        }
        return changes;
    },

    /**
     * Render report as HTML
     */
    _renderHTML: function(data) {
        var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
        html += '<title>CAB Report — ' + this._escapeHtml(data.update_set_name) + '</title>';
        html += '<style>';
        html += 'body { font-family: Arial, sans-serif; margin: 20px; color: #333; }';
        html += 'h1 { color: #1e4d8b; border-bottom: 2px solid #1e4d8b; padding-bottom: 5px; }';
        html += 'h2 { color: #1e4d8b; margin-top: 25px; }';
        html += 'table { border-collapse: collapse; width: 100%; margin: 10px 0; }';
        html += 'th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }';
        html += 'th { background-color: #1e4d8b; color: white; }';
        html += '.risk-red { background-color: #ffebee; color: #c62828; font-weight: bold; padding: 5px 10px; }';
        html += '.risk-yellow { background-color: #fff8e1; color: #f57f17; font-weight: bold; padding: 5px 10px; }';
        html += '.risk-green { background-color: #e8f5e9; color: #2e7d32; font-weight: bold; padding: 5px 10px; }';
        html += '.warning { background-color: #fff3e0; border: 1px solid #ff9800; padding: 10px; margin: 10px 0; }';
        html += '@media print { body { margin: 0; } }';
        html += '</style></head><body>';
        html += '<h1>CAB Review Report</h1>';
        html += '<p><strong>Update Set:</strong> ' + this._escapeHtml(data.update_set_name) + '<br>';
        html += '<strong>Generated:</strong> ' + data.generated_at + '<br>';
        html += '<strong>By:</strong> ' + this._escapeHtml(data.generated_by) + '</p>';

        // Executive Summary
        html += '<h2>1. Executive Summary</h2>';
        html += '<p>' + this._escapeHtml(data.executive_summary) + '</p>';

        // Risk Assessment
        html += '<h2>2. Risk Assessment</h2>';
        var riskClass = data.risk_assessment.level === 'RED' ? 'risk-red' :
                       data.risk_assessment.level === 'YELLOW' ? 'risk-yellow' : 'risk-green';
        html += '<p><span class="' + riskClass + '">' + data.risk_assessment.level + '</span></p>';
        html += '<p>' + this._escapeHtml(data.risk_assessment.recommendation) + '</p>';
        if (data.risk_assessment.breakdown) {
            html += '<table><tr><th>Category</th><th>Count</th></tr>';
            html += '<tr><td>RED (code execution)</td><td>' + (data.risk_assessment.breakdown.red || 0) + '</td></tr>';
            html += '<tr><td>YELLOW (UI/UX)</td><td>' + (data.risk_assessment.breakdown.yellow || 0) + '</td></tr>';
            html += '<tr><td>GREEN (cosmetic)</td><td>' + (data.risk_assessment.breakdown.green || 0) + '</td></tr>';
            html += '<tr><td>Unknown</td><td>' + (data.risk_assessment.breakdown.unknown || 0) + '</td></tr>';
            html += '</table>';
        }

        // Affected Tables
        html += '<h2>3. Affected Tables</h2>';
        if (data.affected_tables && Object.keys(data.affected_tables).length > 0) {
            html += '<table><tr><th>Table</th><th>Records</th></tr>';
            for (var table in data.affected_tables) {
                html += '<tr><td>' + this._escapeHtml(table) + '</td><td>' + data.affected_tables[table] + '</td></tr>';
            }
            html += '</table>';
        } else {
            html += '<p>No affected tables.</p>';
        }

        // Collision Warnings
        html += '<h2>4. Collision Warnings</h2>';
        if (data.collision_count > 0) {
            html += '<div class="warning">' + data.collision_count + ' collision(s) detected!</div>';
            html += '<table><tr><th>Table</th><th>Record</th><th>Update Sets</th><th>Severity</th></tr>';
            for (var i = 0; i < data.collision_warnings.length; i++) {
                var c = data.collision_warnings[i];
                html += '<tr><td>' + this._escapeHtml(c.target_table) + '</td>';
                html += '<td>' + this._escapeHtml(c.target_record_name || c.target_record_sys_id) + '</td>';
                html += '<td>' + this._escapeHtml(c.update_sets.join(', ')) + '</td>';
                html += '<td>' + c.severity + '</td></tr>';
            }
            html += '</table>';
        } else {
            html += '<p>No collisions detected.</p>';
        }

        // Missing Dependencies
        html += '<h2>5. Missing Dependencies</h2>';
        if (data.missing_dep_count > 0) {
            html += '<div class="warning">' + data.missing_dep_count + ' missing dependency/dependencies!</div>';
            html += '<table><tr><th>Source Record</th><th>Target Table</th><th>Target Sys ID</th></tr>';
            for (var j = 0; j < data.missing_dependencies.length; j++) {
                var d = data.missing_dependencies[j];
                html += '<tr><td>' + this._escapeHtml(d.source_record) + '</td>';
                html += '<td>' + this._escapeHtml(d.target_table) + '</td>';
                html += '<td>' + this._escapeHtml(d.target_record_sys_id) + '</td></tr>';
            }
            html += '</table>';
        } else {
            html += '<p>No missing dependencies detected.</p>';
        }

        // Deployment Order
        html += '<h2>6. Deployment Order</h2>';
        if (data.deployment_order && data.deployment_order.length > 0) {
            html += '<table><tr><th>Position</th><th>Update Set</th><th>Reason</th></tr>';
            for (var k = 0; k < data.deployment_order.length; k++) {
                var o = data.deployment_order[k];
                html += '<tr><td>' + o.position + '</td>';
                html += '<td>' + this._escapeHtml(o.name) + '</td>';
                html += '<td>' + this._escapeHtml(o.reason) + '</td></tr>';
            }
            html += '</table>';
        } else {
            html += '<p>No specific deployment order required.</p>';
        }

        // Key Changes
        html += '<h2>7. Key Field Changes</h2>';
        if (data.key_changes && data.key_changes.length > 0) {
            html += '<table><tr><th>Record</th><th>Table</th><th>Action</th><th>Field</th><th>Value Preview</th></tr>';
            for (var m = 0; m < data.key_changes.length; m++) {
                var ch = data.key_changes[m];
                html += '<tr><td>' + this._escapeHtml(ch.record) + '</td>';
                html += '<td>' + this._escapeHtml(ch.table) + '</td>';
                html += '<td>' + this._escapeHtml(ch.action) + '</td>';
                html += '<td>' + this._escapeHtml(ch.field) + '</td>';
                html += '<td>' + this._escapeHtml(ch.value_preview) + '</td></tr>';
            }
            html += '</table>';
        } else {
            html += '<p>No significant field changes detected.</p>';
        }

        html += '</body></html>';
        return html;
    },

    /**
     * Persist the CAB report as an audit record
     */
    _persistReport: function(updateSetSysId, updateSetName, reportData, html, scanBatchId) {
        try {
            var gr = new GlideRecord('x_usi_inspector_audit');
            gr.initialize();
            gr.setValue('record_type', 'cab_report');
            gr.setValue('update_set_name', updateSetName);
            gr.setValue('update_set_sys_id', updateSetSysId);
            gr.setValue('content_json', JSON.stringify(reportData));
            gr.setValue('content_text', html);
            gr.setValue('risk_level', reportData.risk_assessment.level);
            gr.setValue('status', 'completed');
            gr.setValue('scan_batch_id', scanBatchId);
            gr.setValue('record_count', reportData.record_count);
            gr.insert();
        } catch (ex) {
            gs.log('USIReportGenerator._persistReport error: ' + ex.message, 'USI');
        }
    },

    /**
     * Get update set name
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

    /**
     * Escape HTML special characters
     */
    _escapeHtml: function(text) {
        if (!text) {
            return '';
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    type: 'USIReportGenerator'
};

// ============================================================
// USIBackupManager — pre-clone auto-backup of in-progress update sets
// ============================================================
var USIBackupManager = Class.create();
USIBackupManager.prototype = {
    initialize: function() {},

    /**
     * Backup all in-progress update sets
     * @return {Object} { ok, backed_up: Array, count, error }
     */
    backupAllInProgress: function() {
        try {
            var backed = [];
            var gr = new GlideRecord('sys_update_set');
            gr.addQuery('state', 'in progress');
            gr.query();
            while (gr.next()) {
                var result = this._backupOne(gr);
                if (result.ok) {
                    backed.push(result);
                }
            }
            // Send notification
            this._sendNotification(backed);
            return { ok: true, backed_up: backed, count: backed.length };
        } catch (ex) {
            gs.log('USIBackupManager.backupAllInProgress error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, backed_up: [], count: 0 };
        }
    },

    /**
     * Backup a single update set
     */
    _backupOne: function(updateSetGr) {
        try {
            var updateSetSysId = updateSetGr.getUniqueValue();
            var updateSetName = updateSetGr.getValue('name');
            var xmlContent = this._serializeUpdateSet(updateSetSysId, updateSetName);

            // Save as attachment to the update set record
            var attachmentSysId = '';
            try {
                attachmentSysId = GlideSysAttachment.write(updateSetGr, updateSetName + '_backup.xml',
                    'application/xml', xmlContent);
            } catch (attachEx) {
                gs.log('USIBackupManager._backupOne attachment error: ' + attachEx.message, 'USI');
            }

            // Create audit record
            var auditGr = new GlideRecord('x_usi_inspector_audit');
            auditGr.initialize();
            auditGr.setValue('record_type', 'backup');
            auditGr.setValue('update_set_name', updateSetName);
            auditGr.setValue('update_set_sys_id', updateSetSysId);
            auditGr.setValue('content_json', JSON.stringify({
                update_set_name: updateSetName,
                update_set_sys_id: updateSetSysId,
                backup_date: new GlideDateTime().toString(),
                xml_size: xmlContent.length
            }));
            auditGr.setValue('content_text', 'Backup created on ' + new GlideDateTime().toString() +
                '. XML attachment: ' + updateSetName + '_backup.xml. ' +
                'To restore: import the XML attachment via System Update Sets > Retrieve Update Sets.');
            auditGr.setValue('status', 'completed');
            auditGr.setValue('backup_attachment_sys_id', attachmentSysId);
            auditGr.insert();

            return {
                ok: true,
                update_set_name: updateSetName,
                update_set_sys_id: updateSetSysId,
                attachment_sys_id: attachmentSysId,
                xml_size: xmlContent.length
            };
        } catch (ex) {
            gs.log('USIBackupManager._backupOne error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message, update_set_name: updateSetGr.getValue('name') };
        }
    },

    /**
     * Serialize an update set to XML format
     */
    _serializeUpdateSet: function(updateSetSysId, updateSetName) {
        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n<update_set_export>\n';
        xml += '  <sys_update_set>\n';
        xml += '    <name>' + this._escapeXml(updateSetName) + '</name>\n';
        xml += '    <state>in progress</state>\n';
        xml += '    <sys_id>' + updateSetSysId + '</sys_id>\n';
        xml += '  </sys_update_set>\n';
        xml += '  <sys_update_xml_list>\n';

        try {
            var gr = new GlideRecord('sys_update_xml');
            gr.addQuery('update_set', updateSetSysId);
            gr.orderBy('name');
            gr.query();
            while (gr.next()) {
                xml += '    <sys_update_xml>\n';
                xml += '      <name>' + this._escapeXml(gr.getValue('name')) + '</name>\n';
                xml += '      <update_set>' + updateSetSysId + '</update_set>\n';
                var payload = gr.getValue('payload');
                if (payload) {
                    xml += '      <payload><![CDATA[' + payload + ']]></payload>\n';
                } else {
                    xml += '      <payload></payload>\n';
                }
                xml += '    </sys_update_xml>\n';
            }
        } catch (ex) {
            gs.log('USIBackupManager._serializeUpdateSet error: ' + ex.message, 'USI');
        }

        xml += '  </sys_update_xml_list>\n</update_set_export>';
        return xml;
    },

    /**
     * Send notification email about backup completion
     */
    _sendNotification: function(backed) {
        try {
            var groupSysId = gs.getProperty('x_usi_inspector.pre_clone_backup_group', '');
            if (!groupSysId) {
                gs.log('USIBackupManager: no notification group configured, skipping email', 'USI');
                return;
            }
            var subject = 'USI Pre-Clone Backup Complete — ' + backed.length + ' update set(s) backed up';
            var body = 'The following in-progress update sets have been backed up:\n\n';
            for (var i = 0; i < backed.length; i++) {
                body += (i + 1) + '. ' + backed[i].update_set_name +
                    ' (XML size: ' + backed[i].xml_size + ' bytes)\n';
            }
            body += '\nRestore: Navigate to System Update Sets > Retrieved Update Sets and import the XML attachments.';
            gs.eventQueue('x_usi_inspector.backup_complete', null, subject, body);
        } catch (ex) {
            gs.log('USIBackupManager._sendNotification error: ' + ex.message, 'USI');
        }
    },

    /**
     * Restore a backup from an audit record
     */
    restoreBackup: function(auditSysId) {
        if (!auditSysId) {
            return { ok: false, error: 'auditSysId is required' };
        }
        try {
            var gr = new GlideRecord('x_usi_inspector_audit');
            if (!gr.get(auditSysId)) {
                return { ok: false, error: 'Audit record not found' };
            }
            if (gr.getValue('record_type') !== 'backup') {
                return { ok: false, error: 'Audit record is not a backup' };
            }
            var updateSetSysId = gr.getValue('update_set_sys_id');
            var attachmentSysId = gr.getValue('backup_attachment_sys_id');
            if (!attachmentSysId) {
                return { ok: false, error: 'No attachment found on backup record' };
            }
            // Read attachment content using correct API signature
            // GlideSysAttachment.getContentStream(tableName, recordSysId, attachmentSysId)
            var tableName = 'sys_update_set';
            var attachmentStream = GlideSysAttachment.getContentStream(tableName, updateSetSysId, attachmentSysId);
            var attachmentContent = '';
            if (attachmentStream) {
                var reader = new GlideTextReader(attachmentStream);
                attachmentContent = reader.read();
            }
            return {
                ok: true,
                message: 'Backup found. To restore: download the XML attachment and import via ' +
                    'System Update Sets > Retrieved Update Sets > Import Update Set from XML.',
                update_set_name: gr.getValue('update_set_name'),
                update_set_sys_id: updateSetSysId,
                attachment_sys_id: attachmentSysId,
                xml_content: attachmentContent
            };
        } catch (ex) {
            gs.log('USIBackupManager.restoreBackup error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message };
        }
    },

    _escapeXml: function(text) {
        if (!text) {
            return '';
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    },

    type: 'USIBackupManager'
};

// ============================================================
// USIAIChangeSummarizer — AI-assisted change summary with rule-based fallback
// ============================================================
var USIAIChangeSummarizer = Class.create();
USIAIChangeSummarizer.prototype = {
    initialize: function() {
        this.parser = new USIContentParser();
        this.riskScorer = new USIRiskScorer();
    },

    /**
     * Generate an AI-assisted summary for an update set
     * Uses GenAI Controller if available, falls back to rule-based summarizer
     * @param {String} updateSetSysId
     * @return {Object} { ok, summary, assessment, source: 'ai'|'rule_based', error }
     */
    generateSummary: function(updateSetSysId) {
        if (!updateSetSysId) {
            return { ok: false, error: 'updateSetSysId is required' };
        }
        try {
            // Collect structured change data
            var content = this.parser.parseUpdateSet(updateSetSysId);
            if (!content.ok) {
                return { ok: false, error: content.error };
            }
            var risk = this.riskScorer.scoreUpdateSet(updateSetSysId);
            if (!risk.ok) {
                return { ok: false, error: risk.error };
            }
            var updateSetName = this._getUpdateSetName(updateSetSysId);
            var structuredChanges = this._buildStructuredChanges(content.entries, risk);
            var promptData = {
                update_set_name: updateSetName,
                risk_score: risk.risk_level,
                record_count: content.count,
                affected_tables: Object.keys(risk.affected_tables || {}),
                collision_count: 0,
                missing_dep_count: 0,
                structured_changes: structuredChanges
            };

            // Try AI first
            if (this._isAIAvailable()) {
                var aiResult = this._callGenAI(promptData);
                if (aiResult.ok) {
                    this._persistSummary(updateSetSysId, updateSetName, aiResult, 'ai');
                    return {
                        ok: true,
                        summary: aiResult.summary,
                        assessment: aiResult.assessment,
                        recommendation: aiResult.recommendation,
                        source: 'ai'
                    };
                }
                // AI failed — fall through to rule-based
                gs.log('USIAIChangeSummarizer: AI call failed, falling back to rule-based. Error: ' +
                    (aiResult.error || 'unknown'), 'USI');
            }

            // Rule-based fallback
            var ruleResult = this._ruleBasedSummary(promptData);
            this._persistSummary(updateSetSysId, updateSetName, ruleResult, 'rule_based');
            return {
                ok: true,
                summary: ruleResult.summary,
                assessment: ruleResult.assessment,
                recommendation: ruleResult.recommendation,
                source: 'rule_based'
            };
        } catch (ex) {
            gs.log('USIAIChangeSummarizer.generateSummary error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Check if GenAI Controller / Now Assist is available on this instance
     */
    _isAIAvailable: function() {
        try {
            // Check if sn_generative_ai_cfg_provider table exists and has records
            var tableExists = GlideTable.isValid('sn_generative_ai_cfg_provider');
            if (!tableExists) {
                return false;
            }
            var gr = new GlideRecord('sn_generative_ai_cfg_provider');
            gr.setLimit(1);
            gr.query();
            return gr.hasNext();
        } catch (e) {
            return false;
        }
    },

    /**
     * Call GenAI Controller with structured prompt
     */
    _callGenAI: function(promptData) {
        try {
            // Build the prompt
            var prompt = this._buildPrompt(promptData);

            // Attempt to use GenAI Controller
            // This uses the sn_generative_ai API if available
            var genAI = null;
            try {
                genAI = new sn_generative_ai.GenAIController();
            } catch (e) {
                return { ok: false, error: 'GenAIController not available: ' + e.message };
            }

            if (!genAI) {
                return { ok: false, error: 'GenAIController instantiation returned null' };
            }

            // Call the LLM with the prompt
            var response = '';
            try {
                // Use the standard sn_generative_ai chatCompletion API
                var messages = [
                    { role: 'system', content: 'You are a ServiceNow deployment reviewer analyzing update set changes for a Change Advisory Board. Produce clear, business-friendly assessments.' },
                    { role: 'user', content: prompt }
                ];
                // chatCompletion(modelId, messages) is the correct API
                var modelId = sn_generative_ai.ModelConfig.getModelId('now_llm_generic');
                var resultObj = genAI.chatCompletion(modelId, messages);
                if (resultObj && resultObj.choices && resultObj.choices.length > 0) {
                    response = resultObj.choices[0].message.content;
                } else if (typeof resultObj === 'string') {
                    response = resultObj;
                }
            } catch (e2) {
                return { ok: false, error: 'GenAI completion failed: ' + e2.message };
            }

            if (!response) {
                return { ok: false, error: 'Empty response from GenAI Controller' };
            }

            // Parse response — try JSON first, then plain text
            var parsed = this._parseAIResponse(response);
            return {
                ok: true,
                summary: parsed.executive_summary || response.substring(0, 500),
                assessment: parsed.risk_assessment || promptData.risk_score,
                recommendation: parsed.recommendation || this._getRecommendation(promptData.risk_score),
                breaking_changes: parsed.breaking_changes || [],
                deployment_notes: parsed.deployment_notes || ''
            };
        } catch (ex) {
            gs.log('USIAIChangeSummarizer._callGenAI error: ' + ex.message, 'USI');
            return { ok: false, error: ex.message };
        }
    },

    /**
     * Build the LLM prompt from structured data
     */
    _buildPrompt: function(data) {
        var prompt = 'Analyze this ServiceNow update set and provide:\n';
        prompt += '1. Executive Summary (3 sentences, business language, no ServiceNow jargon)\n';
        prompt += '2. Risk Assessment (LOW / MEDIUM / HIGH) with specific reasoning\n';
        prompt += '3. Potential Breaking Changes (list specific risks)\n';
        prompt += '4. Recommendation: APPROVE / REVIEW WITH CAUTION / DO NOT DEPLOY\n';
        prompt += '5. Deployment Notes (any special instructions)\n\n';
        prompt += 'Update set name: ' + data.update_set_name + '\n';
        prompt += 'Risk score: ' + data.risk_score + '\n';
        prompt += 'Total records: ' + data.record_count + '\n';
        prompt += 'Affected tables: ' + data.affected_tables.join(', ') + '\n';
        prompt += 'Collision warnings: ' + data.collision_count + '\n';
        prompt += 'Missing dependencies: ' + data.missing_dep_count + '\n\n';
        prompt += 'Key changes:\n' + JSON.stringify(data.structured_changes, null, 2) + '\n\n';
        prompt += 'Respond as JSON with keys: executive_summary, risk_assessment (LOW|MEDIUM|HIGH), ';
        prompt += 'risk_reasoning, breaking_changes (array), recommendation (APPROVE|REVIEW_WITH_CAUTION|DO_NOT_DEPLOY), deployment_notes';
        return prompt;
    },

    /**
     * Parse AI response — try JSON, fall back to text extraction
     */
    _parseAIResponse: function(response) {
        try {
            // Try parsing as JSON
            return JSON.parse(response);
        } catch (e) {
            // Not JSON — extract what we can from text
            return {
                executive_summary: response.substring(0, 300),
                risk_assessment: 'MEDIUM',
                recommendation: 'REVIEW_WITH_CAUTION',
                breaking_changes: [],
                deployment_notes: ''
            };
        }
    },

    /**
     * Rule-based summary fallback (no AI license)
     */
    _ruleBasedSummary: function(data) {
        // Table name to business description mapping
        var tableDescriptions = {
            'sys_security_acl': 'security access control rules',
            'sys_script': 'business rules (server-side automation)',
            'sys_script_include': 'script includes (reusable server-side code)',
            'sys_ui_action': 'UI actions (buttons and links)',
            'sys_script_client': 'client scripts (browser-side code)',
            'sys_ui_policy': 'UI policies (form behavior rules)',
            'sys_ui_form_section': 'form layout sections',
            'sysevent_email': 'email notifications',
            'sysevent_email_action': 'email notification actions',
            'sys_ui_list': 'list view configurations',
            'sys_home': 'homepage configurations',
            'sys_ui_css': 'stylesheet changes'
        };

        // Build summary
        var tableList = [];
        for (var i = 0; i < data.affected_tables.length; i++) {
            var desc = tableDescriptions[data.affected_tables[i]] || data.affected_tables[i];
            tableList.push(desc);
        }
        var tableStr = tableList.length > 0 ? tableList.join(', ') : 'various configuration records';

        var summary = 'This update set ("' + data.update_set_name + '") contains ' + data.record_count +
            ' record(s) modifying ' + tableStr + '. ';
        if (data.risk_score === 'RED') {
            summary += 'It includes code execution changes that could affect platform behavior, security, or integrations.';
        } else if (data.risk_score === 'YELLOW') {
            summary += 'It includes UI/UX changes that could affect user experience and workflow interactions.';
        } else {
            summary += 'It contains only cosmetic changes with minimal risk to platform functionality.';
        }

        var recommendation = this._getRecommendation(data.risk_score);

        return {
            summary: summary,
            assessment: data.risk_score === 'RED' ? 'HIGH' :
                       data.risk_score === 'YELLOW' ? 'MEDIUM' : 'LOW',
            recommendation: recommendation,
            breaking_changes: data.risk_score === 'RED' ?
                ['Contains code execution records — full regression testing required'] : [],
            deployment_notes: data.risk_score === 'RED' ?
                'Deploy to sub-production first. Validate all integrations after deployment.' :
                'Standard deployment process applies.'
        };
    },

    /**
     * Get recommendation from risk level
     */
    _getRecommendation: function(riskLevel) {
        switch (riskLevel) {
            case 'RED':
                return 'DO NOT DEPLOY';
            case 'YELLOW':
                return 'REVIEW WITH CAUTION';
            case 'GREEN':
                return 'APPROVE';
            default:
                return 'REVIEW WITH CAUTION';
        }
    },

    /**
     * Build structured changes for the prompt
     */
    _buildStructuredChanges: function(entries, risk) {
        var changes = [];
        for (var i = 0; i < entries.length && changes.length < 20; i++) {
            var entry = entries[i];
            changes.push({
                table: entry.target_table,
                record: entry.record_name,
                action: entry.action,
                type: entry.type
            });
        }
        return changes;
    },

    /**
     * Persist AI summary as audit record
     */
    _persistSummary: function(updateSetSysId, updateSetName, result, source) {
        try {
            var gr = new GlideRecord('x_usi_inspector_audit');
            gr.initialize();
            gr.setValue('record_type', 'ai_summary');
            gr.setValue('update_set_name', updateSetName);
            gr.setValue('update_set_sys_id', updateSetSysId);
            gr.setValue('content_json', JSON.stringify({
                summary: result.summary,
                assessment: result.assessment,
                recommendation: result.recommendation,
                source: source,
                generated_at: new GlideDateTime().toString()
            }));
            gr.setValue('content_text', result.summary);
            gr.setValue('status', 'completed');
            gr.insert();
        } catch (ex) {
            gs.log('USIAIChangeSummarizer._persistSummary error: ' + ex.message, 'USI');
        }
    },

    /**
     * Get update set name
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

    type: 'USIAIChangeSummarizer'
};