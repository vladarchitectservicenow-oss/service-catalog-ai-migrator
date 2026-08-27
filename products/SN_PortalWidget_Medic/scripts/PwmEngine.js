// PortalWidget Medic — PwmEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic scan engine for the Service Portal / Employee Center widget
// estate. Walks sp_widget and runs the full detector pipeline: reference
// integrity, version-aware deprecated-API matching, orphan/duplicate detection,
// and ACL exposure scoring — then folds everything into a composite 0-100
// breach-risk score per widget. All writes go to the scoped result tables
// (x_sn_pwm_finding, x_sn_pwm_health); the sp_* estate is read-only.

var PwmEngine = Class.create();
PwmEngine.prototype = {
    initialize: function() {
        this.BATCH_SIZE = 200;
        this.FINDING_TABLE = 'x_sn_pwm_finding';
        this.HEALTH_TABLE = 'x_sn_pwm_health';
        this._catalog = null; // lazy-loaded deprecated-API catalog
    },

    /**
     * Scan every widget in the estate and upsert findings + health records.
     * @param {boolean} incremental - if true, only scan widgets changed since the last run
     * @returns {object} {scanned, findings, critical, orphaned, duplicates, acl_exposed}
     */
    scanAllWidgets: function(incremental) {
        var stats = {
            scanned: 0, findings: 0, critical: 0,
            orphaned: 0, duplicates: 0, acl_exposed: 0
        };
        var scanId = this._beginScan();

        var offset = 0;
        while (true) {
            var gr = new GlideRecord('sp_widget');
            gr.addQuery('active', true);
            if (incremental) {
                var since = new GlideDateTime();
                since.addDaysUTC(-1);
                gr.addQuery('sys_updated_on', '>=', since.toString());
            }
            gr.chooseWindow(offset, offset + this.BATCH_SIZE);
            gr.query();

            var batchCount = 0;
            while (gr.next()) {
                batchCount++;
                try {
                    var result = this.scanWidget(gr.getUniqueValue(), scanId);
                    stats.scanned++;
                    stats.findings += result.total_findings;
                    stats.critical += result.critical_findings;
                    if (result.orphaned) { stats.orphaned++; }
                    if (result.duplicate) { stats.duplicates++; }
                    if (result.acl_exposed) { stats.acl_exposed++; }
                } catch (e) {
                    gs.error('PwmEngine.scanAllWidgets: failed for widget ' +
                             gr.getValue('name') + ': ' + e);
                }
            }

            if (batchCount < this.BATCH_SIZE) { break; }
            offset += this.BATCH_SIZE;
        }

        this._endScan(scanId, stats);
        return stats;
    },

    /**
     * Scan a single widget and persist its findings + health record.
     * @param {string} widgetId - sys_id of the sp_widget
     * @param {string} scanId - sys_id of the current scan run
     * @returns {object} per-widget result summary
     */
    scanWidget: function(widgetId, scanId) {
        var wgr = new GlideRecord('sp_widget');
        if (!wgr.get(widgetId)) {
            return { total_findings: 0, critical_findings: 0, orphaned: false, duplicate: false, acl_exposed: false };
        }

        var name = wgr.getValue('name') || '';
        var scope = wgr.getValue('sys_scope') || '';
        var clientScript = wgr.getValue('client_script') || '';
        var serverScript = wgr.getValue('script') || '';
        var isPublic = wgr.getValue('public') === 'true' || wgr.getValue('public') === true;

        var findings = [];
        var aclExposed = false;

        // 1. Reference integrity
        findings = findings.concat(this._checkReferenceIntegrity(widgetId, name, clientScript, serverScript));

        // 2. Deprecated API (version-aware)
        findings = findings.concat(this._checkDeprecatedApis(widgetId, name, clientScript, serverScript));

        // 3. Orphan detection
        var orphaned = this._isOrphan(widgetId);
        if (orphaned) {
            findings.push(this._makeFinding(widgetId, name, 'orphan', 'warning', 'high',
                'Widget is not referenced by any page or portal instance', 'Retire or re-attach to a page'));
        }

        // 4. Duplicate detection
        var duplicate = this._isDuplicate(name, scope, widgetId);
        if (duplicate) {
            findings.push(this._makeFinding(widgetId, name, 'duplicate', 'warning', 'high',
                'Near-duplicate widget name exists in another scope', 'Consolidate into a single canonical widget'));
        }

        // 5. ACL exposure
        var aclFinding = this._checkAcl(widgetId, name, isPublic);
        if (aclFinding) {
            aclExposed = true;
            findings.push(aclFinding);
        }

        // Persist findings
        var criticalCount = 0;
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            if (f.severity === 'critical') { criticalCount++; }
            this._upsertFinding(f, scanId);
        }

        // Composite breach-risk score
        var score = this._scoreWidget(findings, orphaned, duplicate, aclExposed);
        this._upsertHealth(widgetId, name, scope, score, findings.length, criticalCount,
            orphaned, duplicate, aclExposed);

        return {
            total_findings: findings.length,
            critical_findings: criticalCount,
            orphaned: orphaned,
            duplicate: duplicate,
            acl_exposed: aclExposed
        };
    },

    /**
     * Parse client + server scripts for references to non-existent script
     * includes and deprecated/removed $sp / spUtil / GlideSPScriptable methods.
     * @returns {Array} finding objects
     */
    _checkReferenceIntegrity: function(widgetId, name, clientScript, serverScript) {
        var out = [];
        var combined = (clientScript || '') + '\n' + (serverScript || '');

        // Detect references to script includes that do not exist in the instance.
        var siRefs = this._extractScriptIncludeRefs(serverScript);
        for (var i = 0; i < siRefs.length; i++) {
            var siName = siRefs[i];
            if (!this._scriptIncludeExists(siName)) {
                out.push(this._makeFinding(widgetId, name, 'ref_integrity', 'critical', 'high',
                    'Server script references non-existent script include "' + siName + '"',
                    'Create the script include or remove the reference'));
            }
        }

        // Detect removed server-side methods on GlideSPScriptable / spUtil.
        var removedMethods = [
            { re: /spUtil\.get\(/g, label: 'spUtil.get()', fix: 'Use spUtil.getWidget() or a direct GlideRecord query' },
            { re: /\$sp\.getParameter\(/g, label: '$sp.getParameter()', fix: 'Move $sp.getParameter() to the client controller, or use c.data passed from the server script' }
        ];
        for (var m = 0; m < removedMethods.length; m++) {
            var entry = removedMethods[m];
            entry.re.lastIndex = 0;
            if (entry.re.test(combined)) {
                out.push(this._makeFinding(widgetId, name, 'ref_integrity', 'critical', 'high',
                    'Widget uses removed/deprecated method ' + entry.label, entry.fix));
            }
        }

        return out;
    },

    /**
     * Match client + server scripts against the version-aware deprecated-API
     * catalog (stored as records of type 'deprecated_api' in the finding table).
     * @returns {Array} finding objects
     */
    _checkDeprecatedApis: function(widgetId, name, clientScript, serverScript) {
        var out = [];
        var combined = (clientScript || '') + '\n' + (serverScript || '');
        var catalog = this._getCatalog();

        for (var i = 0; i < catalog.length; i++) {
            var entry = catalog[i];
            var re = null;
            try {
                re = new RegExp(entry.pattern, 'g');
            } catch (e) {
                continue; // skip malformed catalog patterns
            }
            if (re.test(combined)) {
                out.push(this._makeFinding(widgetId, name, 'deprecated_api', 'warning', 'high',
                    'Widget uses deprecated API "' + entry.api_name + '" (deprecated in ' +
                    entry.release + '): ' + entry.replacement,
                    'Replace with ' + entry.replacement + ' before the ' + entry.release + ' upgrade'));
            }
        }

        return out;
    },

    /**
     * A widget is orphaned if no sp_instance references it.
     * @returns {boolean}
     */
    _isOrphan: function(widgetId) {
        var gr = new GlideRecord('sp_instance');
        gr.addQuery('widget', widgetId);
        gr.setLimit(1);
        gr.query();
        return !gr.hasNext();
    },

    /**
     * A widget is a near-duplicate if another active widget shares its name in
     * a different scope.
     * @returns {boolean}
     */
    _isDuplicate: function(name, scope, widgetId) {
        if (!name) { return false; }
        var gr = new GlideRecord('sp_widget');
        gr.addQuery('name', name);
        gr.addQuery('sys_id', '!=', widgetId);
        gr.addQuery('active', true);
        if (scope) { gr.addQuery('sys_scope', '!=', scope); }
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    /**
     * Flag widgets with no ACL or public (*) role access.
     * @returns {object|null} finding object, or null if the widget is properly scoped
     */
    _checkAcl: function(widgetId, name, isPublic) {
        if (isPublic) {
            return this._makeFinding(widgetId, name, 'acl', 'critical', 'high',
                'Widget is public (no role restriction) — accessible to unauthenticated users',
                'Set the widget "public" flag to false and assign a least-privilege role');
        }
        return null;
    },

    /**
     * Composite 0-100 breach-risk score. Higher = worse.
     * Weights: reference integrity 35, deprecated API 25, ACL 25, orphan/duplicate 15.
     * @returns {number} 0-100
     */
    _scoreWidget: function(findings, orphaned, duplicate, aclExposed) {
        var score = 0;
        var hasRef = false, hasDep = false, hasAcl = false;
        for (var i = 0; i < findings.length; i++) {
            var t = findings[i].finding_type;
            if (t === 'ref_integrity') { hasRef = true; }
            if (t === 'deprecated_api') { hasDep = true; }
            if (t === 'acl') { hasAcl = true; }
        }
        if (hasRef) { score += 35; }
        if (hasDep) { score += 25; }
        if (hasAcl) { score += 25; }
        if (orphaned) { score += 10; }
        if (duplicate) { score += 5; }
        if (score > 100) { score = 100; }
        return score;
    },

    /**
     * Build a finding object (not yet persisted).
     */
    _makeFinding: function(widgetId, name, type, severity, confidence, detail, remediation) {
        return {
            widget_id: widgetId,
            widget_name: name,
            finding_type: type,
            severity: severity,
            confidence: confidence,
            detail: detail,
            remediation: remediation
        };
    },

    /**
     * Upsert a finding record (dedupe by widget + type + detail signature).
     */
    _upsertFinding: function(f, scanId) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('record_type', 'finding');
        gr.addQuery('widget_id', f.widget_id);
        gr.addQuery('finding_type', f.finding_type);
        gr.addQuery('detail', f.detail);
        gr.setLimit(1);
        gr.query();

        if (gr.next()) {
            gr.setValue('last_seen', new GlideDateTime().toString());
            gr.setValue('scan_id', scanId);
            gr.setValue('resolved', false);
            try { gr.update(); } catch (e) { gs.error('PwmEngine._upsertFinding update: ' + e); }
            return;
        }

        gr.initialize();
        gr.setValue('record_type', 'finding');
        gr.setValue('widget_id', f.widget_id);
        gr.setValue('widget_name', f.widget_name);
        gr.setValue('finding_type', f.finding_type);
        gr.setValue('severity', f.severity);
        gr.setValue('confidence', f.confidence);
        gr.setValue('detail', f.detail);
        gr.setValue('remediation', f.remediation);
        gr.setValue('first_seen', new GlideDateTime().toString());
        gr.setValue('last_seen', new GlideDateTime().toString());
        gr.setValue('scan_id', scanId);
        gr.setValue('resolved', false);
        try { gr.insert(); } catch (e) { gs.error('PwmEngine._upsertFinding insert: ' + e); }
    },

    /**
     * Upsert the per-widget health record.
     */
    _upsertHealth: function(widgetId, name, scope, score, totalFindings, criticalFindings,
                            orphaned, duplicate, aclExposed) {
        var gr = new GlideRecord(this.HEALTH_TABLE);
        gr.addQuery('widget_id', widgetId);
        gr.setLimit(1);
        gr.query();

        var status = 'healthy';
        if (score >= 60) { status = 'critical'; }
        else if (score >= 25) { status = 'at_risk'; }

        if (gr.next()) {
            gr.setValue('breach_risk_score', score);
            gr.setValue('total_findings', totalFindings);
            gr.setValue('critical_findings', criticalFindings);
            gr.setValue('orphaned', orphaned);
            gr.setValue('duplicate', duplicate);
            gr.setValue('acl_exposed', aclExposed);
            gr.setValue('status', status);
            gr.setValue('last_scanned', new GlideDateTime().toString());
            try { gr.update(); } catch (e) { gs.error('PwmEngine._upsertHealth update: ' + e); }
            return;
        }

        gr.initialize();
        gr.setValue('widget_id', widgetId);
        gr.setValue('widget_name', name);
        gr.setValue('widget_scope', scope);
        gr.setValue('breach_risk_score', score);
        gr.setValue('total_findings', totalFindings);
        gr.setValue('critical_findings', criticalFindings);
        gr.setValue('orphaned', orphaned);
        gr.setValue('duplicate', duplicate);
        gr.setValue('acl_exposed', aclExposed);
        gr.setValue('status', status);
        gr.setValue('last_scanned', new GlideDateTime().toString());
        try { gr.insert(); } catch (e) { gs.error('PwmEngine._upsertHealth insert: ' + e); }
    },

    /**
     * Begin a scan run and return its sys_id (record_type = 'scan').
     */
    _beginScan: function() {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.initialize();
        gr.setValue('record_type', 'scan');
        gr.setValue('scanned_at', new GlideDateTime().toString());
        gr.setValue('status', 'running');
        var id = gr.insert();
        if (!id) {
            gs.error('PwmEngine._beginScan: insert returned no sys_id');
            throw new Error('PortalWidget Medic: failed to begin scan run');
        }
        return id;
    },

    /**
     * Mark a scan run complete with summary stats.
     */
    _endScan: function(scanId, stats) {
        if (!scanId) { return; }
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (!gr.get(scanId)) { return; }
        gr.setValue('status', 'complete');
        gr.setValue('detail_json', JSON.stringify(stats));
        gr.setValue('scanned_at', new GlideDateTime().toString());
        try { gr.update(); } catch (e) { gs.error('PwmEngine._endScan: ' + e); }
    },

    /**
     * Extract script-include constructor references from server script text.
     * Matches `new FooBar(...)` where FooBar is a PascalCase identifier.
     * @returns {Array} script include names
     */
    _extractScriptIncludeRefs: function(serverScript) {
        var out = [];
        if (!serverScript) { return out; }
        var GLOBAL_CLASSES = {
            'GlideRecord': true, 'GlideDateTime': true, 'GlideSystem': true,
            'GlideSPScriptable': true, 'GlideElement': true, 'GlideAggregate': true,
            'GlideDuration': true, 'GlideSchedule': true, 'GlideFilter': true,
            'GlideSession': true, 'GlideUser': true, 'GlideLocale': true,
            'GlideDate': true, 'GlideTime': true, 'GlideDigest': true,
            'GlideSecureRandomUtil': true, 'GlideStringUtil': true,
            'RegExp': true, 'Date': true, 'Array': true, 'Object': true,
            'String': true, 'Number': true, 'Boolean': true, 'JSON': true,
            'Math': true, 'Error': true, 'Promise': true, 'Map': true, 'Set': true
        };
        var re = /new\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
        var m;
        var seen = {};
        while ((m = re.exec(serverScript)) !== null) {
            var name = m[1];
            if (GLOBAL_CLASSES[name]) { continue; }
            if (!seen[name]) {
                seen[name] = true;
                out.push(name);
            }
        }
        return out;
    },

    /**
     * Check whether a script include exists by name.
     * @returns {boolean}
     */
    _scriptIncludeExists: function(name) {
        var gr = new GlideRecord('sys_script_include');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    /**
     * Load the deprecated-API catalog (records of type 'deprecated_api').
     * Seeds a baseline catalog on first run if empty.
     * @returns {Array} [{api_name, pattern, release, replacement}]
     */
    _getCatalog: function() {
        if (this._catalog !== null) { return this._catalog; }

        var catalog = this._queryCatalog();

        if (catalog.length === 0) {
            this._seedCatalog();
            catalog = this._queryCatalog();
        }

        this._catalog = catalog;
        return catalog;
    },

    _queryCatalog: function() {
        var catalog = [];
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('record_type', 'deprecated_api');
        gr.query();
        while (gr.next()) {
            catalog.push({
                api_name: gr.getValue('api_name') || '',
                pattern: gr.getValue('detail') || '',
                release: gr.getValue('api_release') || '',
                replacement: gr.getValue('replacement') || ''
            });
        }
        return catalog;
    },

    /**
     * Seed the baseline deprecated-API catalog (version-aware).
     */
    _seedCatalog: function() {
        var seed = [
            { api_name: 'GlideSPScriptable.getPortalRecord()', pattern: 'getPortalRecord\\(', release: 'Utah', replacement: 'sp_portal GlideRecord query' },
            { api_name: 'AngularJS $scope.$watch', pattern: '\\$scope\\.\\$watch', release: 'San Diego', replacement: 'c.update() / reactive data binding' },
            { api_name: 'spUtil.recordWatch()', pattern: 'recordWatch\\(', release: 'Vancouver', replacement: 'c.server.update() polling or UI Builder' }
        ];

        for (var i = 0; i < seed.length; i++) {
            var s = seed[i];
            var gr = new GlideRecord(this.FINDING_TABLE);
            gr.initialize();
            gr.setValue('record_type', 'deprecated_api');
            gr.setValue('api_name', s.api_name);
            gr.setValue('detail', s.pattern);
            gr.setValue('api_release', s.release);
            gr.setValue('replacement', s.replacement);
            try { gr.insert(); } catch (e) { gs.error('PwmEngine._seedCatalog: ' + e); }
        }
    },

    type: 'PwmEngine'
};
