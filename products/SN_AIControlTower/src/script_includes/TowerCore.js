// Copyright (c) 2026 Vladimir Kapustin. Licensed under AGPL-3.0.
// AIControlTower — TowerCore Script Include
// Ingestion engine + connector registry for multi-instance AI telemetry

var TowerCore = Class.create();
TowerCore.prototype = {
    initialize: function() {
        this.TABLE_RECORD = 'x_snc_ai_tower_record';
        this.TABLE_CONFIG = 'x_snc_ai_tower_config';
        this.TABLE_INSTANCE = 'x_snc_ai_tower_config';
        this.errors = [];
        this.accepted = 0;
        this.rejected = 0;
    },

    /**
     * Main ingestion entry point — called by REST POST /execute action=ingest
     * @param {Object} payload - { instance_token, sync_id, records: [] }
     * @return {Object} { accepted, rejected, errors }
     */
    ingest: function(payload) {
        this.errors = [];
        this.accepted = 0;
        this.rejected = 0;

        if (!payload || !payload.records || !Array.isArray(payload.records)) {
            return { accepted: 0, rejected: 0, errors: ['Invalid payload: missing records array'] };
        }

        var instanceId = this._validateInstanceToken(payload.instance_token);
        if (!instanceId) {
            return { accepted: 0, rejected: payload.records.length, errors: ['Invalid or missing instance token'] };
        }

        for (var i = 0; i < payload.records.length; i++) {
            try {
                var record = payload.records[i];
                if (this._validateRecord(record)) {
                    if (!this._isDuplicate(instanceId, record)) {
                        this._storeRecord(instanceId, record);
                        this.accepted++;
                    } else {
                        this.rejected++;
                    }
                } else {
                    this.rejected++;
                    this.errors.push('Invalid record at index ' + i);
                }
            } catch (e) {
                this.rejected++;
                this.errors.push('Error processing record ' + i + ': ' + e.message);
            }
        }

        this._updateInstanceSync(instanceId);
        return { accepted: this.accepted, rejected: this.rejected, errors: this.errors };
    },

    /**
     * Validate instance auth token against config table
     * @param {String} token - auth token from collector
     * @return {String} instance sys_id or null
     */
    _validateInstanceToken: function(token) {
        if (!token) return null;
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'instance');
        gr.addQuery('auth_token', token);
        gr.addQuery('active', 'true');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return null;
    },

    /**
     * Validate a telemetry record structure
     * @param {Object} record - normalized telemetry record
     * @return {Boolean}
     */
    _validateRecord: function(record) {
        if (!record) return false;
        if (!record.record_type) return false;
        var validTypes = ['usage', 'execution', 'metric'];
        if (validTypes.indexOf(record.record_type) < 0) return false;
        if (!record.product) return false;
        if (!record.source_id) return false;
        return true;
    },

    /**
     * Check for duplicate record (instance + source_id composite key)
     * @param {String} instanceId - sys_id of instance config
     * @param {Object} record - telemetry record
     * @return {Boolean} true if duplicate
     */
    _isDuplicate: function(instanceId, record) {
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.addQuery('instance', instanceId);
        gr.addQuery('source_id', record.source_id);
        gr.setLimit(1);
        gr.query();
        return gr.next();
    },

    /**
     * Store a telemetry record in the polymorphic record table
     * @param {String} instanceId - instance sys_id
     * @param {Object} record - normalized telemetry record
     */
    _storeRecord: function(instanceId, record) {
        var gr = new GlideRecord(this.TABLE_RECORD);
        gr.initialize();
        gr.setValue('instance', instanceId);
        gr.setValue('record_type', record.record_type);
        gr.setValue('product', record.product);
        gr.setValue('capability', record.capability || '');
        gr.setValue('user_sysid', record.user_sysid || '');
        gr.setValue('user_name', record.user_name || '');
        gr.setValue('department', record.department || '');
        gr.setValue('source_id', record.source_id);
        gr.setValue('outcome', record.outcome || '');
        gr.setValue('duration_ms', record.duration_ms || 0);
        gr.setValue('request_count', record.request_count || 1);
        gr.setValue('success_count', record.success_count || 0);
        gr.setValue('failure_count', record.failure_count || 0);
        gr.setValue('metadata', JSON.stringify(record.metadata || {}));
        if (record.timestamp) {
            gr.setValue('source_timestamp', record.timestamp);
        }
        if (record.steps) {
            gr.setValue('steps', JSON.stringify(record.steps));
        }
        if (record.tools_used) {
            gr.setValue('tools_used', JSON.stringify(record.tools_used));
        }
        if (record.intervention_required !== undefined) {
            gr.setValue('intervention_required', record.intervention_required ? 'true' : 'false');
        }
        gr.setValue('sync_timestamp', new GlideDateTime());
        gr.insert();
    },

    /**
     * Update last_sync timestamp on instance config
     * @param {String} instanceId - instance sys_id
     */
    _updateInstanceSync: function(instanceId) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        if (gr.get(instanceId)) {
            gr.setValue('last_sync', new GlideDateTime());
            gr.update();
        }
    },

    // ─── Connector Registry ───

    /**
     * Get connector configuration for a product
     * @param {String} productName - e.g. 'Now Assist', 'Build Agent'
     * @return {Object} connector config or null
     */
    getConnector: function(productName) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'connector');
        gr.addQuery('product_name', productName);
        gr.addQuery('active', 'true');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            var mappings = {};
            try {
                mappings = JSON.parse(gr.getValue('field_mappings') || '{}');
            } catch (e) {
                mappings = {};
            }
            return {
                sys_id: gr.getUniqueValue(),
                product_name: gr.getValue('product_name'),
                source_tables: gr.getValue('source_tables') || '',
                field_mappings: mappings,
                version: gr.getValue('version') || '1.0',
                active: true
            };
        }
        return null;
    },

    /**
     * Register a new data connector
     * @param {Object} config - { product_name, source_tables, field_mappings, version }
     * @return {String} sys_id of connector config
     */
    registerConnector: function(config) {
        if (!config || !config.product_name) {
            return null;
        }
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.initialize();
        gr.setValue('config_type', 'connector');
        gr.setValue('product_name', config.product_name);
        gr.setValue('source_tables', config.source_tables || '');
        gr.setValue('field_mappings', JSON.stringify(config.field_mappings || {}));
        gr.setValue('version', config.version || '1.0');
        gr.setValue('active', 'true');
        gr.setValue('description', 'Connector for ' + config.product_name);
        return gr.insert();
    },

    /**
     * Apply field mapping from connector to raw data
     * @param {Object} rawData - raw record from source table
     * @param {Object} connector - connector config with field_mappings
     * @return {Object} normalized record
     */
    applyMapping: function(rawData, connector) {
        if (!rawData || !connector || !connector.field_mappings) {
            return rawData;
        }
        var mapped = {};
        var mappings = connector.field_mappings;
        for (var targetField in mappings) {
            if (mappings.hasOwnProperty(targetField)) {
                var sourceField = mappings[targetField];
                mapped[targetField] = rawData[sourceField] || '';
            }
        }
        mapped.product = connector.product_name;
        return mapped;
    },

    /**
     * Get all active connectors
     * @return {Array} list of connector configs
     */
    getActiveConnectors: function() {
        var connectors = [];
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'connector');
        gr.addQuery('active', 'true');
        gr.query();
        while (gr.next()) {
            var mappings = {};
            try {
                mappings = JSON.parse(gr.getValue('field_mappings') || '{}');
            } catch (e) {
                mappings = {};
            }
            connectors.push({
                sys_id: gr.getUniqueValue(),
                product_name: gr.getValue('product_name'),
                source_tables: gr.getValue('source_tables') || '',
                field_mappings: mappings,
                version: gr.getValue('version') || '1.0'
            });
        }
        return connectors;
    },

    /**
     * Get instance status — used by GET /status endpoint
     * @param {String} instanceId - instance sys_id
     * @return {Object} status info
     */
    getInstanceStatus: function(instanceId) {
        var result = {
            instance_id: instanceId,
            last_sync: null,
            record_count: 0,
            pending_alerts: 0
        };
        var gr = new GlideRecord(this.TABLE_CONFIG);
        if (gr.get(instanceId)) {
            result.last_sync = gr.getValue('last_sync') || null;
            result.instance_name = gr.getValue('name') || '';
        }
        var recGr = new GlideRecord(this.TABLE_RECORD);
        recGr.addQuery('instance', instanceId);
        result.record_count = recGr.query().getRowCount();
        var alertGr = new GlideRecord('x_snc_ai_tower_alert');
        alertGr.addQuery('instance', instanceId);
        alertGr.addQuery('status', 'new');
        result.pending_alerts = alertGr.query().getRowCount();
        return result;
    },

    /**
     * Get all registered instances
     * @return {Array} list of instances
     */
    getInstances: function() {
        var instances = [];
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('config_type', 'instance');
        gr.addQuery('active', 'true');
        gr.query();
        while (gr.next()) {
            instances.push({
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name') || '',
                url: gr.getValue('url') || '',
                instance_type: gr.getValue('instance_type') || 'prod',
                region: gr.getValue('region') || '',
                last_sync: gr.getValue('last_sync') || '',
                sync_frequency: gr.getValue('sync_frequency') || '15'
            });
        }
        return instances;
    },

    type: 'TowerCore'
};