// SN Assignment Rule Auditor — AssignmentRuleEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine: scans assignment rules, detects conflicts, dead rules,
// stale conditions, computes health scores, and simulates rule matching.
// @class AssignmentRuleEngine @namespace sn_assignment_rule_auditor

var AssignmentRuleEngine = Class.create();
AssignmentRuleEngine.prototype = {
    initialize: function() {
        this.scanRunId = gs.generateGUID();
        this.conflictCount = 0;
        this.deadRuleCount = 0;
        this.staleConditionCount = 0;
    },

    /**
     * Run a full scan of all assignment rules across all tables.
     * @param {string} [tableName] — optional, scan only one table
     * @returns {object} scan summary with counts and health scores
     */
    scanAll: function(tableName) {
        var tables = tableName ? [tableName] : this._getAllRuleTables();
        var results = { scan_run_id: this.scanRunId, scanned_at: new GlideDateTime().getValue(), tables: {} };

        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            var rules = this._loadRules(tbl);
            if (rules.length === 0) { results.tables[tbl] = { rules: 0, conflicts: 0, dead_rules: 0, stale_conditions: 0, health_score: 100 }; continue; }

            var conflicts = this.detectConflicts(rules);
            var deadRules = this.detectDeadRules(rules);
            var staleConditions = this.validateConditions(rules);
            var healthScore = this.computeHealthScore(rules.length, conflicts.length, deadRules.length, staleConditions.length);

            this._saveScanResults(tbl, conflicts, deadRules, staleConditions, healthScore);

            results.tables[tbl] = {
                rules: rules.length,
                conflicts: conflicts.length,
                dead_rules: deadRules.length,
                stale_conditions: staleConditions.length,
                health_score: healthScore
            };
        }
        return results;
    },

    /**
     * Detect conflicting assignment rule pairs on a table.
     * Two rules conflict when their conditions can match the same record
     * but they route to different assignment groups.
     * @param {Array} rules — array of rule objects with conditions, order, assigned_to
     * @returns {Array} conflict objects
     */
    detectConflicts: function(rules) {
        var conflicts = [];
        for (var i = 0; i < rules.length; i++) {
            for (var j = i + 1; j < rules.length; j++) {
                var ruleA = rules[i];
                var ruleB = rules[j];
                if (ruleA.assigned_to === ruleB.assigned_to) continue;

                var overlap = this._computeConditionOverlap(ruleA.conditions, ruleB.conditions);
                if (overlap.hasOverlap) {
                    var severity = this._scoreSeverity(overlap, ruleA, ruleB);
                    conflicts.push({
                        rule_a_sys_id: ruleA.sys_id,
                        rule_a_name: ruleA.name,
                        rule_a_order: ruleA.order,
                        rule_a_group: ruleA.assigned_to,
                        rule_b_sys_id: ruleB.sys_id,
                        rule_b_name: ruleB.name,
                        rule_b_order: ruleB.order,
                        rule_b_group: ruleB.assigned_to,
                        overlapping_conditions: overlap.description,
                        severity: severity,
                        winning_rule: ruleA.order < ruleB.order ? ruleA.sys_id : ruleB.sys_id
                    });
                }
            }
        }
        this.conflictCount = conflicts.length;
        return conflicts;
    },

    /**
     * Detect dead rules — rules whose entire condition space is covered
     * by higher-priority rules on the same table.
     * @param {Array} rules — sorted by order ascending
     * @returns {Array} dead rule objects
     */
    detectDeadRules: function(rules) {
        var deadRules = [];
        var sorted = rules.slice().sort(function(a, b) { return a.order - b.order; });

        for (var i = 1; i < sorted.length; i++) {
            var coverage = this._computeCoverage(sorted.slice(0, i), sorted[i]);
            if (coverage.ratio >= 0.95) {
                deadRules.push({
                    rule_sys_id: sorted[i].sys_id,
                    rule_name: sorted[i].name,
                    rule_order: sorted[i].order,
                    blocking_rules: coverage.blockingRules,
                    coverage_ratio: coverage.ratio,
                    status: coverage.ratio >= 1.0 ? 'fully_dead' : 'partially_dead'
                });
            }
        }
        this.deadRuleCount = deadRules.length;
        return deadRules;
    },

    /**
     * Validate conditions against live instance metadata.
     * Checks: field existence, choice values, script includes, group existence.
     * @param {Array} rules
     * @returns {Array} stale condition objects
     */
    validateConditions: function(rules) {
        var staleConditions = [];
        for (var r = 0; r < rules.length; r++) {
            var rule = rules[r];
            var conditions = this._parseConditions(rule.conditions_raw);

            for (var c = 0; c < conditions.length; c++) {
                var cond = conditions[c];
                var issue = this._validateSingleCondition(cond, rule.table);
                if (issue) {
                    staleConditions.push({
                        rule_sys_id: rule.sys_id,
                        rule_name: rule.name,
                        field: cond.field,
                        value: cond.value,
                        issue: issue.type,
                        detail: issue.detail,
                        severity: issue.severity
                    });
                }
            }

            // Check assigned group existence
            if (rule.assigned_to && !this._groupExists(rule.assigned_to)) {
                staleConditions.push({
                    rule_sys_id: rule.sys_id,
                    rule_name: rule.name,
                    field: 'assigned_to',
                    value: rule.assigned_to,
                    issue: 'group_missing',
                    detail: 'Assigned group does not exist or is inactive',
                    severity: 'critical'
                });
            }

            // Check advanced script include references
            if (rule.script) {
                var scriptIssues = this._validateScriptReferences(rule.script, rule.sys_id, rule.name);
                for (var s = 0; s < scriptIssues.length; s++) {
                    staleConditions.push(scriptIssues[s]);
                }
            }
        }
        this.staleConditionCount = staleConditions.length;
        return staleConditions;
    },

    /**
     * Compute a health score (0–100) for a table's assignment rules.
     * Weighted composite: conflict count, dead rule ratio, stale condition ratio.
     * @param {number} totalRules
     * @param {number} conflicts
     * @param {number} deadRules
     * @param {number} staleConditions
     * @returns {number} score 0–100
     */
    computeHealthScore: function(totalRules, conflicts, deadRules, staleConditions) {
        if (totalRules === 0) return 100;

        var conflictPenalty = Math.min(conflicts * 5, 40);
        var deadRuleRatio = deadRules / totalRules;
        var deadPenalty = Math.min(deadRuleRatio * 40, 40);
        var staleRatio = staleConditions / Math.max(totalRules, 1);
        var stalePenalty = Math.min(staleRatio * 30, 30);

        return Math.max(0, Math.round(100 - conflictPenalty - deadPenalty - stalePenalty));
    },

    /**
     * Simulate which assignment rule would fire for a given record.
     * @param {string} tableName — target table
     * @param {object} fieldValues — { field_name: value, ... }
     * @returns {object} simulation result
     */
    simulate: function(tableName, fieldValues) {
        var rules = this._loadRules(tableName);
        var matchedRules = [];

        for (var i = 0; i < rules.length; i++) {
            if (this._ruleMatches(rules[i], fieldValues)) {
                matchedRules.push({
                    sys_id: rules[i].sys_id,
                    name: rules[i].name,
                    order: rules[i].order,
                    assigned_to: rules[i].assigned_to
                });
            }
        }

        matchedRules.sort(function(a, b) { return a.order - b.order; });

        return {
            table: tableName,
            input_values: fieldValues,
            matched_rules: matchedRules,
            winning_rule: matchedRules.length > 0 ? matchedRules[0] : null,
            assigned_group: matchedRules.length > 0 ? matchedRules[0].assigned_to : null,
            total_rules_evaluated: rules.length,
            simulated_at: new GlideDateTime().getValue()
        };
    },

    // ─── Private: Rule Loading ───────────────────────────────────────

    _getAllRuleTables: function() {
        var tables = [];
        var gr = new GlideRecord('sys_rule_assignment');
        gr.addQuery('active', true);
        gr.query();
        while (gr.next()) {
            var tbl = gr.getValue('table');
            if (tables.indexOf(tbl) === -1) tables.push(tbl);
        }
        return tables;
    },

    _loadRules: function(tableName) {
        var rules = [];
        var gr = new GlideRecord('sys_rule_assignment');
        gr.addQuery('table', tableName);
        gr.addQuery('active', true);
        gr.orderBy('order');
        gr.query();
        while (gr.next()) {
            rules.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name') || '',
                table: gr.getValue('table') || '',
                order: parseInt(gr.getValue('order') || '0', 10),
                conditions_raw: gr.getValue('conditions') || '',
                conditions: this._parseConditions(gr.getValue('conditions') || ''),
                script: gr.getValue('script') || '',
                assigned_to: gr.getValue('assigned_to') || '',
                active: gr.getValue('active') === 'true'
            });
        }
        return rules;
    },

    // ─── Private: Condition Parsing ───────────────────────────────────

    _parseConditions: function(conditionsRaw) {
        if (!conditionsRaw) return [];
        // Split on ^, then handle ^NQ (OR group separator) by merging
        var rawParts = conditionsRaw.split('^');
        var parts = [];
        for (var i = 0; i < rawParts.length; i++) {
            var rp = rawParts[i].trim();
            if (!rp) continue;
            if (rp.indexOf('NQ') === 0) {
                // ^NQ marks an OR group — treat the remainder as a new condition
                rp = rp.substring(2).trim();
                if (!rp) continue;
            }
            parts.push(rp);
        }
        var conditions = [];
        for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            // Try operators in order: !=, STARTSWITH, INSTANCEOF, NOT IN, IN, =
            var opIdx = -1;
            var operator = '=';
            var operators = ['!=', 'STARTSWITH', 'INSTANCEOF', 'NOT IN', 'IN', '='];
            for (var o = 0; o < operators.length; o++) {
                var idx = part.indexOf(operators[o]);
                if (idx !== -1) {
                    opIdx = idx;
                    operator = operators[o];
                    break;
                }
            }
            if (opIdx === -1) continue;
            conditions.push({
                field: part.substring(0, opIdx).trim(),
                value: part.substring(opIdx + operator.length).trim(),
                operator: operator
            });
        }
        return conditions;
    },

    // ─── Private: Conflict Detection Helpers ──────────────────────────

    _computeConditionOverlap: function(condsA, condsB) {
        var overlappingFields = [];
        var hasOverlap = false;

        for (var a = 0; a < condsA.length; a++) {
            for (var b = 0; b < condsB.length; b++) {
                if (condsA[a].field === condsB[b].field) {
                    // Same field: overlap exists regardless of operator/value.
                    // Exact value match is a stronger signal, but any same-field
                    // condition pair can match the same record.
                    var desc = condsA[a].field;
                    if (condsA[a].value === condsB[b].value) {
                        desc += '=' + condsA[a].value;
                    } else {
                        desc += ' (' + (condsA[a].operator || '=') + condsA[a].value +
                               ' vs ' + (condsB[b].operator || '=') + condsB[b].value + ')';
                    }
                    overlappingFields.push(desc);
                    hasOverlap = true;
                }
            }
        }

        return {
            hasOverlap: hasOverlap,
            overlappingFields: overlappingFields,
            description: overlappingFields.join(', '),
            overlapCount: overlappingFields.length,
            totalFieldsA: condsA.length,
            totalFieldsB: condsB.length
        };
    },

    _scoreSeverity: function(overlap, ruleA, ruleB) {
        var overlapRatio = overlap.overlapCount / Math.max(overlap.totalFieldsA, overlap.totalFieldsB, 1);
        var orderDiff = Math.abs(ruleA.order - ruleB.order);
        var groupDiff = ruleA.assigned_to !== ruleB.assigned_to ? 1 : 0;
        var rawScore = overlapRatio * 0.5 + (orderDiff > 10 ? 0.3 : 0.1) + groupDiff * 0.2;

        if (rawScore >= 0.7) return 'critical';
        if (rawScore >= 0.4) return 'high';
        if (rawScore >= 0.2) return 'medium';
        return 'low';
    },

    // ─── Private: Dead Rule Detection Helpers ────────────────────────

    _computeCoverage: function(higherRules, targetRule) {
        var conds = targetRule.conditions;
        if (conds.length === 0) return { ratio: 0, blockingRules: [] };

        var blockingRules = [];
        var coveredFields = 0;

        // Count how many condition fields are covered by at least one higher rule
        for (var c = 0; c < conds.length; c++) {
            var field = conds[c].field;
            var value = conds[c].value;
            var fieldCovered = false;

            for (var h = 0; h < higherRules.length; h++) {
                var hrConds = higherRules[h].conditions;
                for (var hc = 0; hc < hrConds.length; hc++) {
                    if (hrConds[hc].field === field && hrConds[hc].value === value) {
                        fieldCovered = true;
                        // Track which rules contribute to coverage
                        var alreadyTracked = false;
                        for (var b = 0; b < blockingRules.length; b++) {
                            if (blockingRules[b].sys_id === higherRules[h].sys_id) {
                                alreadyTracked = true;
                                break;
                            }
                        }
                        if (!alreadyTracked) {
                            blockingRules.push({ sys_id: higherRules[h].sys_id, name: higherRules[h].name, order: higherRules[h].order });
                        }
                        break;
                    }
                }
                if (fieldCovered) break;
            }
            if (fieldCovered) coveredFields++;
        }

        return {
            ratio: coveredFields / conds.length,
            blockingRules: blockingRules
        };
    },

    // ─── Private: Condition Validation Helpers ───────────────────────

    _validateSingleCondition: function(cond, tableName) {
        // Check field existence in sys_dictionary
        var dictGr = new GlideRecord('sys_dictionary');
        dictGr.addQuery('name', tableName);
        dictGr.addQuery('element', cond.field);
        dictGr.addQuery('active', true);
        dictGr.query();
        if (!dictGr.next()) {
            return { type: 'field_missing', detail: 'Field ' + cond.field + ' does not exist on table ' + tableName, severity: 'critical' };
        }

        // Check choice value if field has choices
        var choiceGr = new GlideRecord('sys_choice');
        choiceGr.addQuery('name', tableName);
        choiceGr.addQuery('element', cond.field);
        choiceGr.addQuery('value', cond.value);
        choiceGr.addQuery('inactive', false);
        choiceGr.query();
        if (choiceGr.hasNext()) return null; // valid choice

        // Check if field has any choices at all (if so, value is stale)
        var anyChoiceGr = new GlideRecord('sys_choice');
        anyChoiceGr.addQuery('name', tableName);
        anyChoiceGr.addQuery('element', cond.field);
        anyChoiceGr.addQuery('inactive', false);
        anyChoiceGr.setLimit(1);
        anyChoiceGr.query();
        if (anyChoiceGr.hasNext()) {
            return { type: 'choice_stale', detail: 'Value ' + cond.value + ' is not a valid choice for field ' + cond.field, severity: 'high' };
        }

        return null;
    },

    _groupExists: function(groupSysId) {
        var gr = new GlideRecord('sys_user_group');
        if (!gr.get(groupSysId)) return false;
        return gr.getValue('active') === 'true';
    },

    _validateScriptReferences: function(script, ruleSysId, ruleName) {
        var issues = [];
        var siPattern = /new\s+(\w+)\s*\(/g;
        var match;
        while ((match = siPattern.exec(script)) !== null) {
            var siName = match[1];
            var siGr = new GlideRecord('sys_script_include');
            siGr.addQuery('name', siName);
            siGr.addQuery('active', true);
            siGr.query();
            if (!siGr.next()) {
                issues.push({
                    rule_sys_id: ruleSysId || '',
                    rule_name: ruleName || '',
                    field: 'script',
                    value: siName,
                    issue: 'script_include_missing',
                    detail: 'Script Include ' + siName + ' referenced in advanced script does not exist',
                    severity: 'critical'
                });
            }
        }
        return issues;
    },

    // ─── Private: Simulation Helpers ─────────────────────────────────

    _ruleMatches: function(rule, fieldValues) {
        var conds = rule.conditions;
        if (conds.length === 0 && !rule.script) return true;

        for (var c = 0; c < conds.length; c++) {
            var field = conds[c].field;
            var expected = conds[c].value;
            var actual = fieldValues[field];
            if (actual === undefined || actual === null) return false;
            if (String(actual) !== String(expected)) return false;
        }

        if (rule.script) {
            try {
                // Build a GlideRecord-like object so scripted conditions
                // referencing current.field_name work correctly.
                var current = new GlideRecord(rule.table);
                current.initialize();
                for (var key in fieldValues) {
                    if (fieldValues.hasOwnProperty(key)) {
                        current.setValue(key, fieldValues[key]);
                    }
                }
                var evaluator = new GlideScopedEvaluator();
                evaluator.putVariable('current', current);
                var result = evaluator.evaluateString(rule.script);
                return result === true || result === 'true';
            } catch (e) {
                gs.warn('AssignmentRuleEngine: script evaluation failed for rule ' + rule.name + ': ' + e.message);
                return false;
            }
        }

        return true;
    },

    // ─── Private: Persistence ────────────────────────────────────────

    _saveScanResults: function(tableName, conflicts, deadRules, staleConditions, healthScore) {
        this._saveResultsOfType(tableName, 'health_snapshot', {
            health_score: healthScore,
            total_conflicts: conflicts.length,
            total_dead_rules: deadRules.length,
            total_stale_conditions: staleConditions.length
        }, healthScore, 'info');

        for (var c = 0; c < conflicts.length; c++) {
            this._saveResultsOfType(tableName, 'conflict', conflicts[c], null, conflicts[c].severity);
        }
        for (var d = 0; d < deadRules.length; d++) {
            this._saveResultsOfType(tableName, 'dead_rule', deadRules[d], null, deadRules[d].status === 'fully_dead' ? 'high' : 'medium');
        }
        for (var s = 0; s < staleConditions.length; s++) {
            this._saveResultsOfType(tableName, 'stale_condition', staleConditions[s], null, staleConditions[s].severity);
        }
    },

    _saveResultsOfType: function(tableName, type, data, score, severity) {
        try {
            var gr = new GlideRecord('x_sn_ara_scan_result');
            gr.initialize();
            gr.setValue('type', type);
            gr.setValue('table_name', tableName);
            gr.setValue('rule_sys_id', data.rule_sys_id || data.rule_a_sys_id || '');
            gr.setValue('rule_name', data.rule_name || data.rule_a_name || '');
            gr.setValue('severity', severity || 'info');
            if (score !== null && score !== undefined) gr.setValue('score', score);
            gr.setValue('detail_json', JSON.stringify(data));
            gr.setValue('scanned_at', new GlideDateTime().getValue());
            gr.setValue('scan_run_id', this.scanRunId);
            gr.setValue('active', true);
            gr.insert();
        } catch (e) {
            gs.error('AssignmentRuleEngine: failed to save scan result type=' + type + ': ' + e.message);
        }
    },

    type: 'AssignmentRuleEngine'
};
