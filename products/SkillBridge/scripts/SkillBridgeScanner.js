// SkillBridge — ServiceNow Developer Portfolio Exporter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// SkillBridgeScanner — Core engine: artifact discovery, code analysis, skill mapping.
// @class SkillBridgeScanner @namespace x_snc_skb

var SkillBridgeScanner = Class.create();
SkillBridgeScanner.prototype = {
    initialize: function() {
        this.artifactTypeMap = {
            'sys_script': { label: 'Business Rules', skill: 'Event-driven programming', category: 'Backend' },
            'sys_script_include': { label: 'Script Includes', skill: 'OOP JavaScript', category: 'Engineering' },
            'sys_ui_action': { label: 'UI Actions', skill: 'UI/server interaction', category: 'Frontend' },
            'sys_ui_client_script': { label: 'Client Scripts', skill: 'Frontend JavaScript', category: 'Frontend' },
            'sys_ui_policy': { label: 'UI Policies', skill: 'Declarative UI logic', category: 'Frontend' },
            'sys_security_acl': { label: 'ACLs', skill: 'RBAC architecture', category: 'Security' },
            'sys_rest_message': { label: 'REST Messages', skill: 'API integration', category: 'Integration' },
            'sys_ws_definition': { label: 'Scripted REST APIs', skill: 'API development', category: 'Backend' },
            'sysauto_script': { label: 'Scheduled Jobs', skill: 'Cron/automation', category: 'DevOps' },
            'sys_hub_flow': { label: 'Flow Designer Flows', skill: 'Workflow automation', category: 'Automation' }
        };

        this.patternRules = [
            { regex: /\bGlideRecord\b/, skill: 'Database design', category: 'Backend', weight: 3 },
            { regex: /\bGlideAggregate\b/, skill: 'Data aggregation', category: 'Data', weight: 2 },
            { regex: /\bRESTMessageV2\b/, skill: 'API integration', category: 'Integration', weight: 3 },
            { regex: /\bRESTMessage\b/, skill: 'API integration', category: 'Integration', weight: 2 },
            { regex: /\bgs\.eventQueue\b/, skill: 'Event-driven architecture', category: 'Architecture', weight: 2 },
            { regex: /\bgs\.eventQueueScheduled\b/, skill: 'Event-driven architecture', category: 'Architecture', weight: 2 },
            { regex: /\bGlideSysAttachment\b/, skill: 'File handling', category: 'Backend', weight: 1 },
            { regex: /\bJSON\.parse\b/, skill: 'JSON handling', category: 'Backend', weight: 1 },
            { regex: /\bJSON\.stringify\b/, skill: 'JSON handling', category: 'Backend', weight: 1 },
            { regex: /\bGlideDateTime\b/, skill: 'Date/time manipulation', category: 'Backend', weight: 1 },
            { regex: /\bGlideDuration\b/, skill: 'Duration calculation', category: 'Backend', weight: 1 },
            { regex: /\bgs\.log\b/, skill: 'Logging/debugging', category: 'Engineering', weight: 1 },
            { regex: /\bgs\.info\b/, skill: 'Logging/debugging', category: 'Engineering', weight: 1 },
            { regex: /\bgs\.error\b/, skill: 'Error handling', category: 'Engineering', weight: 1 },
            { regex: /\btry\s*\{/, skill: 'Error handling', category: 'Engineering', weight: 2 },
            { regex: /\bClass\.create\b/, skill: 'OOP JavaScript', category: 'Engineering', weight: 3 },
            { regex: /\bprototype\b/, skill: 'OOP JavaScript', category: 'Engineering', weight: 2 },
            { regex: /\bArrayUtil\b/, skill: 'Data structures', category: 'Engineering', weight: 1 },
            { regex: /\bGlideFilter\b/, skill: 'Query design', category: 'Backend', weight: 1 },
            { regex: /\bGlideEncrypter\b/, skill: 'Security/cryptography', category: 'Security', weight: 2 },
            { regex: /\bSOAPMessageV2\b/, skill: 'SOAP/web services', category: 'Integration', weight: 2 },
            { regex: /\bMID Server\b/, skill: 'Infrastructure integration', category: 'DevOps', weight: 2 },
            { regex: /\bTransformMap\b/, skill: 'ETL/data transformation', category: 'Data', weight: 2 },
            { regex: /\bGlideExcelParser\b/, skill: 'Data import/export', category: 'Data', weight: 1 },
            { regex: /\bEmail\.send\b/, skill: 'Event-driven communication', category: 'Integration', weight: 1 },
            { regex: /\bgs\.getUser\b/, skill: 'User/session management', category: 'Backend', weight: 1 },
            { regex: /\bgs\.getProperty\b/, skill: 'Configuration management', category: 'Engineering', weight: 1 },
            { regex: /\bGlideScopedEvaluator\b/, skill: 'Dynamic code execution', category: 'Engineering', weight: 2 },
            { regex: /\bWorkflow\.fireEvent\b/, skill: 'Workflow automation', category: 'Automation', weight: 2 },
            { regex: /\bFlowRunner\b/, skill: 'Workflow automation', category: 'Automation', weight: 2 }
        ];
    },

    /**
     * Full scan: crawl all configured artifact types, analyze code, map skills, store snapshot.
     * @param {Object} configObj - { config_name, artifact_types, date_from, date_to, exclude_patterns }
     * @returns {string} snapshot sys_id
     */
    scanAll: function(configObj) {
        var config = configObj || {};
        var artifactTypes = config.artifact_types || 'sys_script,sys_script_include,sys_rest_message,sys_ws_definition,sys_security_acl,sys_ui_action,sys_ui_client_script,sys_ui_policy,sysauto_script,sys_hub_flow';
        var typeList = artifactTypes.split(',').map(function(t) { return t.trim(); });
        var dateFrom = config.date_from || '';
        var dateTo = config.date_to || '';
        var excludePatterns = [];
        try {
            if (config.exclude_patterns) {
                excludePatterns = JSON.parse(config.exclude_patterns);
            }
        } catch (e) {
            excludePatterns = [];
        }

        var allArtifacts = [];
        var totalCount = 0;

        for (var i = 0; i < typeList.length; i++) {
            var typeName = typeList[i];
            if (!this.artifactTypeMap[typeName]) continue;
            var artifacts = this._crawlTable(typeName, dateFrom, dateTo, excludePatterns);
            allArtifacts = allArtifacts.concat(artifacts);
            totalCount += artifacts.length;
        }

        // Analyze each artifact for patterns
        for (var j = 0; j < allArtifacts.length; j++) {
            var scriptText = allArtifacts[j].script || '';
            allArtifacts[j].patterns = this._detectPatterns(scriptText);
        }

        // Map to transferable skills
        var skills = this._mapToSkills(allArtifacts);

        // Store snapshot
        var snapshotName = config.config_name || ('Scan ' + new GlideDateTime().getDisplayValue());
        var snapshotId = this._storeSnapshot(snapshotName, allArtifacts, skills, config);

        return snapshotId;
    },

    /**
     * Scan a single artifact type.
     * @param {string} typeName - Table name (e.g., 'sys_script')
     * @param {Object} configObj - Configuration object
     * @returns {number} artifact count
     */
    scanArtifactType: function(typeName, configObj) {
        var config = configObj || {};
        var dateFrom = config.date_from || '';
        var dateTo = config.date_to || '';
        var excludePatterns = [];
        try {
            if (config.exclude_patterns) {
                excludePatterns = JSON.parse(config.exclude_patterns);
            }
        } catch (e) {
            excludePatterns = [];
        }

        var artifacts = this._crawlTable(typeName, dateFrom, dateTo, excludePatterns);
        return artifacts.length;
    },

    /**
     * Returns list of supported artifact types with table names.
     * @returns {Array} artifact type definitions
     */
    getArtifactTypes: function() {
        var types = [];
        for (var tableName in this.artifactTypeMap) {
            types.push({
                table_name: tableName,
                label: this.artifactTypeMap[tableName].label,
                skill: this.artifactTypeMap[tableName].skill,
                category: this.artifactTypeMap[tableName].category
            });
        }
        return types;
    },

    /**
     * Analyze a script for transferable skill patterns.
     * @param {string} scriptText - The script content
     * @param {string} artifactType - The artifact type (table name)
     * @returns {Object} skill map with confidence scores
     */
    analyzeCode: function(scriptText, artifactType) {
        var patterns = this._detectPatterns(scriptText || '');
        var artifactInfo = this.artifactTypeMap[artifactType] || {};
        return {
            artifact_type: artifactType,
            artifact_label: artifactInfo.label || artifactType,
            base_skill: artifactInfo.skill || 'Unknown',
            base_category: artifactInfo.category || 'Other',
            patterns: patterns,
            skill_map: this._mapToSkills([{ script: scriptText, type: artifactType, patterns: patterns }])
        };
    },

    /**
     * Crawl a table for developer-authored records.
     * @private
     */
    _crawlTable: function(tableName, dateFrom, dateTo, excludePatterns) {
        var artifacts = [];
        var gr = new GlideRecord(tableName);
        gr.addQuery('sys_scope', 'global');
        // sys_hub_flow does not have a 'script' column — skip the not-null filter for it
        if (tableName !== 'sys_hub_flow') {
            gr.addNotNullQuery('script');
        }
        if (dateFrom) {
            gr.addQuery('sys_updated_on', '>=', dateFrom);
        }
        if (dateTo) {
            gr.addQuery('sys_updated_on', '<=', dateTo);
        }
        gr.setLimit(500);
        gr.query();

        while (gr.next()) {
            var name = gr.getValue('name') || gr.getValue('short_description') || gr.getValue('action_name') || '';
            // Check exclusion patterns
            var excluded = false;
            for (var i = 0; i < excludePatterns.length; i++) {
                if (name.indexOf(excludePatterns[i]) !== -1) {
                    excluded = true;
                    break;
                }
            }
            if (excluded) continue;

            // sys_hub_flow stores flow data differently — extract from 'flow' field
            var scriptContent = '';
            if (tableName === 'sys_hub_flow') {
                scriptContent = gr.getValue('flow') || '';
            } else {
                scriptContent = gr.getValue('script') || '';
            }

            artifacts.push({
                sys_id: gr.getUniqueValue(),
                name: name,
                type: tableName,
                type_label: this.artifactTypeMap[tableName] ? this.artifactTypeMap[tableName].label : tableName,
                script: scriptContent,
                updated_on: gr.getValue('sys_updated_on') || '',
                updated_by: gr.getValue('sys_updated_by') || ''
            });
        }
        return artifacts;
    },

    /**
     * Detect transferable skill patterns in script text.
     * @private
     */
    _detectPatterns: function(scriptText) {
        var detected = [];
        for (var i = 0; i < this.patternRules.length; i++) {
            var rule = this.patternRules[i];
            var matches = scriptText.match(rule.regex);
            if (matches && matches.length > 0) {
                detected.push({
                    skill: rule.skill,
                    category: rule.category,
                    occurrences: matches.length,
                    confidence: this._calculateConfidence(matches.length, rule.weight)
                });
            }
        }
        return detected;
    },

    /**
     * Map detected patterns to transferable skill categories with confidence scores.
     * @private
     */
    _mapToSkills: function(artifacts) {
        var skillMap = {};
        for (var i = 0; i < artifacts.length; i++) {
            var patterns = artifacts[i].patterns || [];
            for (var j = 0; j < patterns.length; j++) {
                var p = patterns[j];
                var key = p.skill;
                if (!skillMap[key]) {
                    skillMap[key] = {
                        skill: p.skill,
                        category: p.category,
                        total_occurrences: 0,
                        artifact_count: 0,
                        confidence: 0,
                        artifact_types: {}
                    };
                }
                skillMap[key].total_occurrences += p.occurrences;
                skillMap[key].artifact_count += 1;
                var atype = artifacts[i].type_label || artifacts[i].type;
                skillMap[key].artifact_types[atype] = (skillMap[key].artifact_types[atype] || 0) + 1;
            }
        }

        // Calculate confidence scores
        for (var skillName in skillMap) {
            var entry = skillMap[skillName];
            var typeCount = Object.keys(entry.artifact_types).length;
            entry.confidence = Math.min(100, Math.round(
                (entry.total_occurrences * 5) + (entry.artifact_count * 3) + (typeCount * 10)
            ));
            entry.confidence_level = entry.confidence >= 80 ? 'Expert' :
                                     entry.confidence >= 50 ? 'Proficient' :
                                     entry.confidence >= 25 ? 'Familiar' : 'Exposure';
        }

        return skillMap;
    },

    /**
     * Calculate confidence score from pattern count and weight.
     * @private
     */
    _calculateConfidence: function(occurrences, weight) {
        return Math.min(100, Math.round(occurrences * weight * 5));
    },

    /**
     * Store scan results in x_snc_skb_skill_snapshot.
     * @private
     */
    _storeSnapshot: function(name, artifacts, skills, config) {
        var gr = new GlideRecord('x_snc_skb_skill_snapshot');
        gr.initialize();
        gr.setValue('snapshot_name', name);
        gr.setValue('scanned_by', gs.getUserName());
        gr.setValue('scanned_at', new GlideDateTime().getValue());
        gr.setValue('total_artifacts', artifacts.length);
        gr.setValue('artifacts_json', JSON.stringify(artifacts));
        gr.setValue('skills_json', JSON.stringify(skills));
        gr.setValue('status', 'complete');
        if (config) {
            gr.setValue('config_json', JSON.stringify(config));
        }
        try {
            var sysId = gr.insert();
            return sysId;
        } catch (e) {
            gs.error('SkillBridgeScanner: Failed to store snapshot: ' + e.message);
            return '';
        }
    },

    type: 'SkillBridgeScanner'
};
