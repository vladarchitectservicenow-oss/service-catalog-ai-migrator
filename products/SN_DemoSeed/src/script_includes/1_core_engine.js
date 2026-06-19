// DemoSeed — DemoSeedCore Script Include
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine: Dashboard Scanner, Data Generator, Distribution Profiles, Data Wiper
// Consolidated from 4 design SIs into 1 (max 2 SI constraint)
// @class DemoSeedCore @namespace x_demoseed

var DemoSeedCore = Class.create();
DemoSeedCore.prototype = {
    initialize: function() {
        this.batchId = '';
        this.errors = [];
        this.auditTable = 'x_demoseed_audit';
        this.configTable = 'x_demoseed_config';
    },

    // ─── DASHBOARD SCANNER ────────────────────────────────────────────

    /**
     * Scan all PA dashboards and build a data requirement manifest.
     * @param {Array} dashboardSysIds - Optional filter: specific dashboard sys_ids
     * @returns {Object} Manifest with dashboards, indicators, breakdowns, source tables
     */
    scanDashboards: function(dashboardSysIds) {
        var manifest = { dashboards: [], indicators: {}, source_tables: {} };
        var dashGr = new GlideRecord('sys_pa_dashboards');
        dashGr.addActiveQuery();
        if (dashboardSysIds && dashboardSysIds.length > 0) {
            dashGr.addQuery('sys_id', 'IN', dashboardSysIds.join(','));
        }
        dashGr.query();

        while (dashGr.next()) {
            var dashEntry = {
                sys_id: dashGr.getUniqueValue(),
                name: dashGr.getValue('name') || '',
                title: dashGr.getValue('title') || '',
                indicators: []
            };

            var indGr = new GlideRecord('pa_indicators');
            indGr.addQuery('dashboard', dashGr.getUniqueValue());
            indGr.addActiveQuery();
            indGr.query();

            while (indGr.next()) {
                var indSysId = indGr.getUniqueValue();
                var indName = indGr.getValue('name') || '';
                var indType = indGr.getValue('type') || 'count';
                dashEntry.indicators.push(indSysId);

                if (!manifest.indicators[indSysId]) {
                    manifest.indicators[indSysId] = {
                        sys_id: indSysId,
                        name: indName,
                        type: indType,
                        breakdowns: [],
                        source_tables: []
                    };
                }

                // Get breakdowns for this indicator
                var bdGr = new GlideRecord('pa_breakdowns');
                bdGr.addQuery('indicator', indSysId);
                bdGr.addActiveQuery();
                bdGr.query();
                while (bdGr.next()) {
                    manifest.indicators[indSysId].breakdowns.push({
                        sys_id: bdGr.getUniqueValue(),
                        name: bdGr.getValue('name') || '',
                        element: bdGr.getValue('element') || '',
                        source_table: bdGr.getValue('source_table') || ''
                    });
                }

                // Get indicator sources (source tables)
                var srcGr = new GlideRecord('pa_indicator_sources');
                srcGr.addQuery('indicator', indSysId);
                srcGr.query();
                while (srcGr.next()) {
                    var srcTable = srcGr.getValue('table') || '';
                    if (srcTable && manifest.indicators[indSysId].source_tables.indexOf(srcTable) === -1) {
                        manifest.indicators[indSysId].source_tables.push(srcTable);
                    }
                    if (srcTable && !manifest.source_tables[srcTable]) {
                        manifest.source_tables[srcTable] = { indicators: [] };
                    }
                    if (srcTable) {
                        manifest.source_tables[srcTable].indicators.push(indSysId);
                    }
                }
            }

            manifest.dashboards.push(dashEntry);
        }

        return manifest;
    },

    /**
     * Get source tables for a specific indicator.
     * @param {string} indicatorSysId
     * @returns {Array} Array of table names
     */
    getIndicatorSources: function(indicatorSysId) {
        var tables = [];
        var srcGr = new GlideRecord('pa_indicator_sources');
        srcGr.addQuery('indicator', indicatorSysId);
        srcGr.query();
        while (srcGr.next()) {
            var t = srcGr.getValue('table') || '';
            if (t && tables.indexOf(t) === -1) {
                tables.push(t);
            }
        }
        return tables;
    },

    /**
     * Build a full data requirement manifest for given dashboards.
     * @param {Array} dashboardSysIds
     * @returns {Object} Manifest
     */
    buildManifest: function(dashboardSysIds) {
        return this.scanDashboards(dashboardSysIds);
    },

    // ─── DATA GENERATOR ENGINE ────────────────────────────────────────

    /**
     * Main generation entry point. Creates a batch, generates data for all tables
     * in the profile, records audit trail.
     * @param {string} profileId - sys_id of the config profile
     * @param {number} volume - records per table (default from profile or 500)
     * @param {number} dateRangeDays - date range in days (default from profile or 90)
     * @returns {Object} { batchId, totalRecords, tablesProcessed, errors }
     */
    generate: function(profileId, volume, dateRangeDays) {
        // Production guard
        if (this._isProduction() && gs.getProperty('x_demoseed.override_prod', 'false') !== 'true') {
            return { error: 'DemoSeed cannot run on production instances. Set x_demoseed.override_prod=true to override.' };
        }

        // Load profile
        var profileGr = new GlideRecord(this.configTable);
        if (!profileGr.get(profileId)) {
            return { error: 'Profile not found: ' + profileId };
        }

        var profileType = profileGr.getValue('profile_type') || 'Custom';
        var targetTablesJson = profileGr.getValue('target_tables') || '[]';
        var targetTables = [];
        try { targetTables = JSON.parse(targetTablesJson); } catch(e) { /* use defaults */ }

        if (targetTables.length === 0) {
            // Default tables per profile type
            targetTables = this._getDefaultTables(profileType);
        }

        volume = volume || parseInt(profileGr.getValue('volume'), 10) || 500;
        dateRangeDays = dateRangeDays || parseInt(profileGr.getValue('date_range_days'), 10) || 90;

        // Create batch header
        this.batchId = gs.generateGUID();
        var batchGr = new GlideRecord(this.auditTable);
        batchGr.initialize();
        batchGr.setValue('batch_id', this.batchId);
        batchGr.setValue('status', 'running');
        batchGr.setValue('profile_id', profileId);
        batchGr.setValue('total_records', 0);
        batchGr.setValue('tables_processed', '[]');
        batchGr.setValue('started_on', new GlideDateTime().getValue());
        batchGr.setValue('is_batch_header', 'true');
        try {
            batchGr.insert();
        } catch (e) {
            return { error: 'Failed to create batch: ' + e.message };
        }

        this.errors = [];
        var totalRecords = 0;
        var tablesDone = [];
        var endDate = new GlideDateTime();
        var startDate = new GlideDateTime();
        startDate.addSeconds(-dateRangeDays * 86400);

        // Generate for each target table
        for (var t = 0; t < targetTables.length; t++) {
            var tableName = targetTables[t];
            try {
                var count = this.generateForTable(tableName, volume, startDate, endDate);
                totalRecords += count;
                tablesDone.push(tableName);
                gs.info('[DemoSeed] Generated ' + count + ' records in ' + tableName);
            } catch (tableErr) {
                this.errors.push('Table ' + tableName + ': ' + tableErr.message);
                gs.error('[DemoSeed] ' + tableErr.message);
            }
        }

        // Update batch header
        batchGr.setValue('status', this.errors.length > 0 ? 'failed' : 'complete');
        batchGr.setValue('total_records', totalRecords);
        batchGr.setValue('tables_processed', JSON.stringify(tablesDone));
        batchGr.setValue('completed_on', new GlideDateTime().getValue());
        if (this.errors.length > 0) {
            batchGr.setValue('error_log', JSON.stringify(this.errors));
        }
        try {
            batchGr.update();
        } catch (e) {
            gs.error('[DemoSeed] Failed to update batch: ' + e.message);
        }

        return {
            batch_id: this.batchId,
            total_records: totalRecords,
            tables_processed: tablesDone,
            errors: this.errors
        };
    },

    /**
     * Generate records for a single table.
     * @param {string} tableName - target table name
     * @param {number} volume - number of records
     * @param {GlideDateTime} startDate
     * @param {GlideDateTime} endDate
     * @returns {number} Records created
     */
    generateForTable: function(tableName, volume, startDate, endDate) {
        var count = 0;
        var fieldMappings = this._getFieldMappings(tableName);

        for (var i = 0; i < volume; i++) {
            try {
                var gr = new GlideRecord(tableName);
                gr.initialize();

                // Set mandatory fields based on table type
                if (tableName === 'incident') {
                    this._populateIncident(gr, startDate, endDate);
                } else if (tableName === 'change_request') {
                    this._populateChangeRequest(gr, startDate, endDate);
                } else if (tableName === 'sc_request' || tableName === 'sc_req_item') {
                    this._populateCatalogItem(gr, tableName, startDate, endDate);
                } else if (tableName === 'change_task') {
                    this._populateChangeTask(gr, startDate, endDate);
                } else {
                    this._populateCustomRecord(gr, tableName, fieldMappings, startDate, endDate);
                }

                var sysId = gr.insert();
                if (sysId) {
                    this._auditRecord(this.batchId, tableName, sysId);
                    count++;
                }
            } catch (e) {
                gs.debug('[DemoSeed] Failed to insert record ' + i + ' in ' + tableName + ': ' + e.message);
            }
        }

        return count;
    },

    // ─── DISTRIBUTION PROFILES ────────────────────────────────────────

    /**
     * Weighted random priority for incidents.
     * P1: 5%, P2: 15%, P3: 50%, P4: 30%
     */
    _getPriority: function() {
        var r = Math.random() * 100;
        if (r < 5) return '1';
        if (r < 20) return '2';
        if (r < 70) return '3';
        return '4';
    },

    /**
     * Weighted random category for incidents.
     */
    _getCategory: function() {
        var r = Math.random() * 100;
        if (r < 25) return 'hardware';
        if (r < 45) return 'software';
        if (r < 60) return 'network';
        if (r < 75) return 'access';
        return 'other';
    },

    /**
     * Random assignment group from sys_user_group.
     */
    _getAssignmentGroup: function() {
        var gr = new GlideRecord('sys_user_group');
        gr.addActiveQuery();
        // Use random offset to get different groups on each call
        var countGr = new GlideRecord('sys_user_group');
        countGr.addActiveQuery();
        var total = countGr.getRowCount();
        if (total === 0) return '';
        var offset = Math.floor(Math.random() * Math.min(total, 100));
        gr.chooseWindow(offset, Math.min(offset + 19, total - 1));
        gr.setLimit(20);
        gr.query();
        var groups = [];
        while (gr.next()) {
            groups.push(gr.getUniqueValue());
        }
        if (groups.length === 0) return '';
        return groups[Math.floor(Math.random() * groups.length)];
    },

    /**
     * Weighted resolution code.
     */
    _getResolutionCode: function() {
        var r = Math.random() * 100;
        if (r < 60) return 'fixed';
        if (r < 85) return 'workaround';
        return 'closed_by_caller';
    },

    /**
     * Weighted change request state.
     */
    _getChangeState: function() {
        var r = Math.random() * 100;
        if (r < 10) return 'draft';
        if (r < 20) return 'assess';
        if (r < 35) return 'authorize';
        if (r < 55) return 'implement';
        if (r < 70) return 'review';
        return 'closed';
    },

    /**
     * Weighted risk level for change requests.
     */
    _getRiskLevel: function() {
        var r = Math.random() * 100;
        if (r < 60) return 'low';
        if (r < 90) return 'moderate';
        if (r < 98) return 'high';
        return 'critical';
    },

    /**
     * Generate a random date within range with weekday weighting.
     * More records on weekdays, fewer on weekends.
     */
    _getRandomDate: function(startDate, endDate) {
        var startMs = startDate.getNumericValue();
        var endMs = endDate.getNumericValue();
        var range = endMs - startMs;

        // Try up to 10 times to get a weekday (Mon-Fri)
        for (var attempt = 0; attempt < 10; attempt++) {
            var offset = Math.floor(Math.random() * range);
            var candidate = new GlideDateTime();
            candidate.setValue(startMs + offset);
            var dayOfWeek = candidate.getDayOfWeekUTC();
            // 1=Sun, 2=Mon, ..., 7=Sat
            if (dayOfWeek >= 2 && dayOfWeek <= 6) {
                return candidate;
            }
        }
        // Fallback: any random date
        var fallback = new GlideDateTime();
        fallback.setValue(startMs + Math.floor(Math.random() * range));
        return fallback;
    },

    /**
     * Get a random choice value from a choice list.
     */
    _getRandomChoice: function(tableName, fieldName) {
        var choices = [];
        var chGr = new GlideRecord('sys_choice');
        chGr.addQuery('name', tableName);
        chGr.addQuery('element', fieldName);
        chGr.addQuery('inactive', false);
        chGr.query();
        while (chGr.next()) {
            choices.push(chGr.getValue('value'));
        }
        if (choices.length === 0) return '';
        return choices[Math.floor(Math.random() * choices.length)];
    },

    /**
     * Get a random sys_id from a reference table.
     */
    _getRandomReference: function(tableName) {
        var gr = new GlideRecord(tableName);
        gr.setLimit(1);
        // Use random offset for better distribution instead of always oldest record
        var countGr = new GlideRecord(tableName);
        countGr.addActiveQuery();
        var total = countGr.getRowCount();
        if (total === 0) {
            // Fallback: no active records, try without filter
            gr.orderByDesc('sys_created_on');
            gr.query();
            if (gr.next()) {
                return gr.getUniqueValue();
            }
            return '';
        }
        var offset = Math.floor(Math.random() * total);
        if (offset > 0) {
            gr.chooseWindow(offset, offset);
        }
        gr.query();
        if (gr.next()) {
            return gr.getUniqueValue();
        }
        return '';
    },

    // ─── TABLE-SPECIFIC POPULATORS ────────────────────────────────────

    _populateIncident: function(gr, startDate, endDate) {
        var openedAt = this._getRandomDate(startDate, endDate);
        gr.setValue('short_description', this._getIncidentTitle());
        gr.setValue('description', this._getIncidentDescription());
        gr.setValue('priority', this._getPriority());
        gr.setValue('category', this._getCategory());
        gr.setValue('assignment_group', this._getAssignmentGroup());
        gr.setValue('opened_at', openedAt.getValue());

        // Resolution for ~70% of incidents
        if (Math.random() < 0.7) {
            var priority = gr.getValue('priority');
            var resolveHours = priority === '1' ? 4 : (priority === '2' ? 24 : (priority === '3' ? 72 : 120));
            var resolvedAt = new GlideDateTime(openedAt.getValue());
            resolvedAt.addSeconds(resolveHours * 3600 + Math.floor(Math.random() * resolveHours * 1800));
            gr.setValue('resolved_at', resolvedAt.getValue());
            gr.setValue('close_code', this._getResolutionCode());
            gr.setValue('state', '7'); // Closed
        } else {
            gr.setValue('state', Math.random() < 0.5 ? '1' : '2'); // New or In Progress
        }

        gr.setValue('caller_id', this._getRandomReference('sys_user'));
        gr.setValue('impact', Math.random() < 0.3 ? '1' : (Math.random() < 0.6 ? '2' : '3'));
        gr.setValue('urgency', Math.random() < 0.3 ? '1' : (Math.random() < 0.6 ? '2' : '3'));
    },

    _populateChangeRequest: function(gr, startDate, endDate) {
        var start = this._getRandomDate(startDate, endDate);
        gr.setValue('short_description', this._getChangeTitle());
        gr.setValue('description', this._getChangeDescription());
        gr.setValue('type', Math.random() < 0.7 ? 'normal' : (Math.random() < 0.9 ? 'standard' : 'emergency'));
        gr.setValue('risk', this._getRiskLevel());
        gr.setValue('state', this._getChangeState());
        gr.setValue('start_date', start.getValue());

        var endDt = new GlideDateTime(start.getValue());
        endDt.addSeconds(Math.floor(Math.random() * 14 * 86400) + 86400);
        gr.setValue('end_date', endDt.getValue());

        gr.setValue('requested_by', this._getRandomReference('sys_user'));
        gr.setValue('assignment_group', this._getAssignmentGroup());
        gr.setValue('category', this._getRandomChoice('change_request', 'category'));
    },

    _populateCatalogItem: function(gr, tableName, startDate, endDate) {
        var openedAt = this._getRandomDate(startDate, endDate);
        gr.setValue('short_description', this._getCatalogTitle());
        gr.setValue('requested_for', this._getRandomReference('sys_user'));
        gr.setValue('opened_at', openedAt.getValue());

        if (tableName === 'sc_request') {
            gr.setValue('request_state', this._getRandomChoice('sc_request', 'request_state'));
            gr.setValue('priority', this._getPriority());
        } else if (tableName === 'sc_req_item') {
            gr.setValue('stage', this._getRandomChoice('sc_req_item', 'stage'));
            gr.setValue('quantity', String(Math.floor(Math.random() * 5) + 1));
            // Random catalog item
            var catGr = new GlideRecord('sc_cat_item');
            catGr.addActiveQuery();
            catGr.setLimit(1);
            catGr.orderByDesc('sys_created_on');
            catGr.query();
            if (catGr.next()) {
                gr.setValue('cat_item', catGr.getUniqueValue());
            }
        }
    },

    _populateChangeTask: function(gr, startDate, endDate) {
        gr.setValue('short_description', this._getChangeTaskTitle());
        gr.setValue('state', this._getRandomChoice('change_task', 'state'));
        gr.setValue('assignment_group', this._getAssignmentGroup());
        var planned = this._getRandomDate(startDate, endDate);
        gr.setValue('planned_start_date', planned.getValue());
    },

    _populateCustomRecord: function(gr, tableName, fieldMappings, startDate, endDate) {
        for (var f = 0; f < fieldMappings.length; f++) {
            var mapping = fieldMappings[f];
            var value = this._generateFieldValue(mapping, startDate, endDate);
            if (value !== null && value !== undefined) {
                gr.setValue(mapping.field_name, value);
            }
        }
    },

    /**
     * Generate a field value based on generation type.
     */
    _generateFieldValue: function(mapping, startDate, endDate) {
        var genType = mapping.generation_type;
        var tableName = mapping.table_name;
        var fieldName = mapping.field_name;
        var weightJson = mapping.weight_json;

        switch (genType) {
            case 'choice':
                if (weightJson) {
                    try {
                        var weights = JSON.parse(weightJson);
                        return this._weightedPick(weights);
                    } catch(e) { /* fall through */ }
                }
                return this._getRandomChoice(tableName, fieldName);

            case 'reference':
                return this._getRandomReference(tableName);

            case 'date':
                return this._getRandomDate(startDate, endDate).getValue();

            case 'numeric':
                if (weightJson) {
                    try {
                        var range = JSON.parse(weightJson);
                        var min = range.min || 0;
                        var max = range.max || 100;
                        return String(Math.floor(Math.random() * (max - min + 1)) + min);
                    } catch(e) { /* fall through */ }
                }
                return String(Math.floor(Math.random() * 100));

            case 'boolean':
                return Math.random() < 0.5 ? 'true' : 'false';

            case 'string':
                return this._getTemplateString(fieldName);

            default:
                return '';
        }
    },

    _weightedPick: function(weights) {
        var total = 0;
        var keys = Object.keys(weights);
        for (var k = 0; k < keys.length; k++) {
            total += weights[keys[k]];
        }
        var r = Math.random() * total;
        var cumulative = 0;
        for (var j = 0; j < keys.length; j++) {
            cumulative += weights[keys[j]];
            if (r <= cumulative) return keys[j];
        }
        return keys[keys.length - 1];
    },

    // ─── TITLE/DESCRIPTION TEMPLATES ──────────────────────────────────

    _getIncidentTitle: function() {
        var titles = [
            'Email server CPU spike — Exchange 2019 DAG node unresponsive',
            'VPN connection timeout for remote users in APAC region',
            'SAP payroll batch job failed with exit code 137',
            'Printer queue stuck on 3rd floor — all jobs pending',
            'WiFi outage in Building B — AP cluster down',
            'Database replication lag on secondary node — 45 min behind',
            'SSL certificate expired on customer portal — users seeing warnings',
            'Citrix session freeze affecting 12 users in finance department',
            'Jira integration broken — tickets not syncing to ServiceNow',
            'Disk space critical on /var/log partition — 98% full',
            'LDAP authentication timeout — users unable to login',
            'Backup job failed — tape library error on slot 7',
            'VoIP call quality degraded — packet loss above 15%',
            'SharePoint document library inaccessible for marketing team',
            'Firewall rule change blocked outbound API calls to vendor'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    },

    _getIncidentDescription: function() {
        var descs = [
            'Multiple users reported the issue starting at approximately 08:30 UTC. Initial diagnostics show elevated CPU usage on the primary node. Secondary node is operational but showing replication lag. Engineering team has been notified.',
            'Issue detected by monitoring system at 14:15. Affected services include VPN concentrator and remote desktop gateway. Approximately 45 users in Singapore, Tokyo, and Sydney offices are impacted.',
            'The scheduled batch job failed during the nightly run. Error logs indicate memory allocation failure during the payroll calculation step. This is the second failure this week.',
            'Users on 3rd floor reported all print jobs stuck in queue since 09:00. Print server shows all jobs as "processing" but nothing prints. Restarted spooler service — no effect.',
            'Network monitoring detected AP cluster failure at 11:30. All 6 access points in Building B are offline. Wired connections are unaffected. Estimated 200 users impacted.'
        ];
        return descs[Math.floor(Math.random() * descs.length)];
    },

    _getChangeTitle: function() {
        var titles = [
            'Upgrade load balancer firmware to v4.2.1 — production cluster',
            'Migrate customer database from MySQL 5.7 to 8.0',
            'Deploy new SSL certificates across all customer-facing endpoints',
            'Add 16GB RAM to application servers in DMZ',
            'Patch Apache Struts vulnerability CVE-2026-1234 on web tier',
            'Enable MFA for all admin accounts on production VPN',
            'Replace failed disk in SAN array — slot 14, enclosure 2',
            'Configure new monitoring alerts for payment gateway latency',
            'Decommission legacy Exchange 2013 server — migrate to O365',
            'Update firewall rules for new vendor API integration'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    },

    _getChangeDescription: function() {
        var descs = [
            'Scheduled maintenance window: Saturday 02:00-06:00 UTC. Rollback plan: revert to current firmware version via backup configuration. Impact: 5-minute service interruption during failover test.',
            'Migration will be performed during Sunday maintenance window. Pre-migration backup completed and verified. Rollback plan: restore from backup if compatibility issues detected.',
            'Standard certificate renewal cycle. New certificates issued by DigiCert, valid for 1 year. Deployment via automated Ansible playbook. No service interruption expected.',
            'Hardware upgrade to address performance degradation during peak hours (09:00-11:00 UTC). Memory utilization currently at 92%. Vendor engineer on-site for installation.'
        ];
        return descs[Math.floor(Math.random() * descs.length)];
    },

    _getCatalogTitle: function() {
        var titles = [
            'New employee onboarding — laptop, accounts, badge',
            'Software license request — Adobe Creative Cloud for design team',
            'VPN access request for contractor — 3 month engagement',
            'Conference room AV setup for quarterly board meeting',
            'Mobile device replacement — damaged iPhone, insurance claim',
            'Access badge replacement — lost badge, building 3',
            'Expense report submission — Q2 travel to Singapore office',
            'Facilities request — standing desk for employee with back issues',
            'Training enrollment — ITIL 4 Foundation certification course',
            'Guest WiFi access for visiting client team — 5 people, 2 days'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    },

    _getChangeTaskTitle: function() {
        var titles = [
            'Pre-deployment smoke test on staging environment',
            'Update runbook documentation with new rollback procedure',
            'Notify stakeholders of maintenance window schedule',
            'Verify backup integrity before production change',
            'Configure monitoring suppression during change window',
            'Post-deployment validation — check all service endpoints',
            'Update CMDB with new server specifications',
            'Send change completion notification to CAB members'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    },

    _getTemplateString: function(fieldName) {
        var templates = {
            'name': 'Demo_' + Math.floor(Math.random() * 10000),
            'title': 'Generated Record ' + Math.floor(Math.random() * 10000),
            'comments': 'Auto-generated by DemoSeed for demo purposes'
        };
        return templates[fieldName] || 'DemoSeed_' + Math.floor(Math.random() * 10000);
    },

    // ─── AUDIT TRAIL ──────────────────────────────────────────────────

    _auditRecord: function(batchId, tableName, sysId) {
        try {
            var auditGr = new GlideRecord(this.auditTable);
            auditGr.initialize();
            auditGr.setValue('batch_id', batchId);
            auditGr.setValue('target_table', tableName);
            auditGr.setValue('record_sys_id', sysId);
            auditGr.setValue('wiped', 'false');
            auditGr.setValue('is_batch_header', 'false');
            auditGr.insert();
        } catch (e) {
            gs.debug('[DemoSeed] Audit record failed: ' + e.message);
        }
    },

    // ─── DATA WIPER ───────────────────────────────────────────────────

    /**
     * Wipe all records from a specific generation batch.
     * @param {string} batchId
     * @returns {Object} { wiped_count, errors }
     */
    wipeBatch: function(batchId) {
        var wiped = 0;
        var errors = [];

        var auditGr = new GlideRecord(this.auditTable);
        auditGr.addQuery('batch_id', batchId);
        auditGr.addQuery('is_batch_header', 'false');
        auditGr.addQuery('wiped', 'false');
        auditGr.query();

        while (auditGr.next()) {
            var tableName = auditGr.getValue('target_table');
            var recordSysId = auditGr.getValue('record_sys_id');

            try {
                var targetGr = new GlideRecord(tableName);
                if (targetGr.get(recordSysId)) {
                    targetGr.deleteRecord();
                    auditGr.setValue('wiped', 'true');
                    try {
                        auditGr.update();
                    } catch (updErr) {
                        errors.push('Failed to mark audit entry as wiped: ' + updErr.message);
                    }
                    wiped++;
                }
            } catch (e) {
                errors.push('Failed to wipe ' + tableName + '/' + recordSysId + ': ' + e.message);
            }
        }

        // Update batch header status
        var batchGr = new GlideRecord(this.auditTable);
        batchGr.addQuery('batch_id', batchId);
        batchGr.addQuery('is_batch_header', 'true');
        batchGr.query();
        if (batchGr.next()) {
            batchGr.setValue('status', 'wiped');
            try {
                batchGr.update();
            } catch (e) {
                gs.error('[DemoSeed] Failed to update batch header status: ' + e.message);
            }
        }

        return { wiped_count: wiped, errors: errors };
    },

    /**
     * Wipe all DemoSeed records created within a date range.
     * @param {string} startDate - GlideDateTime string
     * @param {string} endDate - GlideDateTime string
     * @returns {Object} { wiped_count, errors }
     */
    wipeByDateRange: function(startDate, endDate) {
        var wiped = 0;
        var errors = [];

        var auditGr = new GlideRecord(this.auditTable);
        auditGr.addQuery('is_batch_header', 'false');
        auditGr.addQuery('wiped', 'false');
        auditGr.addQuery('sys_created_on', '>=', startDate);
        auditGr.addQuery('sys_created_on', '<=', endDate);
        auditGr.query();

        while (auditGr.next()) {
            var tableName = auditGr.getValue('target_table');
            var recordSysId = auditGr.getValue('record_sys_id');

            try {
                var targetGr = new GlideRecord(tableName);
                if (targetGr.get(recordSysId)) {
                    targetGr.deleteRecord();
                    auditGr.setValue('wiped', 'true');
                    try {
                        auditGr.update();
                    } catch (updErr) {
                        errors.push('Failed to mark audit entry as wiped: ' + updErr.message);
                    }
                    wiped++;
                }
            } catch (e) {
                errors.push('Failed to wipe ' + tableName + '/' + recordSysId + ': ' + e.message);
            }
        }

        return { wiped_count: wiped, errors: errors };
    },

    /**
     * Wipe ALL DemoSeed data across all batches.
     * @returns {Object} { wiped_count, errors }
     */
    wipeAll: function() {
        var wiped = 0;
        var errors = [];

        var auditGr = new GlideRecord(this.auditTable);
        auditGr.addQuery('is_batch_header', 'false');
        auditGr.addQuery('wiped', 'false');
        auditGr.query();

        while (auditGr.next()) {
            var tableName = auditGr.getValue('target_table');
            var recordSysId = auditGr.getValue('record_sys_id');

            try {
                var targetGr = new GlideRecord(tableName);
                if (targetGr.get(recordSysId)) {
                    targetGr.deleteRecord();
                    auditGr.setValue('wiped', 'true');
                    try {
                        auditGr.update();
                    } catch (updErr) {
                        errors.push('Failed to mark audit entry as wiped: ' + updErr.message);
                    }
                    wiped++;
                }
            } catch (e) {
                errors.push('Failed to wipe ' + tableName + '/' + recordSysId + ': ' + e.message);
            }
        }

        return { wiped_count: wiped, errors: errors };
    },

    /**
     * Get a preview of how many records would be wiped.
     * @param {string} batchId - optional, if omitted returns all
     * @returns {Object} { total_records, by_table: { tableName: count } }
     */
    getWipePreview: function(batchId) {
        var preview = { total_records: 0, by_table: {} };

        var auditGr = new GlideRecord(this.auditTable);
        auditGr.addQuery('is_batch_header', 'false');
        auditGr.addQuery('wiped', 'false');
        if (batchId) {
            auditGr.addQuery('batch_id', batchId);
        }
        auditGr.query();

        while (auditGr.next()) {
            var tableName = auditGr.getValue('target_table');
            preview.total_records++;
            if (!preview.by_table[tableName]) {
                preview.by_table[tableName] = 0;
            }
            preview.by_table[tableName]++;
        }

        return preview;
    },

    // ─── HELPERS ──────────────────────────────────────────────────────

    _isProduction: function() {
        return gs.getProperty('glide.installation.production', 'false') === 'true';
    },

    _getDefaultTables: function(profileType) {
        var defaults = {
            'ITSM': ['incident', 'change_request', 'change_task'],
            'CSM': ['incident', 'sc_request', 'sc_req_item'],
            'HR': ['sc_request', 'sc_req_item'],
            'SecOps': ['incident', 'change_request']
        };
        return defaults[profileType] || ['incident'];
    },

    _getFieldMappings: function(tableName) {
        var mappings = [];
        var mapGr = new GlideRecord(this.configTable);
        mapGr.addQuery('config_type', 'field_map');
        mapGr.addQuery('table_name', tableName);
        mapGr.addQuery('active', 'true');
        mapGr.query();
        while (mapGr.next()) {
            mappings.push({
                table_name: mapGr.getValue('table_name'),
                field_name: mapGr.getValue('field_name'),
                generation_type: mapGr.getValue('generation_type'),
                weight_json: mapGr.getValue('weight_json')
            });
        }
        return mappings;
    },

    type: 'DemoSeedCore'
};
