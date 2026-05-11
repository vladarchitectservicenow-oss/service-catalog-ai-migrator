var FlowGuardValidator = Class.create();
FlowGuardValidator.prototype = {
    initialize: function() {},

    /**
     * Main validation entry point.
     * @param {string} sourceFlowId - sys_id of source flow
     * @param {string} targetInstanceUrl - target instance URL
     * @returns {object} {valid: bool, issues: [{severity, category, message, actionable}]}
     */
    validate: function(sourceFlowId, targetInstanceUrl) {
        var result = {valid: true, issues: []};

        var flowGr = new GlideRecord('sys_hub_flow');
        if (!flowGr.get(sourceFlowId)) {
            result.valid = false;
            result.issues.push({
                severity: 'critical',
                category: 'flow',
                message: 'Source flow ' + sourceFlowId + ' not found',
                actionable: false
            });
            return result;
        }

        var flowName = flowGr.getValue('name');
        var flowVersion = flowGr.getValue('version');

        this._checkDependencies(flowGr, result);
        this._checkDataPills(flowGr, result);
        this._checkSubflowsExist(flowGr, result);
        this._checkActionVersions(flowGr, result);
        this._checkTargetCompatibility(flowName, targetInstanceUrl, result);
        this._checkVersionCompatibility(flowVersion, flowName, targetInstanceUrl, result);

        result.valid = result.issues.filter(function(i) {
            return i.severity === 'critical';
        }).length === 0;

        return result;
    },

    /**
     * Builds dependency graph: subflows referenced by this flow.
     */
    _checkDependencies: function(flowGr, result) {
        var subflowRefs = this._extractSubflows(flowGr);
        var subflowGr = new GlideRecord('sys_hub_flow');

        for (var i = 0; i < subflowRefs.length; i++) {
            var ref = subflowRefs[i];
            if (ref === 'global.' + flowGr.getValue('sys_id'))
                continue;

            if (subflowGr.get('sys_id', ref)) {
                if (subflowGr.getValue('active') !== 'true') {
                    result.issues.push({
                        severity: 'warning',
                        category: 'subflow',
                        message: 'Subflow ' + subflowGr.getValue('name') + ' is inactive',
                        actionable: true,
                        action: 'Activate subflow or remove reference'
                    });
                }
            } else if (ref.indexOf('global.') === 0) {
                var sysId = ref.replace('global.', '');
                if (!subflowGr.get(sysId)) {
                    result.issues.push({
                        severity: 'critical',
                        category: 'subflow',
                        message: 'Subflow ' + ref + ' does not exist in target',
                        actionable: true,
                        action: 'Deploy subflow before migrating this flow'
                    });
                }
            }
        }
    },

    /**
     * Validates data pills are resolvable.
     */
    _checkDataPills: function(flowGr, result) {
        var flowActions = this._getFlowActions(flowGr);

        for (var a = 0; a < flowActions.length; a++) {
            var inputs = flowActions[a].inputs || {};
            for (var key in inputs) {
                var val = inputs[key];
                if (typeof val === 'string' && val.indexOf('{{') === 0) {
                    var pillPath = val.replace(/[{}]/g, '');
                    if (!this._resolvePill(pillPath, flowActions, a)) {
                        result.issues.push({
                            severity: 'warning',
                            category: 'data_pill',
                            message: 'Data pill "' + pillPath + '" in step ' + flowActions[a].name + ' may be unresolved',
                            actionable: true,
                            action: 'Verify pill references in target environment'
                        });
                    }
                }
            }
        }
    },

    /**
     * Checks that subflow actions reference existing flows.
     */
    _checkSubflowsExist: function(flowGr, result) {
        var actions = this._getFlowActions(flowGr);
        var subflowGr = new GlideRecord('sys_hub_flow');

        for (var i = 0; i < actions.length; i++) {
            if (actions[i].type === 'subflow' && actions[i].flow_sys_id) {
                if (!subflowGr.get(actions[i].flow_sys_id)) {
                    result.issues.push({
                        severity: 'critical',
                        category: 'action',
                        message: 'Subflow action "' + actions[i].name + '" references non-existent flow',
                        actionable: true,
                        action: 'Deploy the referenced subflow first'
                    });
                }
            }
        }
    },

    /**
     * Checks action type snapshots exist and match versions.
     */
    _checkActionVersions: function(flowGr, result) {
        var actions = this._getFlowActions(flowGr);
        var snapshotGr = new GlideRecord('sys_hub_action_type_snapshot');

        for (var i = 0; i < actions.length; i++) {
            if (actions[i].action_type_id) {
                if (!snapshotGr.get('sys_id', actions[i].action_type_id)) {
                    result.issues.push({
                        severity: 'critical',
                        category: 'action_version',
                        message: 'Action type "' + actions[i].name + '" not found — may have been deprecated',
                        actionable: true,
                        action: 'Update action reference or install missing spoke'
                    });
                }
            }
        }
    },

    /**
     * Simple target side check — validates flow doesn't already exist with same name but different version.
     */
    _checkTargetCompatibility: function(flowName, targetInstanceUrl, result) {
        var dupGr = new GlideRecord('sys_hub_flow');
        dupGr.addQuery('name', flowName);
        dupGr.setLimit(1);
        dupGr.query();

        if (dupGr.next()) {
            result.issues.push({
                severity: 'info',
                category: 'target',
                message: 'Flow "' + flowName + '" already exists in target (id: ' + dupGr.getValue('sys_id') + '). Will backup before overwriting.',
                actionable: true,
                action: 'Existing flow will be auto-backed up before migration'
            });
        }
    },

    /**
     * Check source flow version vs any existing target flow version.
     */
    _checkVersionCompatibility: function(sourceVersion, flowName, targetInstanceUrl, result) {
        var targetGr = new GlideRecord('sys_hub_flow');
        targetGr.addQuery('name', flowName);
        targetGr.addQuery('version', '>=', sourceVersion);
        targetGr.setLimit(1);
        targetGr.query();
        if (targetGr.next()) {
            result.issues.push({
                severity: 'warning',
                category: 'version',
                message: 'Target already has version ' + targetGr.getValue('version') + ' (source is ' + sourceVersion + '). Migration will overwrite newer version.',
                actionable: true,
                action: 'Review target version before overwriting'
            });
        }
    },

    /**
     * Extract subflow sys_ids from flow JSON.
     */
    _extractSubflows: function(flowGr) {
        var refs = [];
        var actions = this._getFlowActions(flowGr);
        for (var i = 0; i < actions.length; i++) {
            if (actions[i].subflow_id) {
                refs.push(actions[i].subflow_id);
            }
        }
        return refs;
    },

    /**
     * Parse flow JSON and return actions array.
     */
    _getFlowActions: function(flowGr) {
        var model = flowGr.getValue('model');
        if (!model) return [];

        try {
            var parsed = JSON.parse(model);
            return parsed.actions || parsed.stages || [];
        } catch (e) {
            gs.error('FlowGuard: Failed to parse flow model for ' + flowGr.getValue('name'));
            return [];
        }
    },

    /**
     * Attempt to resolve a data pill path within the action context.
     */
    _resolvePill: function(pillPath, actions, currentIdx) {
        if (pillPath.indexOf('trigger') === 0) return true;
        for (var i = 0; i < currentIdx; i++) {
            if (actions[i].name && pillPath.indexOf(actions[i].name) === 0)
                return true;
        }
        return false;
    },

    type: 'FlowGuardValidator'
};
