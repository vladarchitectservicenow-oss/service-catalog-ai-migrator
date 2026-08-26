// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — TowerGovernance Script Include
// Governance alert detection + alert lifecycle management + NL query

var TowerGovernance = Class.create();
TowerGovernance.prototype = {
    initialize: function() {
        this.TABLE_RECORD = 'x_snc_ai_tower_record';
        this.TABLE_ALERT = 'x_snc_ai_tower_alert';
        this.TABLE_CONFIG = 'x_snc_ai_tower_config';
        this.alertsCreated = 0;
    },

    /**
     * Run all governance checks — called by scheduled job (daily 02:00)
     * @return {Object} { alerts_created, alerts_summary }
     */
    detectAll: function() {
        this.alertsCreated = 0;
        var instances = this._getActiveInstances();
        var summary = [];

        for (var i = 0; i < instances.length; i++) {
            var inst = instances[i];
            this._checkSuccessRateDrop(inst.sys_id, inst.name);
            this._checkAdoptionGap(inst.sys_id, inst.name);
            this._checkFailureSpike(inst.sys_id, inst.name);
            this._checkConcentrationRisk(inst.sys_id, inst.name);
            this._checkStaleSync(inst.sys_id, inst.name);
        }

        return {
            alerts_created: this.alertsCreated,
            instances_checked: instances.length
        };
    },

    /**
     * Check: success rate dropped >10% below 30-day rolling average
     * @param {String} instanceId
     * @param {String} instanceName
     */
    _checkSuccessRateDrop: function(instanceId, instanceName) {
        var products = this._getProductsForInstance(instanceId);
        for (var p = 0; p < products.length; p++) {
            var current = this._getRecentMetric(instanceId, products[p], 'success_rate', 1);
            var baseline = this._getAverageMetric(instanceId, products[p], 'success_rate', 30);
            if (current !== null && baseline !== null && baseline > 0) {
                var drop = baseline - current;
                if (drop >= 10) {
                    this.createAlert({
                        type: 'success_rate_drop',
                        severity: drop >= 20 ? 'critical' : 'warning',
                        instance: instanceId,
                        instance_name: instanceName,
                        product: products[p],
                        title: 'Success rate dropped for ' + products[p] + ' on ' + instanceName,
                        description: products[p] + ' success rate on ' + instanceName + ' dropped from ' +
                            baseline + '% (30-day avg) to ' + current + '% — a drop of ' + drop + '%.',
                        recommended_action: 'Review recent changes to ' + products[p] + ' configuration on ' +
                            instanceName + '. Check for failed executions in the trace viewer.'
                    });
                }
            }
        }
    },

    /**
     * Check: adoption below threshold in any department
     * @param {String} instanceId
     * @param {String} instanceName
     */
    _checkAdoptionGap: function(instanceId, instanceName) {
        var threshold = this._getConfigValue('adoption_threshold', '15');
        var thresholdNum = parseInt(threshold, 10) || 15;
        var departments = this._getDepartments(instanceId);
        for (var d = 0; d < departments.length; d++) {
            var dept = departments[d];
            var adoptionRate = this._getDepartmentAdoption(instanceId, dept);
            if (adoptionRate !== null && adoptionRate < thresholdNum) {
                this.createAlert({
                    type: 'adoption_gap',
                    severity: 'warning',
                    instance: instanceId,
                    instance_name: instanceName,
                    title: 'Low AI adoption in ' + dept + ' on ' + instanceName,
                    description: 'Department "' + dept + '" on ' + instanceName + ' has AI adoption rate of ' +
                        adoptionRate + '% (threshold: ' + thresholdNum + '%).',
                    recommended_action: 'Investigate why ' + dept + ' is not adopting AI tools. ' +
                        'Consider targeted training or workflow integration.'
                });
            }
        }
    },

    /**
     * Check: failure count exceeds 2x rolling average
     * @param {String} instanceId
     * @param {String} instanceName
     */
    _checkFailureSpike: function(instanceId, instanceName) {
        var products = this._getProductsForInstance(instanceId);
        for (var p = 0; p < products.length; p++) {
            var currentFailures = this._getRecentMetric(instanceId, products[p], 'failure_rate', 1);
            var baselineFailures = this._getAverageMetric(instanceId, products[p], 'failure_rate', 30);
            if (currentFailures !== null && baselineFailures !== null && baselineFailures > 0) {
                if (currentFailures >= baselineFailures * 2) {
                    this.createAlert({
                        type: 'failure_spike',
                        severity: currentFailures >= baselineFailures * 3 ? 'critical' : 'warning',
                        instance: instanceId,
                        instance_name: instanceName,
                        product: products[p],
                        title: 'Failure spike for ' + products[p] + ' on ' + instanceName,
                        description: products[p] + ' failure rate on ' + instanceName + ' is ' +
                            currentFailures + '%, which is ' + Math.round(currentFailures / baselineFailures) +
                            'x the 30-day average of ' + baselineFailures + '%.',
                        recommended_action: 'Check recent AI execution traces for ' + products[p] +
                            ' on ' + instanceName + ' for common failure patterns.'
                    });
                }
            }
        }
    },

    /**
     * Check: <5% of users generate >65% of AI usage (concentration risk)
     * @param {String} instanceId
     * @param {String} instanceName
     */
    _checkConcentrationRisk: function(instanceId, instanceName) {
        var userUsage = this._getUserUsageDistribution(instanceId);
        if (!userUsage || userUsage.length === 0) return;

        var totalRequests = 0;
        for (var i = 0; i < userUsage.length; i++) {
            totalRequests += userUsage[i].requests;
        }
        if (totalRequests === 0) return;

        // Sort by requests descending
        userUsage.sort(function(a, b) { return b.requests - a.requests; });

        var topUsersCount = Math.max(1, Math.ceil(userUsage.length * 0.05));
        var topUserRequests = 0;
        for (var j = 0; j < topUsersCount; j++) {
            topUserRequests += userUsage[j].requests;
        }
        var topPercent = Math.round((topUserRequests / totalRequests) * 100);

        if (topPercent > 65) {
            this.createAlert({
                type: 'concentration_risk',
                severity: 'info',
                instance: instanceId,
                instance_name: instanceName,
                title: 'AI usage concentrated in top users on ' + instanceName,
                description: topUsersCount + ' users (' + Math.round((topUsersCount / userUsage.length) * 100) +
                    '% of active users) generated ' + topPercent + '% of all AI usage on ' + instanceName + '.',
                recommended_action: 'Encourage broader adoption across the organization. ' +
                    'Top users may also be a bottleneck if they leave.'
            });
        }
    },

    /**
     * Check: instance hasn't synced in >24 hours
     * @param {String} instanceId
     * @param {String} instanceName
     */
    _checkStaleSync: function(instanceId, instanceName) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        if (!gr.get(instanceId)) return;
        var lastSyncStr = gr.getValue('last_sync');
        if (!lastSyncStr) {
            this.createAlert({
                type: 'stale_data',
                severity: 'warning',
                instance: instanceId,
                instance_name: instanceName,
                title: 'No telemetry received from ' + instanceName,
                description: instanceName + ' has never synced telemetry data.',
                recommended_action: 'Verify the AIControlTower Collector is installed and the scheduled job is active on ' + instanceName + '.'
            });
            return;
        }
        var lastSync = new GlideDateTime(lastSyncStr);
        var now = new GlideDateTime();
        var diffMs = now.getNumericValue() - lastSync.getNumericValue();
        var diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours > 24) {
            this.createAlert({
                type: 'stale_data',
                severity: diffHours >= 48 ? 'critical' : 'warning',
                instance: instanceId,
                instance_name: instanceName,
                title: 'Stale telemetry from ' + instanceName,
                description: instanceName + ' last synced ' + Math.round(diffHours) +
                    ' hours ago. Telemetry is stale.',
                recommended_action: 'Check network connectivity between ' + instanceName +
                    ' and the hub instance. Verify the collector scheduled job is running.'
            });
        }
    },

    /**
     * Create a governance alert
     * @param {Object} alertData - { type, severity, instance, title, description, recommended_action }
     * @return {String} alert sys_id
     */
    createAlert: function(alertData) {
        // Dedup: check for existing unresolved alert of same type+instance
        var grExist = new GlideRecord(this.TABLE_ALERT);
        grExist.addQuery('type', alertData.type);
        grExist.addQuery('instance', alertData.instance);
        grExist.addQuery('status', 'new');
        if (alertData.product) {
            grExist.addQuery('product', alertData.product);
        }
        grExist.setLimit(1);
        grExist.query();
        if (grExist.next()) {
            // Update existing alert with latest data
            grExist.setValue('description', alertData.description);
            grExist.setValue('recommended_action', alertData.recommended_action || '');
            grExist.setValue('detected_at', new GlideDateTime());
            grExist.update();
            return grExist.getUniqueValue();
        }

        var gr = new GlideRecord(this.TABLE_ALERT);
        gr.initialize();
        gr.setValue('type', alertData.type);
        gr.setValue('severity', alertData.severity || 'warning');
        gr.setValue('instance', alertData.instance);
        gr.setValue('product', alertData.product || '');
        gr.setValue('title', alertData.title);
        gr.setValue('description', alertData.description);
        gr.setValue('recommended_action', alertData.recommended_action || '');
        gr.setValue('status', 'new');
        gr.setValue('detected_at', new GlideDateTime());
        var alertId = gr.insert();
        if (alertId) {
            this.alertsCreated++;
        }
        return alertId;
    },

    /**
     * Acknowledge an alert
     * @param {String} alertId - alert sys_id
     * @param {String} acknowledgedBy - user sys_id
     * @return {Boolean}
     */
    acknowledgeAlert: function(alertId, acknowledgedBy) {
        var gr = new GlideRecord(this.TABLE_ALERT);
        if (gr.get(alertId)) {
            gr.setValue('status', 'acknowledged');
            gr.setValue('acknowledged_by', acknowledgedBy || gs.getUserID());
            gr.setValue('acknowledged_at', new GlideDateTime());
            gr.update();
            return true;
        }
        return false;
    },

    /**
     * Resolve an alert
     * @param {String} alertId - alert sys_id
     * @param {String} resolvedBy - user sys_id
     * @param {String} resolutionNote - optional note
     * @return {Boolean}
     */
    resolveAlert: function(alertId, resolvedBy, resolutionNote) {
        var gr = new GlideRecord(this.TABLE_ALERT);
        if (gr.get(alertId)) {
            gr.setValue('status', 'resolved');
            gr.setValue('resolved_by', resolvedBy || gs.getUserID());
            gr.setValue('resolved_at', new GlideDateTime());
            if (resolutionNote) {
                gr.setValue('resolution_note', resolutionNote);
            }
            gr.update();
            return true;
        }
        return false;
    },

    /**
     * Get alerts with optional filters — used by REST GET /status?type=alerts
     * @param {Object} filters - { severity, status, instance, product }
     * @return {Array}
     */
    getAlerts: function(filters) {
        var results = [];
        var gr = new GlideRecord(this.TABLE_ALERT);
        if (filters) {
            if (filters.severity) gr.addQuery('severity', filters.severity);
            if (filters.status) gr.addQuery('status', filters.status);
            if (filters.instance) gr.addQuery('instance', filters.instance);
            if (filters.product) gr.addQuery('product', filters.product);
        }
        gr.orderByDesc('detected_at');
        gr.setLimit(filters && filters.limit ? filters.limit : 100);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                type: gr.getValue('type') || '',
                severity: gr.getValue('severity') || '',
                instance: gr.getValue('instance') || '',
                product: gr.getValue('product') || '',
                title: gr.getValue('title') || '',
                description: gr.getValue('description') || '',
                recommended_action: gr.getValue('recommended_action') || '',
                status: gr.getValue('status') || 'new',
                detected_at: gr.getValue('detected_at') || '',
                acknowledged_by: gr.getValue('acknowledged_by') || '',
                resolved_at: gr.getValue('resolved_at') || ''
            });
        }
        return results;
    },

    // ─── NL Query (Now Assist integration) ───

    /**
     * Translate a natural language query to encoded query on record table
     * @param {String} nlQuery - e.g. "show me AI adoption in HR department across all instances"
     * @return {Object} { encoded_query, explanation }
     */
    translateQuery: function(nlQuery) {
        if (!nlQuery) {
            return { encoded_query: '', explanation: 'Empty query' };
        }
        var query = nlQuery.toLowerCase();
        var parts = [];

        // Simple keyword-based translation
        if (query.indexOf('now assist') >= 0) {
            parts.push('product=Now Assist');
        } else if (query.indexOf('build agent') >= 0) {
            parts.push('product=Build Agent');
        } else if (query.indexOf('ai agent') >= 0) {
            parts.push('product=AI Agent');
        }

        if (query.indexOf('hr') >= 0 || query.indexOf('human resources') >= 0) {
            parts.push('department=HR');
        } else if (query.indexOf('it') >= 0) {
            parts.push('department=IT');
        } else if (query.indexOf('finance') >= 0) {
            parts.push('department=Finance');
        }

        if (query.indexOf('success') >= 0) {
            parts.push('metric_type=success_rate');
        } else if (query.indexOf('failure') >= 0) {
            parts.push('metric_type=failure_rate');
        } else if (query.indexOf('adoption') >= 0) {
            parts.push('metric_type=adoption_rate');
        }

        if (query.indexOf('usage') >= 0) {
            parts.push('record_type=usage');
        } else if (query.indexOf('execution') >= 0) {
            parts.push('record_type=execution');
        } else if (query.indexOf('metric') >= 0) {
            parts.push('record_type=metric');
        }

        var encoded = parts.join('^');
        return {
            encoded_query: encoded,
            explanation: 'Translated "' + nlQuery + '" to: ' + (encoded || 'no filters detected')
        };
    },

    /**
     * Execute an encoded query on the record table
     * @param {String} encodedQuery - ServiceNow encoded query
     * @param {Number} limit - max results
     * @return {Array}
     */
    executeQuery: function(encodedQuery, limit) {
        var results = [];
        var gr = new GlideRecord(this.TABLE_RECORD);
        if (encodedQuery) {
            gr.addEncodedQuery(encodedQuery);
        }
        gr.orderByDesc('sync_timestamp');
        gr.setLimit(limit || 100);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                record_type: gr.getValue('record_type') || '',
                instance: gr.getValue('instance') || '',
                product: gr.getValue('product') || '',
                capability: gr.getValue('capability') || '',
                user_name: gr.getValue('user_name') || '',
                department: gr.getValue('department') || '',
                outcome: gr.getValue('outcome') || '',
                request_count: parseInt(gr.getValue('request_count') || '0', 10),
                success_count: parseInt(gr.getValue('success_count') || '0', 10),
                failure_count: parseInt(gr.getValue('failure_count') || '0', 10),
                sync_timestamp: gr.getValue('sync_timestamp') || ''
            });
        }
        return results;
    },

    // ─── Helper Methods ───

    _getActiveInstances: function() {
        var instances = [];
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'instance');
        gr.addQuery('active', 'true');
        gr.query();
        while (gr.next()) {
            instances.push({ sys_id: gr.getUniqueValue(), name: gr.getValue('name') || '' });
        }
        return instances;
    },

    _getProductsForInstance: function(instanceId) {
        var products = {};
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('record_type', 'IN', 'usage,execution');
        gr.query();
        while (gr.next()) {
            var product = gr.getValue('product');
            if (product) products[product] = true;
        }
        return Object.keys(products);
    },

    _getRecentMetric: function(instanceId, product, metricType, days) {
        var since = new GlideDateTime();
        since.addDaysUTC(-days);
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('record_type', 'metric');
        gr.addQuery('instance', instanceId);
        gr.addQuery('product', product);
        gr.addQuery('metric_type', metricType);
        gr.addQuery('period_end', '>=', since);
        gr.orderByDesc('period_end');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return parseInt(gr.getValue('metric_value') || '0', 10);
        }
        return null;
    },

    _getAverageMetric: function(instanceId, product, metricType, days) {
        var since = new GlideDateTime();
        since.addDaysUTC(-days);
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('record_type', 'metric');
        gr.addQuery('instance', instanceId);
        gr.addQuery('product', product);
        gr.addQuery('metric_type', metricType);
        gr.addQuery('period_end', '>=', since);
        gr.query();
        var sum = 0;
        var count = 0;
        while (gr.next()) {
            sum += parseInt(gr.getValue('metric_value') || '0', 10);
            count++;
        }
        return count > 0 ? Math.round(sum / count) : null;
    },

    _getDepartments: function(instanceId) {
        var departments = {};
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('record_type', 'IN', 'usage,execution');
        gr.query();
        while (gr.next()) {
            var dept = gr.getValue('department');
            if (dept) departments[dept] = true;
        }
        return Object.keys(departments);
    },

    _getDepartmentAdoption: function(instanceId, department) {
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('department', department);
        gr.addQuery('record_type', 'usage');
        gr.query();
        var users = {};
        while (gr.next()) {
            var uid = gr.getValue('user_sysid');
            if (uid) users[uid] = true;
        }
        var aiUsers = Object.keys(users).length;
        if (aiUsers === 0) return null;
        // Without total department user count, use a rough estimate
        // In production, this would query cmn_department -> sys_user
        return Math.min(100, Math.round((aiUsers / Math.max(aiUsers * 3, 10)) * 100));
    },

    _getUserUsageDistribution: function(instanceId) {
        var userMap = {};
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('record_type', 'usage');
        gr.query();
        while (gr.next()) {
            var uid = gr.getValue('user_sysid');
            if (!uid) continue;
            if (!userMap[uid]) {
                userMap[uid] = { user_sysid: uid, requests: 0 };
            }
            userMap[uid].requests += parseInt(gr.getValue('request_count') || '1', 10);
        }
        return Object.keys(userMap).map(function(k) { return userMap[k]; });
    },

    _getConfigValue: function(key, defaultValue) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'global');
        gr.addQuery('name', key);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('config_value') || defaultValue;
        }
        return defaultValue;
    },

    type: 'TowerGovernance'
};