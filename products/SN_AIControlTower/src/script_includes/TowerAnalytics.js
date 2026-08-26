// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — TowerAnalytics Script Include
// Metrics aggregation + ROI estimation engine

var TowerAnalytics = Class.create();
TowerAnalytics.prototype = {
    initialize: function() {
        this.TABLE_RECORD = 'x_snc_ai_tower_record';
        this.TABLE_CONFIG = 'x_snc_ai_tower_config';
        // Default time-savings matrix (minutes saved per interaction type)
        this.DEFAULT_SAVINGS_MATRIX = {
            'Now Assist:Catalog Item Generation': 45,
            'Now Assist:Flow Generation': 60,
            'Now Assist:Code Generation': 30,
            'Now Assist:Case Summarization': 15,
            'Build Agent:Catalog Item Creation': 120,
            'Build Agent:Flow Creation': 90,
            'Build Agent:Script Generation': 60,
            'AI Agent:Workflow Automation': 30,
            'AI Agent:Data Lookup': 10,
            'AI Agent:Notification': 5
        };
        this.DEFAULT_HOURLY_RATE = 75; // USD
    },

    /**
     * Aggregate all metrics from raw records — called by scheduled job
     * Reads records since last aggregation, computes metrics per instance/product/capability
     * @return {Object} { aggregated_count, instances_processed }
     */
    aggregateAll: function() {
        var lastAggregation = this._getLastAggregationTime();
        var instances = this._getActiveInstances();
        var totalCount = 0;

        for (var i = 0; i < instances.length; i++) {
            var count = this.aggregateInstance(instances[i].sys_id, lastAggregation);
            totalCount += count;
        }

        this._updateLastAggregationTime();
        return { aggregated_count: totalCount, instances_processed: instances.length };
    },

    /**
     * Aggregate metrics for a single instance
     * @param {String} instanceId - instance sys_id
     * @param {GlideDateTime} since - only process records after this time
     * @return {Number} number of metric records created
     */
    aggregateInstance: function(instanceId, since) {
        var count = 0;
        var products = this._getProductsForInstance(instanceId, since);

        for (var p = 0; p < products.length; p++) {
            var capabilities = this._getCapabilitiesForProduct(instanceId, products[p], since);
            for (var c = 0; c < capabilities.length; c++) {
                this.computeAndStoreMetric(instanceId, products[p], capabilities[c], since);
                count++;
            }
            // Also compute product-level aggregate (no capability filter)
            this.computeAndStoreMetric(instanceId, products[p], null, since);
            count++;
        }
        return count;
    },

    /**
     * Compute a specific metric type for a set of records
     * @param {String} metricType - requests|success_rate|active_users|adoption_rate|failure_rate
     * @param {GlideRecord} records - GlideRecord of usage/execution records
     * @return {Number} metric value
     */
    computeMetric: function(metricType, records) {
        var value = 0;

        if (metricType === 'requests') {
            while (records.next()) {
                value += parseInt(records.getValue('request_count') || '1', 10);
            }
        } else if (metricType === 'success_rate') {
            var totalReq = 0;
            var successReq = 0;
            while (records.next()) {
                totalReq += parseInt(records.getValue('request_count') || '1', 10);
                successReq += parseInt(records.getValue('success_count') || '0', 10);
            }
            value = totalReq > 0 ? Math.round((successReq / totalReq) * 100) : 0;
        } else if (metricType === 'active_users') {
            var userIds = {};
            while (records.next()) {
                var uid = records.getValue('user_sysid');
                if (uid) userIds[uid] = true;
            }
            value = Object.keys(userIds).length;
        } else if (metricType === 'failure_rate') {
            var totalFail = 0;
            var totalAll = 0;
            while (records.next()) {
                totalAll += parseInt(records.getValue('request_count') || '1', 10);
                totalFail += parseInt(records.getValue('failure_count') || '0', 10);
            }
            value = totalAll > 0 ? Math.round((totalFail / totalAll) * 100) : 0;
        } else if (metricType === 'adoption_rate') {
            // Adoption = active AI users / total instance users
            // Total users fetched from sys_user — requires cross-scope privilege
            var aiUsers = {};
            while (records.next()) {
                var userId = records.getValue('user_sysid');
                if (userId) aiUsers[userId] = true;
            }
            var aiUserCount = Object.keys(aiUsers).length;
            var totalUsers = this._getInstanceTotalUsers();
            value = totalUsers > 0 ? Math.round((aiUserCount / totalUsers) * 100) : 0;
        }

        return value;
    },

    /**
     * Compute and store a metric record
     * @param {String} instanceId
     * @param {String} product
     * @param {String} capability - null for product-level aggregate
     * @param {GlideDateTime} since
     */
    computeAndStoreMetric: function(instanceId, product, capability, since) {
        var recordTypes = ['usage', 'execution'];
        var metricTypes = ['requests', 'success_rate', 'active_users', 'failure_rate'];

        for (var rt = 0; rt < recordTypes.length; rt++) {
            for (var mt = 0; mt < metricTypes.length; mt++) {
                var records = this._queryRecords(instanceId, product, capability, recordTypes[rt], since);
                var value = this.computeMetric(metricTypes[mt], records);
                this._storeMetric(instanceId, product, capability, metricTypes[mt], value);
            }
        }
    },

    /**
     * Store a metric record
     * @param {String} instanceId
     * @param {String} product
     * @param {String} capability
     * @param {String} metricType
     * @param {Number} value
     */
    _storeMetric: function(instanceId, product, capability, metricType, value) {
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.initialize();
        gr.setValue('record_type', 'metric');
        gr.setValue('instance', instanceId);
        gr.setValue('product', product);
        gr.setValue('capability', capability || '');
        gr.setValue('metric_type', metricType);
        gr.setValue('metric_value', value);
        gr.setValue('period_start', this._getPeriodStart());
        gr.setValue('period_end', new GlideDateTime());
        gr.setValue('source_id', 'metric_' + instanceId + '_' + product + '_' + (capability || 'all') + '_' + metricType + '_' + gs.nowDateTime());
        gr.setValue('sync_timestamp', new GlideDateTime());
        gr.insert();
    },

    /**
     * Query records for metric computation
     * @param {String} instanceId
     * @param {String} product
     * @param {String} capability
     * @param {String} recordType
     * @param {GlideDateTime} since
     * @return {GlideRecord}
     */
    _queryRecords: function(instanceId, product, capability, recordType, since) {
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('product', product);
        gr.addQuery('record_type', recordType);
        if (capability) {
            gr.addQuery('capability', capability);
        }
        if (since) {
            gr.addQuery('sync_timestamp', '>=', since);
        }
        gr.query();
        return gr;
    },

    /**
     * Query aggregated metrics — used by REST GET /status?type=metrics
     * @param {Object} filters - { instance, product, time_range }
     * @return {Array} metric records
     */
    queryMetrics: function(filters) {
        var results = [];
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('record_type', 'metric');
        if (filters && filters.instance) {
            gr.addQuery('instance', filters.instance);
        }
        if (filters && filters.product) {
            gr.addQuery('product', filters.product);
        }
        if (filters && filters.metric_type) {
            gr.addQuery('metric_type', filters.metric_type);
        }
        if (filters && filters.since) {
            gr.addQuery('period_end', '>=', filters.since);
        }
        gr.orderByDesc('period_end');
        gr.setLimit(filters && filters.limit ? filters.limit : 500);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                instance: gr.getValue('instance') || '',
                product: gr.getValue('product') || '',
                capability: gr.getValue('capability') || '',
                metric_type: gr.getValue('metric_type') || '',
                metric_value: parseInt(gr.getValue('metric_value') || '0', 10),
                period_start: gr.getValue('period_start') || '',
                period_end: gr.getValue('period_end') || ''
            });
        }
        return results;
    },

    // ─── ROI Engine ───

    /**
     * Calculate ROI for an instance over a time range
     * @param {String} instanceId
     * @param {Object} timeRange - { start, end }
     * @return {Object} { interactions, hours_saved, cost_saved, annualized_benefit }
     */
    calculateROI: function(instanceId, timeRange) {
        var savingsMatrix = this._getSavingsMatrix();
        var hourlyRate = this._getHourlyRate();
        var interactions = 0;
        var hoursSaved = 0;

        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('record_type', 'usage');
        if (timeRange && timeRange.start) {
            gr.addQuery('sync_timestamp', '>=', timeRange.start);
        }
        if (timeRange && timeRange.end) {
            gr.addQuery('sync_timestamp', '<=', timeRange.end);
        }
        gr.query();
        while (gr.next()) {
            var product = gr.getValue('product') || '';
            var capability = gr.getValue('capability') || '';
            var reqCount = parseInt(gr.getValue('request_count') || '1', 10);
            interactions += reqCount;
            var key = product + ':' + capability;
            var minutesSaved = savingsMatrix[key] || savingsMatrix[product + ':default'] || 20;
            hoursSaved += (minutesSaved * reqCount) / 60;
        }

        var costSaved = hoursSaved * hourlyRate;
        var annualizedBenefit = this._annualize(costSaved, timeRange);

        return {
            interactions: interactions,
            hours_saved: Math.round(hoursSaved),
            cost_saved: Math.round(costSaved),
            annualized_benefit: Math.round(annualizedBenefit),
            hourly_rate: hourlyRate
        };
    },

    /**
     * Generate ROI report for executive presentation
     * @param {String} instanceId
     * @return {Object} full ROI report
     */
    generateReport: function(instanceId) {
        var now = new GlideDateTime();
        var thirtyDaysAgo = new GlideDateTime();
        thirtyDaysAgo.addDaysUTC(-30);

        var roi30 = this.calculateROI(instanceId, { start: thirtyDaysAgo, end: now });
        var yearAgo = new GlideDateTime();
        yearAgo.addDaysUTC(-365);
        var roi365 = this.calculateROI(instanceId, { start: yearAgo, end: now });

        return {
            instance_id: instanceId,
            report_date: now.getDisplayValue(),
            last_30_days: roi30,
            last_365_days: roi365,
            summary: {
                total_interactions: roi365.interactions,
                total_hours_saved: roi365.hours_saved,
                total_cost_saved: roi365.cost_saved,
                annualized_benefit: roi365.annualized_benefit
            }
        };
    },

    /**
     * Get time-savings matrix from config or default
     * @return {Object} mapping of product:capability to minutes saved
     */
    _getSavingsMatrix: function() {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'global');
        gr.addQuery('name', 'savings_matrix');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            try {
                return JSON.parse(gr.getValue('config_value') || '{}');
            } catch (e) {
                return this.DEFAULT_SAVINGS_MATRIX;
            }
        }
        return this.DEFAULT_SAVINGS_MATRIX;
    },

    /**
     * Get hourly rate from config or default
     * @return {Number}
     */
    _getHourlyRate: function() {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'global');
        gr.addQuery('name', 'hourly_rate');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var rate = parseInt(gr.getValue('config_value') || '0', 10);
            return rate > 0 ? rate : this.DEFAULT_HOURLY_RATE;
        }
        return this.DEFAULT_HOURLY_RATE;
    },

    /**
     * Annualize a cost saving based on time range
     * @param {Number} costSaved
     * @param {Object} timeRange
     * @return {Number} annualized benefit
     */
    _annualize: function(costSaved, timeRange) {
        if (!timeRange || !timeRange.start) {
            return costSaved * 12; // assume monthly
        }
        var start = new GlideDateTime(timeRange.start);
        var end = timeRange.end ? new GlideDateTime(timeRange.end) : new GlideDateTime();
        var diffMs = end.getNumericValue() - start.getNumericValue();
        var diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays <= 0) return 0;
        return costSaved * (365 / diffDays);
    },

    // ─── Helper Methods ───

    _getLastAggregationTime: function() {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'global');
        gr.addQuery('name', 'last_aggregation');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var val = gr.getValue('config_value');
            if (val) {
                return new GlideDateTime(val);
            }
        }
        return null;
    },

    _updateLastAggregationTime: function() {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'global');
        gr.addQuery('name', 'last_aggregation');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            gr.setValue('config_value', gs.nowDateTime());
            gr.update();
        } else {
            var grNew = new GlideRecord(this.TABLE_CONFIG);
            grNew.initialize();
            grNew.setValue('config_type', 'global');
            grNew.setValue('name', 'last_aggregation');
            grNew.setValue('config_value', gs.nowDateTime());
            grNew.setValue('description', 'Last metrics aggregation timestamp');
            grNew.insert();
        }
    },

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

    _getProductsForInstance: function(instanceId, since) {
        var products = {};
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('record_type', 'IN', 'usage,execution');
        if (since) {
            gr.addQuery('sync_timestamp', '>=', since);
        }
        gr.query();
        while (gr.next()) {
            var product = gr.getValue('product');
            if (product) products[product] = true;
        }
        return Object.keys(products);
    },

    _getCapabilitiesForProduct: function(instanceId, product, since) {
        var capabilities = {};
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('product', product);
        gr.addQuery('record_type', 'IN', 'usage,execution');
        if (since) {
            gr.addQuery('sync_timestamp', '>=', since);
        }
        gr.query();
        while (gr.next()) {
            var cap = gr.getValue('capability');
            if (cap) capabilities[cap] = true;
        }
        return Object.keys(capabilities);
    },

    _getInstanceTotalUsers: function() {
        // Attempt to get total user count from sys_user (requires cross-scope)
        try {
            var gr = new GlideRecord('sys_user');
            gr.addActiveQuery();
            return gr.query().getRowCount();
        } catch (e) {
            // Cross-scope not configured — return 0 so adoption_rate = 0
            return 0;
        }
    },

    _getPeriodStart: function() {
        var dt = new GlideDateTime();
        dt.addDaysUTC(-1); // Last 24 hours by default
        return dt;
    },

    type: 'TowerAnalytics'
};