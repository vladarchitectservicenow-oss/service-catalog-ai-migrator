// SpokePulse — IntegrationHub Spoke & Connection Health Monitor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// SpokePulseScanner — read-only scan engine.
// Runs the four scanners (credential, alias, version, dead-action) against the
// IntegrationHub integration layer and writes per-item health rows plus a scan-run
// record. This class NEVER mutates any integration table (sys_connection,
// sys_connection_alias, sys_credentials, sys_hub_spoke, sys_hub_flow_action,
// sys_hub_step) — it is strictly read-only.
//
// @class SpokePulseScanner
// @namespace x_snc_spk
var SpokePulseScanner = Class.create();
SpokePulseScanner.prototype = {

    HEALTH_TABLE: 'x_snc_spk_health',
    RUN_TABLE: 'x_snc_spk_scan_run',

    // Risk bands (higher score = higher risk).
    RISK_HEALTHY: 'healthy',
    RISK_AT_RISK: 'at-risk',
    RISK_BROKEN: 'broken',

    initialize: function () {
        this._findings = [];
        this._scanRunId = '';
    },

    /**
     * Run a full scan (all four scanners) and persist results.
     * @param {string} trigger - 'scheduled' or 'manual'
     * @returns {string} sys_id of the created scan-run record
     */
    runScan: function (trigger) {
        var runId = this._startRun(trigger || 'manual');
        if (!runId) {
            return '';
        }
        this._scanRunId = runId;

        this._scanCredentials(runId);
        this._scanAliases(runId);
        this._scanSpokeVersions(runId);
        this._scanDeadActions(runId);

        this._finishRun(runId);
        return runId;
    },

    /**
     * Run a single scanner by name (used by the REST action-dispatch endpoint).
     * @param {string} scanner - 'credential' | 'alias' | 'version' | 'dead_action'
     * @param {string} trigger - 'scheduled' or 'manual'
     * @returns {string} sys_id of the created scan-run record
     */
    runScanner: function (scanner, trigger) {
        var validScanners = ['credential', 'alias', 'version', 'dead_action'];
        if (validScanners.indexOf(scanner) < 0) {
            gs.error('SpokePulse: unknown scanner "' + scanner + '".');
            return '';
        }

        var runId = this._startRun(trigger || 'manual');
        if (!runId) {
            return '';
        }
        this._scanRunId = runId;

        switch (scanner) {
            case 'credential':
                this._scanCredentials(runId);
                break;
            case 'alias':
                this._scanAliases(runId);
                break;
            case 'version':
                this._scanSpokeVersions(runId);
                break;
            case 'dead_action':
                this._scanDeadActions(runId);
                break;
        }

        this._finishRun(runId);
        return runId;
    },

    // ------------------------------------------------------------------
    // Scan-run lifecycle
    // ------------------------------------------------------------------

    _startRun: function (trigger) {
        var gr = new GlideRecord(this.RUN_TABLE);
        gr.initialize();
        gr.setValue('trigger', trigger);
        gr.setValue('started_at', new GlideDateTime().getValue());
        gr.setValue('items_scanned', 0);
        gr.setValue('findings_count', 0);
        gr.setValue('high_risk_count', 0);
        gr.setValue('status', 'running');
        var runId;
        try {
            runId = gr.insert();
        } catch (e) {
            gs.error('SpokePulse: failed to create scan-run record: ' + e.message);
            return '';
        }
        return runId;
    },

    _finishRun: function (runId) {
        var gr = new GlideRecord(this.RUN_TABLE);
        if (!gr.get(runId)) {
            return;
        }
        gr.setValue('completed_at', new GlideDateTime().getValue());
        gr.setValue('items_scanned', this._itemsScanned);
        gr.setValue('findings_count', this._findings.length);
        gr.setValue('high_risk_count', this._countHighRisk());
        gr.setValue('status', 'completed');
        gr.update();
    },

    _countHighRisk: function () {
        var count = 0;
        for (var i = 0; i < this._findings.length; i++) {
            if (this._findings[i].risk_level === this.RISK_BROKEN) {
                count++;
            }
        }
        return count;
    },

    // ------------------------------------------------------------------
    // Finding persistence
    // ------------------------------------------------------------------

    /**
     * Persist a single finding to the health table.
     * @param {object} finding - { item_type, item_sys_id, item_name, risk_level,
     *                            risk_score, detail, remediation }
     */
    _recordFinding: function (finding) {
        var gr = new GlideRecord(this.HEALTH_TABLE);
        gr.initialize();
        gr.setValue('item_type', finding.item_type);
        gr.setValue('item_sys_id', finding.item_sys_id);
        gr.setValue('item_name', finding.item_name);
        gr.setValue('risk_level', finding.risk_level);
        gr.setValue('risk_score', finding.risk_score);
        gr.setValue('finding', JSON.stringify({
            detail: finding.detail || '',
            remediation: finding.remediation || '',
            scanned_at: new GlideDateTime().getValue()
        }));
        gr.setValue('last_scanned', new GlideDateTime().getValue());
        gr.setValue('scan_run', this._scanRunId);
        try {
            gr.insert();
        } catch (e) {
            gs.error('SpokePulse: failed to record finding for "' + finding.item_name + '": ' + e.message);
            return;
        }

        this._findings.push({
            item_type: finding.item_type,
            item_sys_id: finding.item_sys_id,
            item_name: finding.item_name,
            risk_level: finding.risk_level,
            risk_score: finding.risk_score
        });
    },

    // ------------------------------------------------------------------
    // Scanner 1: Credential health
    // ------------------------------------------------------------------

    _scanCredentials: function (runId) {
        this._itemsScanned = this._itemsScanned || 0;
        var now = new GlideDateTime();
        var nowMs = now.getNumericValue();

        // Base credential table plus common credential-type children.
        var credTables = ['sys_credentials', 'oauth_credential', 'basic_auth_credential', 'api_key_credential'];
        for (var t = 0; t < credTables.length; t++) {
            var table = credTables[t];
            if (!GlideTableDescriptor.isValid(table)) {
                continue;
            }
            var gr = new GlideRecord(table);
            gr.setLimit(500);
            gr.query();
            while (gr.next()) {
                this._itemsScanned++;
                var name = gr.getValue('name') || gr.getValue('sys_id');
                var expiresOn = gr.getValue('expires_on') || gr.getValue('expires_at') || gr.getValue('valid_to');

                if (!expiresOn) {
                    // No expiry field — cannot assess expiry; skip silently.
                    continue;
                }

                var expMs = this._toMs(expiresOn);
                if (expMs <= 0) {
                    continue;
                }

                var daysLeft = Math.floor((expMs - nowMs) / 86400000);
                var riskLevel;
                var riskScore;
                var detail;
                var remediation;

                if (daysLeft < 0) {
                    riskLevel = this.RISK_BROKEN;
                    riskScore = 100;
                    detail = 'Credential "' + name + '" expired ' + Math.abs(daysLeft) + ' day(s) ago.';
                    remediation = 'Renew the credential immediately and re-validate the associated connection alias.';
                } else if (daysLeft <= 7) {
                    riskLevel = this.RISK_AT_RISK;
                    riskScore = 70;
                    detail = 'Credential "' + name + '" expires in ' + daysLeft + ' day(s).';
                    remediation = 'Renew the credential before expiry to avoid a mid-transaction failure.';
                } else if (daysLeft <= 30) {
                    riskLevel = this.RISK_AT_RISK;
                    riskScore = 40;
                    detail = 'Credential "' + name + '" expires in ' + daysLeft + ' day(s).';
                    remediation = 'Schedule renewal within the next 30 days.';
                } else {
                    riskLevel = this.RISK_HEALTHY;
                    riskScore = 5;
                    detail = 'Credential "' + name + '" is valid for ' + daysLeft + ' day(s).';
                    remediation = '';
                }

                this._recordFinding({
                    item_type: 'credential',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: riskLevel,
                    risk_score: riskScore,
                    detail: detail,
                    remediation: remediation
                });
            }
        }
    },

    // ------------------------------------------------------------------
    // Scanner 2: Connection alias drift
    // ------------------------------------------------------------------

    _scanAliases: function (runId) {
        this._itemsScanned = this._itemsScanned || 0;
        var instanceEnv = this._detectEnvironment();

        var gr = new GlideRecord('sys_connection_alias');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this._itemsScanned++;
            var name = gr.getValue('name') || gr.getValue('sys_id');
            var connection = gr.getValue('connection') || '';
            var connectionName = this._lookupName('sys_connection', connection);

            // Heuristic: detect environment keywords in the alias/connection name
            // or endpoint that conflict with the instance's own environment.
            var drift = this._detectAliasDrift(name, connectionName, instanceEnv);

            if (drift.drifted) {
                this._recordFinding({
                    item_type: 'connection',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: drift.severity === 'high' ? this.RISK_BROKEN : this.RISK_AT_RISK,
                    risk_score: drift.severity === 'high' ? 90 : 55,
                    detail: drift.detail,
                    remediation: 'Correct the connection alias to point at the ' + instanceEnv +
                        ' environment, then re-validate the connection.'
                });
            } else {
                this._recordFinding({
                    item_type: 'connection',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: this.RISK_HEALTHY,
                    risk_score: 5,
                    detail: 'Connection alias "' + name + '" is consistent with the ' + instanceEnv + ' environment.',
                    remediation: ''
                });
            }
        }
    },

    _detectEnvironment: function () {
        var url = gs.getProperty('instance_name') || '';
        var host = gs.getProperty('glide.servlet.uri') || '';
        var combined = (url + ' ' + host).toLowerCase();
        if (combined.indexOf('prod') >= 0) { return 'production'; }
        if (combined.indexOf('dev') >= 0) { return 'development'; }
        if (combined.indexOf('test') >= 0 || combined.indexOf('qa') >= 0) { return 'test'; }
        if (combined.indexOf('stage') >= 0 || combined.indexOf('uat') >= 0) { return 'staging'; }
        return 'unknown';
    },

    _detectAliasDrift: function (aliasName, connectionName, instanceEnv) {
        var text = ((aliasName || '') + ' ' + (connectionName || '')).toLowerCase();
        var envKeywords = {
            'production': ['prod', 'production'],
            'development': ['dev', 'development'],
            'test': ['test', 'qa'],
            'staging': ['stage', 'staging', 'uat']
        };

        // Find which environment the alias text references, using word-boundary
        // matching so substrings like "device"/"product"/"latest" are not
        // mis-flagged as "dev"/"prod"/"test".
        var referencedEnv = '';
        for (var env in envKeywords) {
            if (!envKeywords.hasOwnProperty(env)) { continue; }
            var kws = envKeywords[env];
            for (var k = 0; k < kws.length; k++) {
                var re = new RegExp('(^|[^a-z0-9])' + kws[k] + '([^a-z0-9]|$)');
                if (re.test(text)) {
                    referencedEnv = env;
                    break;
                }
            }
            if (referencedEnv) { break; }
        }

        if (!referencedEnv || instanceEnv === 'unknown') {
            return { drifted: false };
        }

        if (referencedEnv !== instanceEnv) {
            var severity = (referencedEnv === 'production' && instanceEnv !== 'production') ? 'high' : 'medium';
            return {
                drifted: true,
                severity: severity,
                detail: 'Connection alias "' + aliasName + '" references the ' + referencedEnv +
                    ' environment but this instance is ' + instanceEnv + '.'
            };
        }

        return { drifted: false };
    },

    // ------------------------------------------------------------------
    // Scanner 3: Spoke version lag
    // ------------------------------------------------------------------

    _scanSpokeVersions: function (runId) {
        this._itemsScanned = this._itemsScanned || 0;
        var gr = new GlideRecord('sys_hub_spoke');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this._itemsScanned++;
            var name = gr.getValue('name') || gr.getValue('sys_id');
            var version = gr.getValue('version') || gr.getValue('installed_version') || '';
            var required = gr.getValue('required_version') || gr.getValue('compatible_version') || '';

            if (!version) {
                // No version info — cannot assess lag.
                continue;
            }

            if (required && this._compareVersions(version, required) < 0) {
                this._recordFinding({
                    item_type: 'spoke',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: this.RISK_AT_RISK,
                    risk_score: 60,
                    detail: 'Spoke "' + name + '" is at version ' + version +
                        ' but version ' + required + ' is required for the current platform release.',
                    remediation: 'Upgrade the spoke to version ' + required + ' before the next platform upgrade.'
                });
            } else {
                this._recordFinding({
                    item_type: 'spoke',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: this.RISK_HEALTHY,
                    risk_score: 5,
                    detail: 'Spoke "' + name + '" is at version ' + version + '.',
                    remediation: ''
                });
            }
        }
    },

    _compareVersions: function (a, b) {
        var pa = String(a).split('.').map(function (x) { return parseInt(x, 10) || 0; });
        var pb = String(b).split('.').map(function (x) { return parseInt(x, 10) || 0; });
        var len = Math.max(pa.length, pb.length);
        for (var i = 0; i < len; i++) {
            var va = pa[i] || 0;
            var vb = pb[i] || 0;
            if (va < vb) { return -1; }
            if (va > vb) { return 1; }
        }
        return 0;
    },

    // ------------------------------------------------------------------
    // Scanner 4: Dead flow-action detection
    // ------------------------------------------------------------------

    _scanDeadActions: function (runId) {
        this._itemsScanned = this._itemsScanned || 0;
        var gr = new GlideRecord('sys_hub_flow_action');
        gr.setLimit(500);
        gr.query();
        while (gr.next()) {
            this._itemsScanned++;
            var name = gr.getValue('name') || gr.getValue('sys_id');
            var stepId = gr.getValue('step') || gr.getValue('spoke_step') || '';

            if (!stepId) {
                continue;
            }

            var stepExists = this._recordExists('sys_hub_step', stepId);
            if (!stepExists) {
                this._recordFinding({
                    item_type: 'flow_action',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: this.RISK_BROKEN,
                    risk_score: 100,
                    detail: 'Flow action "' + name + '" references a spoke step that no longer exists (deleted or renamed).',
                    remediation: 'Re-point the flow action to a valid spoke step, or remove the dead action from the flow.'
                });
            } else {
                this._recordFinding({
                    item_type: 'flow_action',
                    item_sys_id: gr.getUniqueValue(),
                    item_name: name,
                    risk_level: this.RISK_HEALTHY,
                    risk_score: 5,
                    detail: 'Flow action "' + name + '" references a valid spoke step.',
                    remediation: ''
                });
            }
        }
    },

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    _toMs: function (dateStr) {
        if (!dateStr) { return 0; }
        var gdt = new GlideDateTime();
        gdt.setValue(dateStr);
        return gdt.getNumericValue();
    },

    _lookupName: function (table, sysId) {
        if (!sysId) { return ''; }
        var gr = new GlideRecord(table);
        if (gr.get(sysId)) {
            return gr.getValue('name') || '';
        }
        return '';
    },

    _recordExists: function (table, sysId) {
        if (!sysId) { return false; }
        var gr = new GlideRecord(table);
        return gr.get(sysId);
    },

    type: 'SpokePulseScanner'
};
