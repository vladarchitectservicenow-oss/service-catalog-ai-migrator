// SkillBridge — ServiceNow Developer Portfolio Exporter
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// SkillBridgeExporter — Output engine: portfolio generation, snapshot management, export history.
// @class SkillBridgeExporter @namespace x_snc_skb

var SkillBridgeExporter = Class.create();
SkillBridgeExporter.prototype = {
    initialize: function() {},

    /**
     * Generate portfolio in specified format.
     * @param {string} snapshotId - Snapshot sys_id
     * @param {string} format - 'markdown', 'json', or 'linkedin'
     * @returns {string} attachment sys_id
     */
    generatePortfolio: function(snapshotId, format) {
        var snapshot = this.getSnapshot(snapshotId);
        if (!snapshot) {
            gs.error('SkillBridgeExporter: Snapshot not found: ' + snapshotId);
            return '';
        }

        var content = '';
        var fileName = '';
        var contentType = '';

        switch (format) {
            case 'markdown':
                content = this._generateMarkdown(snapshot);
                fileName = 'skillbridge_portfolio_' + snapshotId + '.md';
                contentType = 'text/markdown';
                break;
            case 'json':
                content = this._generateJSON(snapshot);
                fileName = 'skillbridge_skills_' + snapshotId + '.json';
                contentType = 'application/json';
                break;
            case 'linkedin':
                content = this._generateSkillList(snapshot);
                fileName = 'skillbridge_linkedin_' + snapshotId + '.txt';
                contentType = 'text/plain';
                break;
            default:
                gs.error('SkillBridgeExporter: Unknown format: ' + format);
                return '';
        }

        var attachmentId = this._attachFile(snapshotId, fileName, content, contentType);
        if (attachmentId) {
            this._updateExportLog(snapshotId, format, attachmentId);
        }
        return attachmentId;
    },

    /**
     * Retrieve a snapshot with full artifact and skill data.
     * @param {string} snapshotId - Snapshot sys_id
     * @returns {Object|null} snapshot data
     */
    getSnapshot: function(snapshotId) {
        var gr = new GlideRecord('x_snc_skb_skill_snapshot');
        if (!gr.get(snapshotId)) return null;

        var artifacts = [];
        var skills = {};
        try {
            artifacts = JSON.parse(gr.getValue('artifacts_json') || '[]');
        } catch (e) {
            artifacts = [];
        }
        try {
            skills = JSON.parse(gr.getValue('skills_json') || '{}');
        } catch (e) {
            skills = {};
        }

        return {
            sys_id: gr.getUniqueValue(),
            snapshot_name: gr.getValue('snapshot_name'),
            scanned_by: gr.getValue('scanned_by'),
            scanned_at: gr.getValue('scanned_at'),
            total_artifacts: parseInt(gr.getValue('total_artifacts'), 10) || 0,
            status: gr.getValue('status'),
            artifacts: artifacts,
            skills: skills
        };
    },

    /**
     * List recent snapshots.
     * @param {number} limit - Max results (default 10)
     * @returns {Array} snapshot summaries
     */
    getRecentSnapshots: function(limit) {
        var maxResults = limit || 10;
        var snapshots = [];
        var gr = new GlideRecord('x_snc_skb_skill_snapshot');
        gr.orderByDesc('scanned_at');
        gr.setLimit(maxResults);
        gr.query();

        while (gr.next()) {
            snapshots.push({
                sys_id: gr.getUniqueValue(),
                snapshot_name: gr.getValue('snapshot_name'),
                scanned_by: gr.getValue('scanned_by'),
                scanned_at: gr.getValue('scanned_at'),
                total_artifacts: parseInt(gr.getValue('total_artifacts'), 10) || 0,
                status: gr.getValue('status')
            });
        }
        return snapshots;
    },

    /**
     * Get skill breakdown with confidence scores.
     * @param {string} snapshotId - Snapshot sys_id
     * @returns {Object} skill summary
     */
    getSkillSummary: function(snapshotId) {
        var snapshot = this.getSnapshot(snapshotId);
        if (!snapshot) return { error: 'Snapshot not found' };

        var skills = snapshot.skills;
        var skillList = [];
        for (var skillName in skills) {
            skillList.push(skills[skillName]);
        }

        // Sort by confidence descending
        skillList.sort(function(a, b) {
            return b.confidence - a.confidence;
        });

        return {
            snapshot_id: snapshotId,
            snapshot_name: snapshot.snapshot_name,
            scanned_at: snapshot.scanned_at,
            total_skills: skillList.length,
            top_skills: skillList.slice(0, 10),
            all_skills: skillList
        };
    },

    /**
     * Diff two snapshots to show skill growth.
     * @param {string} snapshotId1 - First snapshot sys_id
     * @param {string} snapshotId2 - Second snapshot sys_id
     * @returns {Object} comparison data
     */
    compareSnapshots: function(snapshotId1, snapshotId2) {
        var snap1 = this.getSnapshot(snapshotId1);
        var snap2 = this.getSnapshot(snapshotId2);

        if (!snap1 || !snap2) {
            return { error: 'One or both snapshots not found' };
        }

        var skills1 = snap1.skills || {};
        var skills2 = snap2.skills || {};

        var growth = [];
        var newSkills = [];
        var allSkillNames = {};

        for (var name in skills1) { allSkillNames[name] = true; }
        for (var name2 in skills2) { allSkillNames[name2] = true; }

        for (var skillName in allSkillNames) {
            var s1 = skills1[skillName];
            var s2 = skills2[skillName];

            if (s1 && s2) {
                var diff = s2.confidence - s1.confidence;
                growth.push({
                    skill: skillName,
                    category: s2.category,
                    confidence_before: s1.confidence,
                    confidence_after: s2.confidence,
                    change: diff,
                    direction: diff > 0 ? 'growth' : diff < 0 ? 'decline' : 'stable'
                });
            } else if (!s1 && s2) {
                newSkills.push({
                    skill: skillName,
                    category: s2.category,
                    confidence: s2.confidence
                });
            }
        }

        growth.sort(function(a, b) { return b.change - a.change; });

        return {
            snapshot_1: { id: snapshotId1, name: snap1.snapshot_name, date: snap1.scanned_at, artifacts: snap1.total_artifacts },
            snapshot_2: { id: snapshotId2, name: snap2.snapshot_name, date: snap2.scanned_at, artifacts: snap2.total_artifacts },
            artifact_growth: snap2.total_artifacts - snap1.total_artifacts,
            skill_growth: growth,
            new_skills: newSkills
        };
    },

    /**
     * Generate Markdown portfolio.
     * @private
     */
    _generateMarkdown: function(snapshot) {
        var md = [];
        md.push('# SkillBridge Developer Portfolio');
        md.push('');
        md.push('**Generated:** ' + snapshot.scanned_at);
        md.push('**Developer:** ' + snapshot.scanned_by);
        md.push('**Artifacts Analyzed:** ' + snapshot.total_artifacts);
        md.push('');
        md.push('---');
        md.push('');
        md.push('## Transferable Skills Summary');
        md.push('');

        var skills = snapshot.skills || {};
        var skillList = [];
        for (var name in skills) {
            skillList.push(skills[name]);
        }
        skillList.sort(function(a, b) { return b.confidence - a.confidence; });

        md.push('| Skill | Category | Confidence | Level | Artifacts |');
        md.push('|-------|----------|------------|-------|-----------|');
        for (var i = 0; i < skillList.length; i++) {
            var s = skillList[i];
            md.push('| ' + s.skill + ' | ' + s.category + ' | ' + s.confidence + '% | ' + s.confidence_level + ' | ' + s.artifact_count + ' |');
        }

        md.push('');
        md.push('---');
        md.push('');
        md.push('## Artifact Inventory');
        md.push('');

        var artifacts = snapshot.artifacts || [];
        var typeCounts = {};
        for (var j = 0; j < artifacts.length; j++) {
            var t = artifacts[j].type_label || artifacts[j].type;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        }

        md.push('| Artifact Type | Count |');
        md.push('|--------------|-------|');
        for (var typeName in typeCounts) {
            md.push('| ' + typeName + ' | ' + typeCounts[typeName] + ' |');
        }

        md.push('');
        md.push('---');
        md.push('');
        md.push('## Career Path Suggestions');
        md.push('');
        md.push('Based on your skill profile, consider these career directions:');
        md.push('');

        // Generate career suggestions based on top skills
        var topCategories = {};
        for (var k = 0; k < skillList.length; k++) {
            var cat = skillList[k].category;
            topCategories[cat] = (topCategories[cat] || 0) + skillList[k].confidence;
        }

        if (topCategories['Integration'] > 100) {
            md.push('- **Integration Architect:** Your API and integration skills are strong. Consider roles focused on system integration, middleware, and API gateway design.');
        }
        if (topCategories['Backend'] > 100) {
            md.push('- **Backend Engineer:** Your database and server-side skills translate directly to backend development roles in Node.js, Python, or Java.');
        }
        if (topCategories['Engineering'] > 100) {
            md.push('- **Software Engineer:** Your OOP and modular design patterns are transferable to any modern software engineering role.');
        }
        if (topCategories['Security'] > 50) {
            md.push('- **Security Engineer:** Your RBAC and access control experience maps well to identity and access management (IAM) roles.');
        }
        if (topCategories['Automation'] > 50) {
            md.push('- **Automation Engineer:** Your workflow and process automation skills are valuable in DevOps and RPA roles.');
        }
        if (topCategories['Data'] > 50) {
            md.push('- **Data Engineer:** Your ETL and data transformation experience translates to data pipeline and analytics engineering.');
        }

        md.push('');
        md.push('---');
        md.push('');
        md.push('*Generated by SkillBridge — ServiceNow Developer Portfolio Exporter*');
        md.push('*Copyright (C) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.*');

        return md.join('\n');
    },

    /**
     * Generate JSON skill map.
     * @private
     */
    _generateJSON: function(snapshot) {
        var output = {
            generator: 'SkillBridge v1.0.0',
            generated_at: snapshot.scanned_at,
            developer: snapshot.scanned_by,
            total_artifacts: snapshot.total_artifacts,
            skills: []
        };

        var skills = snapshot.skills || {};
        for (var name in skills) {
            output.skills.push(skills[name]);
        }
        output.skills.sort(function(a, b) { return b.confidence - a.confidence; });

        return JSON.stringify(output, null, 2);
    },

    /**
     * Generate LinkedIn-ready skill list.
     * @private
     */
    _generateSkillList: function(snapshot) {
        var lines = [];
        lines.push('LinkedIn Skills — Generated by SkillBridge');
        lines.push('==========================================');
        lines.push('');

        var skills = snapshot.skills || {};
        var skillList = [];
        for (var name in skills) {
            skillList.push(skills[name]);
        }
        skillList.sort(function(a, b) { return b.confidence - a.confidence; });

        var top10 = skillList.slice(0, 10);
        for (var i = 0; i < top10.length; i++) {
            var s = top10[i];
            lines.push((i + 1) + '. ' + s.skill + ' (' + s.confidence_level + ', ' + s.confidence + '% confidence)');
        }

        lines.push('');
        lines.push('---');
        lines.push('Add these to your LinkedIn Skills section. They are endorsable and recognized across industries.');
        lines.push('Generated by SkillBridge v1.0.0 — ServiceNow Developer Portfolio Exporter');

        return lines.join('\n');
    },

    /**
     * Attach file to snapshot record.
     * @private
     */
    _attachFile: function(snapshotId, fileName, content, contentType) {
        try {
            var attachment = new GlideSysAttachment();
            var attachmentId = attachment.write(
                'x_snc_skb_skill_snapshot',
                snapshotId,
                fileName,
                contentType,
                content
            );
            return attachmentId;
        } catch (e) {
            gs.error('SkillBridgeExporter: Failed to attach file: ' + e.message);
            return '';
        }
    },

    /**
     * Update export log on snapshot record.
     * @private
     */
    _updateExportLog: function(snapshotId, format, attachmentId) {
        var gr = new GlideRecord('x_snc_skb_skill_snapshot');
        if (!gr.get(snapshotId)) return;

        var exportLog = [];
        try {
            exportLog = JSON.parse(gr.getValue('export_json') || '[]');
        } catch (e) {
            exportLog = [];
        }

        exportLog.push({
            format: format,
            attachment_id: attachmentId,
            exported_at: new GlideDateTime().getValue(),
            exported_by: gs.getUserName()
        });

        gr.setValue('export_json', JSON.stringify(exportLog));
        gr.setWorkflow(false);
        try {
            gr.update();
        } catch (e) {
            gs.error('SkillBridgeExporter: Failed to update export log: ' + e.message);
        }
    },

    type: 'SkillBridgeExporter'
};
