// CMDB Health Validator for AI Readiness — CmdbHealthScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core scanning engine: audits CMDB across 5 dimensions and computes AI Readiness Score.
// @class CmdbHealthScanner @namespace x_snc_cah

var CmdbHealthScanner = Class.create();
CmdbHealthScanner.prototype = {
    initialize: function() {
        this.WEIGHTS = {
            completeness: 25,
            staleness: 20,
            relationship: 25,
            duplicate: 15,
            coverage: 15
        };
        this.STALE_DAYS = 90;
    },

    /**
     * Run full health scan across all dimensions.
     * @param {string} ciClassFilter - comma-separated CI class names, or empty for all
     * @returns {string} sys_id of created health_scan record
     */
    scanAll: function(ciClassFilter) {
        var startTime = new GlideDateTime();

        // Check for concurrent scan
        var existingGr = new GlideRecord('x_snc_cah_health_scan');
        existingGr.addQuery('status', 'in_progress');
        existingGr.query();
        if (existingGr.next()) {
            return { scan_id: existingGr.getValue('sys_id'), already_running: true };
        }

        // Create scan record
        var scanGr = new GlideRecord('x_snc_cah_health_scan');
        scanGr.setValue('status', 'in_progress');
        scanGr.setValue('scan_date', startTime);
        try {
            var scanId = scanGr.insert();
        } catch (e) {
            gs.error('CmdbHealthScanner: Failed to create scan record: ' + e.message);
            return '';
        }

        // Resolve CI classes to scan
        var ciClasses = this._resolveCIClasses(ciClassFilter);

        // Run all dimension scans
        var completeness = this.scanCompleteness(ciClasses);
        var staleness = this.scanStaleness(ciClasses);
        var relationship = this.scanRelationships();
        var duplicate = this.scanDuplicates(ciClasses);
        var coverage = this.scanClassCoverage();

        // Compute composite score
        var aiScore = this.computeScore({
            completeness: completeness.score,
            staleness: staleness.score,
            relationship: relationship.score,
            duplicate: duplicate.score,
            coverage: coverage.score
        });

        // Collect findings
        var allFindings = []
            .concat(completeness.details || [])
            .concat(staleness.details || [])
            .concat(relationship.details || [])
            .concat(duplicate.details || [])
            .concat(coverage.details || []);

        // Sort by severity and take top findings
        allFindings.sort(function(a, b) {
            var sevOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
            return (sevOrder[a.severity] || 99) - (sevOrder[b.severity] || 99);
        });

        // Generate recommendations
        var recommendations = this._generateRecommendations(allFindings);

        // Compute total CIs
        var totalCIs = 0;
        for (var i = 0; i < ciClasses.length; i++) {
            var countGr = new GlideRecord(ciClasses[i]);
            countGr.query();
            totalCIs += countGr.getRowCount();
        }

        // Update scan record
        var endTime = new GlideDateTime();
        var duration = gs.dateDiff(startTime.getValue(), endTime.getValue(), true);

        var updateGr = new GlideRecord('x_snc_cah_health_scan');
        if (updateGr.get(scanId)) {
            updateGr.setValue('ai_readiness_score', aiScore);
            updateGr.setValue('completeness_score', completeness.score);
            updateGr.setValue('staleness_score', staleness.score);
            updateGr.setValue('relationship_score', relationship.score);
            updateGr.setValue('duplicate_score', duplicate.score);
            updateGr.setValue('coverage_score', coverage.score);
            updateGr.setValue('total_cis_scanned', totalCIs);
            updateGr.setValue('ci_classes_scanned', ciClasses.length);
            // Truncate and validate JSON before storing to prevent silent corruption
            var findingsJson = JSON.stringify(allFindings.slice(0, 50));
            var recommendationsJson = JSON.stringify(recommendations);
            var maxLen = 4000;

            if (findingsJson.length > maxLen) {
                // Progressively reduce findings until JSON fits
                var sliceSize = 50;
                while (findingsJson.length > maxLen && sliceSize > 0) {
                    sliceSize = Math.max(1, Math.floor(sliceSize / 2));
                    findingsJson = JSON.stringify(allFindings.slice(0, sliceSize));
                }
            }
            if (recommendationsJson.length > maxLen) {
                // Truncate recommendations array until JSON fits
                var recSlice = recommendations.length;
                while (recommendationsJson.length > maxLen && recSlice > 0) {
                    recSlice = Math.max(1, Math.floor(recSlice / 2));
                    recommendationsJson = JSON.stringify(recommendations.slice(0, recSlice));
                }
            }

            updateGr.setValue('findings_json', findingsJson);
            updateGr.setValue('recommendations_json', recommendationsJson);
            updateGr.setValue('scan_duration_seconds', parseInt(duration, 10) || 0);
            updateGr.setValue('status', 'completed');
            try {
                updateGr.update();
            } catch (e) {
                gs.error('CmdbHealthScanner: Failed to update scan record: ' + e.message);
            }
        }

        return scanId;
    },

    /**
     * Scan completeness: % of mandatory fields populated per CI class.
     * @param {array} ciClasses
     * @returns {object} {score, total_checked, missing_fields_count, details[]}
     */
    scanCompleteness: function(ciClasses) {
        var totalFields = 0;
        var missingFields = 0;
        var details = [];

        for (var i = 0; i < ciClasses.length; i++) {
            var className = ciClasses[i];

            // Get mandatory fields for this class
            var dictGr = new GlideRecord('sys_dictionary');
            dictGr.addQuery('name', className);
            dictGr.addQuery('mandatory', 'true');
            dictGr.query();

            var mandatoryFields = [];
            while (dictGr.next()) {
                mandatoryFields.push(dictGr.getValue('element'));
            }

            if (mandatoryFields.length === 0) {
                continue;
            }

            // Scan CIs for missing mandatory fields
            var ciGr = new GlideRecord(className);
            ciGr.query();

            var classMissing = 0;
            var classTotal = mandatoryFields.length * ciGr.getRowCount();
            totalFields += classTotal;

            while (ciGr.next()) {
                for (var f = 0; f < mandatoryFields.length; f++) {
                    var val = ciGr.getValue(mandatoryFields[f]);
                    if (!val || val === '') {
                        missingFields++;
                        classMissing++;
                    }
                }
            }

            if (classMissing > 0) {
                details.push({
                    dimension: 'completeness',
                    ci_class: className,
                    severity: classMissing > 100 ? 'P1' : 'P2',
                    issue: classMissing + ' mandatory fields missing across CIs',
                    count: classMissing
                });
            }
        }

        var score = totalFields > 0 ? Math.round((1 - missingFields / totalFields) * 100) : 100;
        return {
            score: score,
            total_checked: totalFields,
            missing_fields_count: missingFields,
            details: details
        };
    },

    /**
     * Scan staleness: % of CIs updated within STALE_DAYS.
     * @param {array} ciClasses
     * @returns {object} {score, total_checked, stale_count, details[]}
     */
    scanStaleness: function(ciClasses) {
        var totalCIs = 0;
        var staleCIs = 0;
        var details = [];
        var staleThreshold = new GlideDateTime();
        staleThreshold.addDays(-this.STALE_DAYS);

        for (var i = 0; i < ciClasses.length; i++) {
            var className = ciClasses[i];
            var ciGr = new GlideRecord(className);
            ciGr.addQuery('sys_updated_on', '<', staleThreshold);
            ciGr.query();

            var classStale = ciGr.getRowCount();
            staleCIs += classStale;

            var allGr = new GlideRecord(className);
            allGr.query();
            var classTotal = allGr.getRowCount();
            totalCIs += classTotal;

            if (classStale > 0) {
                var pct = classTotal > 0 ? Math.round(classStale / classTotal * 100) : 0;
                details.push({
                    dimension: 'staleness',
                    ci_class: className,
                    severity: pct > 50 ? 'P0' : pct > 25 ? 'P1' : 'P2',
                    issue: classStale + ' of ' + classTotal + ' CIs (' + pct + '%) not updated in ' + this.STALE_DAYS + ' days',
                    count: classStale
                });
            }
        }

        var score = totalCIs > 0 ? Math.round((1 - staleCIs / totalCIs) * 100) : 100;
        return {
            score: score,
            total_checked: totalCIs,
            stale_count: staleCIs,
            details: details
        };
    },

    /**
     * Scan relationship integrity: orphaned/broken references.
     * @returns {object} {score, total_checked, orphaned_count, broken_count, details[]}
     */
    scanRelationships: function() {
        var totalRels = 0;
        var orphanedCount = 0;
        var brokenCount = 0;
        var details = [];

        var relGr = new GlideRecord('cmdb_rel_ci');
        relGr.query();
        totalRels = relGr.getRowCount();

        // Check for orphaned relationships (parent or child deleted)
        var orphanedGr = new GlideRecord('cmdb_rel_ci');
        var orphanedQC = orphanedGr.addQuery('parent', 'ISEMPTY');
        orphanedQC.addOrCondition('child', 'ISEMPTY');
        orphanedGr.query();
        orphanedCount = orphanedGr.getRowCount();

        if (orphanedCount > 0) {
            details.push({
                dimension: 'relationship',
                ci_class: '',
                severity: orphanedCount > 100 ? 'P0' : 'P1',
                issue: orphanedCount + ' orphaned relationships (missing parent or child CI)',
                count: orphanedCount
            });
        }

        // Check for broken references (parent/child sys_id doesn't exist in cmdb_ci)
        // Use GlideAggregate to batch-check existence instead of N+1 per-row gets
        var brokenGr = new GlideRecord('cmdb_rel_ci');
        brokenGr.query();

        // Collect all parent and child sys_ids
        var parentIds = [];
        var childIds = [];
        while (brokenGr.next()) {
            var pid = brokenGr.getValue('parent');
            var cid = brokenGr.getValue('child');
            if (pid) parentIds.push(pid);
            if (cid) childIds.push(cid);
        }

        // Build a set of valid CI sys_ids using a single GlideAggregate query
        var validCIs = {};
        var allRefIds = parentIds.concat(childIds);
        if (allRefIds.length > 0) {
            // Batch in chunks of 1000 to avoid query length limits
            var chunkSize = 1000;
            for (var ci = 0; ci < allRefIds.length; ci += chunkSize) {
                var chunk = allRefIds.slice(ci, ci + chunkSize);
                var validGr = new GlideRecord('cmdb_ci');
                validGr.addQuery('sys_id', 'IN', chunk.join(','));
                validGr.query();
                while (validGr.next()) {
                    validCIs[validGr.getValue('sys_id')] = true;
                }
            }
        }

        // Count broken references
        for (var pi = 0; pi < parentIds.length; pi++) {
            if (parentIds[pi] && !validCIs[parentIds[pi]]) brokenCount++;
        }
        for (var ci2 = 0; ci2 < childIds.length; ci2++) {
            if (childIds[ci2] && !validCIs[childIds[ci2]]) brokenCount++;
        }

        if (brokenCount > 0) {
            details.push({
                dimension: 'relationship',
                ci_class: '',
                severity: brokenCount > 50 ? 'P0' : 'P1',
                issue: brokenCount + ' broken references (parent/child CI not found)',
                count: brokenCount
            });
        }

        var totalIssues = orphanedCount + brokenCount;
        var score = totalRels > 0 ? Math.round((1 - totalIssues / (totalRels * 2)) * 100) : 100;
        if (score < 0) score = 0;

        return {
            score: score,
            total_checked: totalRels,
            orphaned_count: orphanedCount,
            broken_count: brokenCount,
            details: details
        };
    },

    /**
     * Scan duplicates: CIs with same name+class.
     * @param {array} ciClasses
     * @returns {object} {score, total_checked, duplicate_groups, details[]}
     */
    scanDuplicates: function(ciClasses) {
        var totalCIs = 0;
        var duplicateCIs = 0;
        var details = [];

        for (var i = 0; i < ciClasses.length; i++) {
            var className = ciClasses[i];

            // Use GlideAggregate to find duplicate names
            var agg = new GlideAggregate(className);
            agg.addAggregate('COUNT', 'name');
            agg.groupBy('name');
            agg.addHaving('COUNT', '>', 1);
            agg.query();

            var classDupes = 0;
            while (agg.next()) {
                var count = parseInt(agg.getAggregate('COUNT', 'name'), 10) || 0;
                classDupes += (count - 1); // one is the original, rest are duplicates
            }

            duplicateCIs += classDupes;

            var allGr = new GlideRecord(className);
            allGr.query();
            totalCIs += allGr.getRowCount();

            if (classDupes > 0) {
                details.push({
                    dimension: 'duplicate',
                    ci_class: className,
                    severity: classDupes > 20 ? 'P1' : 'P2',
                    issue: classDupes + ' duplicate CIs found in class ' + className,
                    count: classDupes
                });
            }
        }

        var score = totalCIs > 0 ? Math.round((1 - duplicateCIs / totalCIs) * 100) : 100;
        return {
            score: score,
            total_checked: totalCIs,
            duplicate_groups: details.length,
            details: details
        };
    },

    /**
     * Scan class coverage: % of expected CI classes with at least 1 record.
     * @returns {object} {score, expected_classes, populated_classes, missing_classes[]}
     */
    scanClassCoverage: function() {
        var expectedClasses = [];
        var populatedClasses = [];
        var missingClasses = [];

        // Get all CI classes from sys_db_object
        var dbGr = new GlideRecord('sys_db_object');
        dbGr.addQuery('super_class.name', 'cmdb_ci');
        dbGr.addOrCondition('name', 'cmdb_ci');
        dbGr.query();

        while (dbGr.next()) {
            var className = dbGr.getValue('name');
            expectedClasses.push(className);

            var ciGr = new GlideRecord(className);
            ciGr.setLimit(1);
            ciGr.query();
            if (ciGr.next()) {
                populatedClasses.push(className);
            } else {
                missingClasses.push(className);
            }
        }

        var score = expectedClasses.length > 0
            ? Math.round(populatedClasses.length / expectedClasses.length * 100)
            : 0;

        var details = [];
        if (missingClasses.length > 0) {
            details.push({
                dimension: 'coverage',
                ci_class: '',
                severity: missingClasses.length > 10 ? 'P0' : 'P1',
                issue: missingClasses.length + ' CI classes have zero records: ' + missingClasses.slice(0, 10).join(', ') + (missingClasses.length > 10 ? '...' : ''),
                count: missingClasses.length
            });
        }

        return {
            score: score,
            expected_classes: expectedClasses.length,
            populated_classes: populatedClasses.length,
            missing_classes: missingClasses,
            details: details
        };
    },

    /**
     * Compute weighted AI Readiness Score from dimension scores.
     * @param {object} dimensionScores - {completeness, staleness, relationship, duplicate, coverage}
     * @returns {number} 0-100 composite score
     */
    computeScore: function(dimensionScores) {
        var total = 0;
        total += (dimensionScores.completeness || 0) * this.WEIGHTS.completeness / 100;
        total += (dimensionScores.staleness || 0) * this.WEIGHTS.staleness / 100;
        total += (dimensionScores.relationship || 0) * this.WEIGHTS.relationship / 100;
        total += (dimensionScores.duplicate || 0) * this.WEIGHTS.duplicate / 100;
        total += (dimensionScores.coverage || 0) * this.WEIGHTS.coverage / 100;
        return Math.round(total);
    },

    /**
     * Get scan history for trend analysis.
     * @param {number} limit
     * @returns {array} recent scan summaries
     */
    getScanHistory: function(limit) {
        limit = limit || 10;
        var results = [];
        var gr = new GlideRecord('x_snc_cah_health_scan');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('scan_date');
        gr.setLimit(limit);
        gr.query();

        while (gr.next()) {
            results.push({
                scan_id: gr.getValue('sys_id'),
                scan_date: gr.getValue('scan_date'),
                ai_readiness_score: parseInt(gr.getValue('ai_readiness_score'), 10) || 0,
                completeness_score: parseInt(gr.getValue('completeness_score'), 10) || 0,
                staleness_score: parseInt(gr.getValue('staleness_score'), 10) || 0,
                relationship_score: parseInt(gr.getValue('relationship_score'), 10) || 0,
                duplicate_score: parseInt(gr.getValue('duplicate_score'), 10) || 0,
                coverage_score: parseInt(gr.getValue('coverage_score'), 10) || 0,
                total_cis_scanned: parseInt(gr.getValue('total_cis_scanned'), 10) || 0,
                status: gr.getValue('status')
            });
        }
        return results;
    },

    /**
     * Get single scan with full detail.
     * @param {string} scanId
     * @returns {object} full scan record with parsed JSON fields
     */
    getScanDetail: function(scanId) {
        var gr = new GlideRecord('x_snc_cah_health_scan');
        if (!gr.get(scanId)) {
            return null;
        }

        var findingsRaw = gr.getValue('findings_json') || '[]';
        var recommendationsRaw = gr.getValue('recommendations_json') || '[]';
        var aiImpactRaw = gr.getValue('ai_impact_json') || '{}';

        var findings = [];
        var recommendations = [];
        var aiImpact = {};

        try { findings = JSON.parse(findingsRaw); } catch (e) { /* keep empty */ }
        try { recommendations = JSON.parse(recommendationsRaw); } catch (e) { /* keep empty */ }
        try { aiImpact = JSON.parse(aiImpactRaw); } catch (e) { /* keep empty */ }

        return {
            scan_id: gr.getValue('sys_id'),
            scan_date: gr.getValue('scan_date'),
            ai_readiness_score: parseInt(gr.getValue('ai_readiness_score'), 10) || 0,
            completeness_score: parseInt(gr.getValue('completeness_score'), 10) || 0,
            staleness_score: parseInt(gr.getValue('staleness_score'), 10) || 0,
            relationship_score: parseInt(gr.getValue('relationship_score'), 10) || 0,
            duplicate_score: parseInt(gr.getValue('duplicate_score'), 10) || 0,
            coverage_score: parseInt(gr.getValue('coverage_score'), 10) || 0,
            total_cis_scanned: parseInt(gr.getValue('total_cis_scanned'), 10) || 0,
            ci_classes_scanned: parseInt(gr.getValue('ci_classes_scanned'), 10) || 0,
            scan_duration_seconds: parseInt(gr.getValue('scan_duration_seconds'), 10) || 0,
            status: gr.getValue('status'),
            findings: findings,
            recommendations: recommendations,
            ai_impact: aiImpact
        };
    },

    /**
     * Get current health snapshot (latest completed scan).
     * @returns {object} latest scan summary or null
     */
    getCurrentHealth: function() {
        var gr = new GlideRecord('x_snc_cah_health_scan');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('scan_date');
        gr.setLimit(1);
        gr.query();

        if (!gr.next()) {
            return { message: 'No completed scans found. Run a scan first.', ai_readiness_score: 0 };
        }

        return this.getScanDetail(gr.getValue('sys_id'));
    },

    // ── Private helpers ──

    /**
     * Resolve CI class filter to array of class names.
     * @private
     */
    _resolveCIClasses: function(ciClassFilter) {
        var classes = [];

        if (ciClassFilter) {
            classes = ciClassFilter.split(',').map(function(c) { return c.trim(); });
        } else {
            var dbGr = new GlideRecord('sys_db_object');
            dbGr.addQuery('super_class.name', 'cmdb_ci');
            dbGr.addOrCondition('name', 'cmdb_ci');
            dbGr.query();
            while (dbGr.next()) {
                classes.push(dbGr.getValue('name'));
            }
        }
        return classes;
    },

    /**
     * Generate prioritized recommendations from findings.
     * @private
     */
    _generateRecommendations: function(findings) {
        var recs = [];
        var seen = {};

        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var key = f.dimension + '|' + f.ci_class;
            if (seen[key]) continue;
            seen[key] = true;

            var rec = {
                dimension: f.dimension,
                ci_class: f.ci_class,
                severity: f.severity,
                action: '',
                impact: ''
            };

            switch (f.dimension) {
                case 'completeness':
                    rec.action = 'Populate mandatory fields for ' + (f.ci_class || 'affected') + ' CIs. Run data import or manual enrichment.';
                    rec.impact = 'Missing mandatory fields cause AI agents to receive incomplete CI context, leading to incorrect automation decisions.';
                    break;
                case 'staleness':
                    rec.action = 'Run Discovery or Service Mapping against ' + (f.ci_class || 'stale') + ' to refresh stale CIs.';
                    rec.impact = 'Stale CIs cause AI to operate on outdated infrastructure data, risking changes to decommissioned assets.';
                    break;
                case 'relationship':
                    rec.action = 'Run CMDB Health remediation for orphaned/broken relationships. Use Dependency Views to identify missing links.';
                    rec.impact = 'Broken relationships prevent AI from understanding service topology, blocking impact analysis and root cause automation.';
                    break;
                case 'duplicate':
                    rec.action = 'Run CMDB duplicate remediation rules for ' + (f.ci_class || 'affected') + '. Merge or retire duplicate CIs.';
                    rec.impact = 'Duplicate CIs cause AI to double-count resources, inflate capacity estimates, and create conflicting change requests.';
                    break;
                case 'coverage':
                    rec.action = 'Deploy Discovery against missing CI classes or manually seed baseline records.';
                    rec.impact = 'Missing CI classes create blind spots where AI cannot see critical infrastructure components.';
                    break;
            }

            recs.push(rec);
        }

        return recs;
    },

    type: 'CmdbHealthScanner'
};
