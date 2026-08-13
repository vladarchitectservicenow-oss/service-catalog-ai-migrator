// Now Assist Cost Lens — NACLCostTracker
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Captures Now Assist interactions, classifies outcomes, estimates tokens,
// computes costs, and logs to x_nacl_interaction_log.
// @class NACLCostTracker @namespace x_nacl

var NACLCostTracker = Class.create();
NACLCostTracker.prototype = {
    initialize: function() {
        this.config = null;
    },

    /**
     * Capture a Virtual Agent conversation interaction.
     * Reads sys_cs_conversation + sys_cs_live_message to compute metrics.
     * @param {string} conversationSysId - sys_id of sys_cs_conversation
     */
    captureInteraction: function(conversationSysId) {
        if (!conversationSysId) {
            return;
        }

        var convGr = new GlideRecord('sys_cs_conversation');
        if (!convGr.get(conversationSysId)) {
            return;
        }

        var state = convGr.getValue('state') || '';
        if (state !== 'closed') {
            return;
        }

        var topic = convGr.getValue('topic') || '';
        var userId = convGr.getValue('opened_by') || '';
        var convStart = convGr.getValue('sys_created_on') || '';

        // Count messages and estimate tokens
        var msgGr = new GlideRecord('sys_cs_live_message');
        msgGr.addQuery('conversation', conversationSysId);
        msgGr.orderBy('sys_created_on');
        msgGr.query();

        var messageCount = 0;
        var totalMessageLength = 0;
        var firstMsgTime = null;
        var lastMsgTime = null;
        var bodies = [];

        while (msgGr.next()) {
            messageCount++;
            var body = msgGr.getValue('body') || '';
            totalMessageLength += body.length;
            bodies.push(body);
            var msgTime = msgGr.getValue('sys_created_on');
            if (!firstMsgTime) {
                firstMsgTime = msgTime;
            }
            lastMsgTime = msgTime;
        }

        if (messageCount === 0) {
            return;
        }

        var avgMessageLength = Math.floor(totalMessageLength / messageCount);
        var estimatedTokens = this.estimateTokens(messageCount, avgMessageLength, 'virtual_agent');
        var outcome = this.classifyOutcome(conversationSysId, messageCount, bodies);
        var durationSeconds = this._computeDuration(firstMsgTime, lastMsgTime);
        var computedCost = this.computeCost(estimatedTokens, 'virtual_agent');
        var config = this._readCostConfig();
        var humanCostPerTicket = parseFloat(config.human_cost_per_ticket) || 0;
        var humanCostSaved = (outcome === 'resolved') ? humanCostPerTicket : 0;

        var interactionData = {
            conversation_id: conversationSysId,
            user_id: userId,
            feature_type: 'virtual_agent',
            message_count: messageCount,
            estimated_tokens: estimatedTokens,
            duration_seconds: durationSeconds,
            outcome: outcome,
            computed_cost: computedCost,
            human_cost_saved: humanCostSaved,
            linked_incident: '',
            topic: topic,
            conversation_start: convStart
        };

        this._upsertLog(interactionData);
    },

    /**
     * Capture an Incident Auto-Resolution interaction.
     * Called when an incident assigned to AI Agent is resolved.
     * @param {string} incidentSysId - sys_id of incident
     */
    captureIncidentAR: function(incidentSysId) {
        if (!incidentSysId) {
            return;
        }

        var incGr = new GlideRecord('incident');
        if (!incGr.get(incidentSysId)) {
            return;
        }

        var state = incGr.getValue('state') || '';
        if (state !== '6' && state !== '7') {
            return;
        }

        var userId = incGr.getValue('caller_id') || '';
        var shortDesc = incGr.getValue('short_description') || '';
        var estimatedTokens = this.estimateTokens(0, shortDesc.length, 'incident_ar');
        var computedCost = this.computeCost(estimatedTokens, 'incident_ar');
        var config = this._readCostConfig();
        var humanCostPerTicket = parseFloat(config.human_cost_per_ticket) || 0;
        var resolvedAt = incGr.getValue('resolved_at') || incGr.getValue('closed_at') || '';
        var openedAt = incGr.getValue('opened_at') || '';
        var durationSeconds = this._computeDuration(openedAt, resolvedAt);

        var interactionData = {
            conversation_id: incidentSysId,
            user_id: userId,
            feature_type: 'incident_ar',
            message_count: 1,
            estimated_tokens: estimatedTokens,
            duration_seconds: durationSeconds,
            outcome: 'resolved',
            computed_cost: computedCost,
            human_cost_saved: humanCostPerTicket,
            linked_incident: incidentSysId,
            topic: shortDesc.substring(0, 200),
            conversation_start: openedAt
        };

        this._upsertLog(interactionData);
    },

    /**
     * Classify the outcome of a VA conversation.
     * @param {string} conversationSysId
     * @param {number} messageCount
     * @returns {string} resolved|escalated|abandoned|looped|unknown
     */
    classifyOutcome: function(conversationSysId, messageCount, bodies) {
        var convGr = new GlideRecord('sys_cs_conversation');
        if (!convGr.get(conversationSysId)) {
            return 'unknown';
        }

        // Check for linked incident (escalated to human)
        var incGr = new GlideRecord('incident');
        incGr.addQuery('sys_created_on', '>=', convGr.getValue('sys_created_on'));
        incGr.addQuery('caller_id', convGr.getValue('opened_by'));
        incGr.addQuery('short_description', 'CONTAINS', 'Virtual Agent');
        incGr.setLimit(1);
        incGr.query();

        if (incGr.next()) {
            return 'escalated';
        }

        // Check for looped: same question pattern (uses pre-collected bodies)
        if (messageCount > 5 && bodies && bodies.length > 0) {
            var duplicateCount = 0;
            for (var i = 0; i < bodies.length; i++) {
                for (var j = i + 1; j < bodies.length; j++) {
                    if (bodies[i] === bodies[j] && bodies[i].length > 10) {
                        duplicateCount++;
                    }
                }
            }

            if (duplicateCount >= 3) {
                return 'looped';
            }
        }

        // Check if resolved (conversation closed with resolution)
        var resolution = convGr.getValue('resolution') || '';
        if (resolution) {
            return 'resolved';
        }

        // Check if abandoned (no resolution, no escalation)
        if (messageCount <= 3 && !resolution) {
            return 'abandoned';
        }

        return 'unknown';
    },

    /**
     * Estimate token consumption for an interaction.
     * @param {number} messageCount
     * @param {number} avgMessageLength
     * @param {string} featureType
     * @returns {number} estimated token count
     */
    estimateTokens: function(messageCount, avgMessageLength, featureType) {
        var tokenConfig = {
            virtual_agent: { base: 200, avg_per_msg: 150 },
            incident_ar: { base: 500, avg_per_msg: 0 },
            case_summary: { base: 800, avg_per_msg: 0 },
            chat_summary: { base: 600, avg_per_msg: 0 },
            flow_gen: { base: 2000, avg_per_msg: 0 },
            catalog_gen: { base: 1500, avg_per_msg: 0 },
            other: { base: 500, avg_per_msg: 100 }
        };

        var cfg = tokenConfig[featureType] || tokenConfig.other;
        var tokens = cfg.base + (messageCount * cfg.avg_per_msg);

        // For single-shot features, use message length as additional signal
        if (cfg.avg_per_msg === 0 && avgMessageLength > 0) {
            tokens += Math.floor(avgMessageLength / 4); // ~4 chars per token
        }

        return Math.max(tokens, 1);
    },

    /**
     * Compute cost for an interaction.
     * @param {number} estimatedTokens
     * @param {string} featureType
     * @returns {number} cost in currency units
     */
    computeCost: function(estimatedTokens, featureType) {
        var config = this._readCostConfig();
        var costPer1k = parseFloat(config.cost_per_1k_tokens) || 0.03;
        var tokenCost = (estimatedTokens / 1000) * costPer1k;

        // Fixed per-interaction cost (amortized SKU cost)
        var fixedCost = 0;
        if (config.sku_monthly_cost) {
            var skuMonthly = parseFloat(config.sku_monthly_cost) || 0;
            // Assume ~10,000 interactions/month for amortization
            fixedCost = skuMonthly / 10000;
        }

        return parseFloat((tokenCost + fixedCost).toFixed(6));
    },

    /**
     * Recalculate all interactions in a date range.
     * Used when cost config changes (SKU price update).
     * @param {string} startDate - GlideDateTime string
     * @param {string} endDate - GlideDateTime string
     */
    recalculateAll: function(startDate, endDate) {
        var logGr = new GlideRecord('x_nacl_interaction_log');
        if (startDate) {
            logGr.addQuery('captured_at', '>=', startDate);
        }
        if (endDate) {
            logGr.addQuery('captured_at', '<=', endDate);
        }
        logGr.query();

        var updated = 0;
        while (logGr.next()) {
            var tokens = parseInt(logGr.getValue('estimated_tokens')) || 0;
            var featureType = logGr.getValue('feature_type') || 'other';
            var newCost = this.computeCost(tokens, featureType);
            logGr.setValue('computed_cost', newCost);
            try {
                logGr.update();
                updated++;
            } catch (e) {
                gs.error('NACLCostTracker: Failed to update log ' + logGr.getUniqueValue() + ': ' + e.message);
            }
        }

        gs.info('NACLCostTracker: Recalculated ' + updated + ' interaction logs');
        return updated;
    },

    /**
     * Upsert an interaction log record.
     * Checks for existing record by conversation_id + feature_type.
     * @param {object} data - interaction data
     * @returns {string} sys_id of created/updated record
     * @private
     */
    _upsertLog: function(data) {
        var logGr = new GlideRecord('x_nacl_interaction_log');
        logGr.addQuery('conversation_id', data.conversation_id);
        logGr.addQuery('feature_type', data.feature_type);
        logGr.setLimit(1);
        logGr.query();

        if (logGr.next()) {
            // Update existing
            for (var key in data) {
                if (data.hasOwnProperty(key)) {
                    logGr.setValue(key, data[key]);
                }
            }
            logGr.setValue('captured_at', new GlideDateTime().toString());
            try {
                logGr.update();
                return logGr.getUniqueValue();
            } catch (e) {
                gs.error('NACLCostTracker: Failed to update log: ' + e.message);
                return '';
            }
        } else {
            // Insert new
            logGr.initialize();
            for (var k in data) {
                if (data.hasOwnProperty(k)) {
                    logGr.setValue(k, data[k]);
                }
            }
            logGr.setValue('captured_at', new GlideDateTime().toString());
            try {
                return logGr.insert();
            } catch (e) {
                gs.error('NACLCostTracker: Failed to insert log: ' + e.message);
                return '';
            }
        }
    },

    /**
     * Public accessor for cost configuration.
     * Wraps _readCostConfig() so external classes don't depend on private internals.
     * @returns {object} config object
     */
    getCostConfig: function() {
        return this._readCostConfig();
    },

    /**
     * Read cost configuration from x_nacl_cost_config.
     * Returns defaults if no config record exists.
     * @returns {object} config object
     * @private
     */
    _readCostConfig: function() {
        if (this.config) {
            return this.config;
        }

        var cfgGr = new GlideRecord('x_nacl_cost_config');
        cfgGr.setLimit(1);
        cfgGr.query();

        if (cfgGr.next()) {
            this.config = {
                sku_monthly_cost: cfgGr.getValue('sku_monthly_cost') || '0',
                cost_per_1k_tokens: cfgGr.getValue('cost_per_1k_tokens') || '0.03',
                human_cost_per_ticket: cfgGr.getValue('human_cost_per_ticket') || '0',
                budget_monthly_limit: cfgGr.getValue('budget_monthly_limit') || '0',
                forecast_confidence: cfgGr.getValue('forecast_confidence') || '0.68',
                waste_threshold_cost: cfgGr.getValue('waste_threshold_cost') || '0',
                anomaly_zscore: cfgGr.getValue('anomaly_zscore') || '2.5',
                alert_email_recipients: cfgGr.getValue('alert_email_recipients') || '',
                alert_slack_webhook: cfgGr.getValue('alert_slack_webhook') || '',
                ai_recommendations: cfgGr.getValue('ai_recommendations') || 'false',
                data_retention_days: cfgGr.getValue('data_retention_days') || '365'
            };
        } else {
            this.config = {
                sku_monthly_cost: '0',
                cost_per_1k_tokens: '0.03',
                human_cost_per_ticket: '0',
                budget_monthly_limit: '0',
                forecast_confidence: '0.68',
                waste_threshold_cost: '0',
                anomaly_zscore: '2.5',
                alert_email_recipients: '',
                alert_slack_webhook: '',
                ai_recommendations: 'false',
                data_retention_days: '365'
            };
        }

        return this.config;
    },

    /**
     * Compute duration between two GlideDateTime strings.
     * @param {string} startTime
     * @param {string} endTime
     * @returns {number} duration in seconds
     * @private
     */
    _computeDuration: function(startTime, endTime) {
        if (!startTime || !endTime) {
            return 0;
        }
        var startGdt = new GlideDateTime(startTime);
        var endGdt = new GlideDateTime(endTime);
        var diff = GlideDateTime.subtract(endGdt, startGdt);
        return Math.floor(diff.getNumericValue() / 1000);
    },

    type: 'NACLCostTracker'
};
