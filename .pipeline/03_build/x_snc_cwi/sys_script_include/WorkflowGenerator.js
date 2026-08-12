var WorkflowGenerator = Class.create();
WorkflowGenerator.prototype = {
    initialize: function() {
        this.AGENT_STUDIO_PREFIX = 'x_snc_cwi_agent_';
    },

    /**
     * Generate an AI Agent Studio workflow definition for a given pattern.
     * @param {string} pattern — one of APPROVAL | PROVISIONING | NOTIFICATION | ESCALATION
     * @param {string} catalogItemSysId — sc_cat_item.sys_id
     * @param {string} catalogItemName — sc_cat_item.name
     * @return {Object} workflowDefinition JSON
     */
    generateWorkflow: function(pattern, catalogItemSysId, catalogItemName) {
        var definition = {
            name: catalogItemName + ' — ' + pattern + ' Workflow',
            description: 'Auto-generated AI Agent Studio workflow for pattern: ' + pattern,
            scope: 'x_snc_cwi',
            active: true,
            start_node: 'orchestrator',
            nodes: [
                {
                    id: 'orchestrator',
                    type: 'orchestrator',
                    name: 'Catalog Orchestrator Agent',
                    next: this._getSpecialistAgent(pattern),
                },
                {
                    id: 'approval_agent',
                    type: 'specialist',
                    name: 'Approval Agent',
                    skill: 'Approval assistance',
                    config: { approver_field: 'requested_for.manager', timeout_hours: 48 }
                },
                {
                    id: 'provisioning_agent',
                    type: 'specialist',
                    name: 'Provisioning Agent',
                    skill: 'Request status',
                    config: { auto_fulfill: true, cmdb_relationship: 'Depends on::Used by' }
                },
                {
                    id: 'notification_agent',
                    type: 'specialist',
                    name: 'Notification Agent',
                    skill: 'Now Assist skills::Notification',
                    config: { channels: ['email', 'slack'], template: 'x_snc_cwi_notification_template' }
                },
                {
                    id: 'escalation_agent',
                    type: 'specialist',
                    name: 'Escalation Agent',
                    skill: 'Issue Readiness',
                    config: { sla_breach_threshold: 80, escalation_group: 'IT Management' }
                }
            ],
            variables: [
                { name: 'request_item', type: 'reference', reference: 'sc_req_item' },
                { name: 'catalog_item', type: 'reference', reference: 'sc_cat_item' },
                { name: 'requester', type: 'reference', reference: 'sys_user' }
            ]
        };

        // Wire the specialist node
        var specialist = this._getSpecialistAgent(pattern);
        for (var i = 0; i < definition.nodes.length; i++) {
            if (definition.nodes[i].id === specialist) {
                definition.nodes[i].next = 'end';
            }
        }
        definition.nodes.push({ id: 'end', type: 'end', name: 'Workflow Complete' });

        // Persist metadata
        this._saveDefinition(pattern, catalogItemSysId, definition);

        return definition;
    },

    _getSpecialistAgent: function(pattern) {
        var map = { APPROVAL: 'approval_agent', PROVISIONING: 'provisioning_agent', NOTIFICATION: 'notification_agent', ESCALATION: 'escalation_agent' };
        return map[pattern] || 'approval_agent';
    },

    _saveDefinition: function(pattern, catItemId, definition) {
        var gr = new GlideRecord('x_snc_cwi_scan_run');
        gr.initialize();
        gr.catalog_item = catItemId;
        gr.pattern = pattern;
        gr.generated_definition = JSON.stringify(definition);
        gr.insert();
    },

    type: 'WorkflowGenerator'
};
