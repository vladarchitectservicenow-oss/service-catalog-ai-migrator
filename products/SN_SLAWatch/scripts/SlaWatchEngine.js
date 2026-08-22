// SLAWatch — SlaWatchEngine: deterministic SLA estate detection engine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Consolidates five detectors into a single Script Include:
//   Condition Integrity Scanner, Orphan & Coverage Detector,
//   Schedule Drift Monitor, Attachment Liveness Check, Breach-Risk Scorer.
// All logic is pure GlideRecord / Table API — no LLM in the critical path,
// so results are reproducible and auditable.
//
// @class SlaWatchEngine @namespace x_sn_slawatch
var SlaWatchEngine = Class.create();
SlaWatchEngine.prototype = {
    initialize: function () {
        this._findingTable = 'x_sn_slawatch_finding';
        this._scanTable = 'x_sn_slawatch_scan';
        this._slaTable = 'contract_sla';
        this._taskSlaTable = 'task_sla';
        this._dictTable = 'sys_dictionary';
        this._scheduleTable = 'cmn_schedule';
        this._spanTable = 'cmn_schedule_span';
        // Task tables that are expected to carry SLA coverage.
        this._taskTables = ['incident', 'change_request', 'problem', 'sc_request', 'sc_req_item', 'sc_task'];
        // Condition fields on contract_sla that reference task-table fields.
        this._conditionFields = ['start_condition', 'pause_condition', 'stop_condition', 'reset_condition'];
    },

    /**
     * Run a full or delta scan of the SLA estate and persist findings + a scan record.
     * @param {string} scanType  'full' | 'delta'
     * @param {number} livenessDays  attachment-liveness threshold in days
     * @return {string} sys_id of the created scan record ('' on failure)
     */
    runFullScan: function (scanType, livenessDays) {
        var scanType = scanType || 'full';
        var livenessDays = livenessDays || 30;
        var scanGr = new GlideRecord(this._scanTable);
        scanGr.initialize();
        scanGr.setValue('scan_type', scanType);
        scanGr.setValue('started_at', new GlideDateTime().getValue());
        scanGr.setValue('status', 'running');
        var scanSysId = scanGr.insert();
        if (!scanSysId) {
            gs.error('SlaWatchEngine.runFullScan: failed to create scan record');
            return '';
        }

        // Delta scans use a high-water mark: only SLAs updated since the last
        // completed scan are re-analyzed. Full scans process the entire estate.
        var since = (scanType === 'delta') ? this._getHighWaterMark() : '';

        // Load the schedule baseline map once (avoids N+1 re-reads per SLA).
        this._baselineMap = this._getBaselineMap();
        this._baselineUpdates = {};

        var findings = [];
        try {
            findings = findings.concat(this._scanConditionIntegrity(scanSysId, since));
            findings = findings.concat(this._detectOrphansAndCoverage(scanSysId, since));
            findings = findings.concat(this._detectScheduleDrift(scanSysId, since));
            findings = findings.concat(this._checkLiveness(scanSysId, livenessDays, since));

            // Compute breach-risk score per SLA and persist as findings of category 'score'.
            var scoreFindings = this._computeBreachRiskScores(scanSysId, findings);
            findings = findings.concat(scoreFindings);

            // Persist findings to the finding table (release-blocking wiring).
            var report = new SlaWatchReport();
            report.persistFindings(findings);

            // Finalize scan record.
            var done = new GlideRecord(this._scanTable);
            if (done.get(scanSysId)) {
                done.setValue('completed_at', new GlideDateTime().getValue());
                done.setValue('status', 'completed');
                done.setValue('sla_count', this._countSlas());
                done.setValue('finding_count', findings.length);
                done.setValue('high_risk_count', this._countHighRisk(findings));
                done.setValue('summary_json', JSON.stringify(this._buildSummary(findings)));
                done.setValue('baseline_json', JSON.stringify(this._mergeBaseline()));
                done.update();
            }
        } catch (e) {
            gs.error('SlaWatchEngine.runFullScan: scan failed: ' + e.message);
            var fail = new GlideRecord(this._scanTable);
            if (fail.get(scanSysId)) {
                fail.setValue('completed_at', new GlideDateTime().getValue());
                fail.setValue('status', 'failed');
                fail.update();
            }
            return '';
        }
        return scanSysId;
    },

    /**
     * 1) Condition Integrity Scanner.
     * Parses start/pause/stop/reset conditions and cross-references each
     * referenced field against sys_dictionary for the SLA's target table.
     */
    _scanConditionIntegrity: function (scanSysId, since) {
        var out = [];
        var slaGr = new GlideRecord(this._slaTable);
        slaGr.addActiveQuery();
        if (since) { slaGr.addQuery('sys_updated_on', '>', since); }
        slaGr.query();
        while (slaGr.next()) {
            var collection = slaGr.getValue('collection') || '';
            var slaName = slaGr.getValue('name') || slaGr.getValue('sys_id');
            var slaSysId = slaGr.getUniqueValue();
            if (!collection) {
                continue; // orphan handled by coverage detector
            }
            var dictFields = this._getDictionaryFields(collection);
            for (var i = 0; i < this._conditionFields.length; i++) {
                var condField = this._conditionFields[i];
                var cond = slaGr.getValue(condField) || '';
                if (!cond) {
                    continue;
                }
                var refs = this._extractFieldRefs(cond);
                for (var j = 0; j < refs.length; j++) {
                    var fieldName = refs[j];
                    if (this._isSystemField(fieldName)) {
                        continue;
                    }
                    if (dictFields.indexOf(fieldName) === -1) {
                        out.push(this._makeFinding(scanSysId, slaSysId, slaName, collection,
                            'condition_integrity', 'high',
                            'Condition references missing field "' + fieldName + '" on table ' + collection,
                            condField, fieldName, cond));
                    }
                }
            }
        }
        return out;
    },

    /**
     * 2) Orphan & Coverage Detector.
     * SLAs with no target table, and task tables with no SLA coverage.
     */
    _detectOrphansAndCoverage: function (scanSysId, since) {
        var out = [];
        var coveredTables = {};
        var slaGr = new GlideRecord(this._slaTable);
        slaGr.addActiveQuery();
        if (since) { slaGr.addQuery('sys_updated_on', '>', since); }
        slaGr.query();
        while (slaGr.next()) {
            var collection = slaGr.getValue('collection') || '';
            var slaName = slaGr.getValue('name') || slaGr.getValue('sys_id');
            var slaSysId = slaGr.getUniqueValue();
            if (!collection) {
                out.push(this._makeFinding(scanSysId, slaSysId, slaName, '',
                    'orphan', 'high',
                    'SLA definition has no target task table (collection is empty)',
                    'collection', '', ''));
                continue;
            }
            coveredTables[collection] = true;
        }
        for (var t = 0; t < this._taskTables.length; t++) {
            var table = this._taskTables[t];
            if (!coveredTables[table]) {
                out.push(this._makeFinding(scanSysId, '', table, table,
                    'coverage', 'high',
                    'Task table "' + table + '" has no active SLA coverage',
                    'collection', '', ''));
            }
        }
        return out;
    },

    /**
     * 3) Schedule Drift Monitor.
     * Snapshots each SLA's schedule and diffs against a stored baseline.
     * Baseline updates are accumulated in-memory and written once at finalize.
     */
    _detectScheduleDrift: function (scanSysId, since) {
        var out = [];
        var slaGr = new GlideRecord(this._slaTable);
        slaGr.addActiveQuery();
        if (since) { slaGr.addQuery('sys_updated_on', '>', since); }
        slaGr.query();
        while (slaGr.next()) {
            var scheduleSysId = slaGr.getValue('schedule') || '';
            var slaName = slaGr.getValue('name') || slaGr.getValue('sys_id');
            var slaSysId = slaGr.getUniqueValue();
            if (!scheduleSysId) {
                continue;
            }
            var fingerprint = this._scheduleFingerprint(scheduleSysId);
            var baseline = this._getBaseline(slaSysId);
            if (baseline && baseline !== fingerprint) {
                out.push(this._makeFinding(scanSysId, slaSysId, slaName,
                    slaGr.getValue('collection') || '',
                    'schedule_drift', 'medium',
                    'Schedule changed since baseline snapshot',
                    'schedule', scheduleSysId, fingerprint));
            }
            this._baselineUpdates[slaSysId] = fingerprint;
        }
        return out;
    },

    /**
     * 4) Attachment Liveness Check.
     * Flags SLAs that have not attached to any task in N days.
     */
    _checkLiveness: function (scanSysId, livenessDays, since) {
        var out = [];
        var cutoff = new GlideDateTime();
        cutoff.addDaysUTC(-1 * livenessDays);
        var slaGr = new GlideRecord(this._slaTable);
        slaGr.addActiveQuery();
        if (since) { slaGr.addQuery('sys_updated_on', '>', since); }
        slaGr.query();
        while (slaGr.next()) {
            var slaSysId = slaGr.getUniqueValue();
            var slaName = slaGr.getValue('name') || slaSysId;
            var collection = slaGr.getValue('collection') || '';
            var lastAttach = this._lastAttachment(slaSysId);
            if (!lastAttach) {
                out.push(this._makeFinding(scanSysId, slaSysId, slaName, collection,
                    'liveness', 'medium',
                    'SLA has never attached to any task (possible broken start condition)',
                    'start_condition', '', ''));
            } else if (lastAttach < cutoff.getValue()) {
                out.push(this._makeFinding(scanSysId, slaSysId, slaName, collection,
                    'liveness', 'low',
                    'SLA has not attached to any task in ' + livenessDays + ' days',
                    'start_condition', '', lastAttach));
            }
        }
        return out;
    },

    /**
     * 5) Breach-Risk Scoring Engine.
     * Composite 0-100 score per SLA from condition integrity, orphan status,
     * schedule drift, and liveness.
     */
    _computeBreachRiskScores: function (scanSysId, findings) {
        var out = [];
        var riskBySla = {};
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            if (!f.sla_sys_id) {
                continue;
            }
            if (!riskBySla[f.sla_sys_id]) {
                riskBySla[f.sla_sys_id] = { name: f.sla_name, table: f.sla_table, score: 0 };
            }
            riskBySla[f.sla_sys_id].score += this._severityWeight(f.severity);
        }
        for (var slaId in riskBySla) {
            if (!riskBySla.hasOwnProperty(slaId)) {
                continue;
            }
            var entry = riskBySla[slaId];
            var score = Math.min(100, entry.score);
            out.push(this._makeFinding(scanSysId, slaId, entry.name, entry.table,
                'score', this._scoreSeverity(score),
                'Composite breach-risk score ' + score + '/100',
                '', '', String(score)));
        }
        return out;
    },

    // ---- Helpers ---------------------------------------------------------

    _makeFinding: function (scanSysId, slaSysId, slaName, slaTable, category, severity, message, field, fieldValue, detail) {
        return {
            scan_sys_id: scanSysId,
            sla_sys_id: slaSysId,
            sla_name: slaName,
            sla_table: slaTable,
            category: category,
            severity: severity,
            message: message,
            field: field,
            field_value: fieldValue,
            detail: detail
        };
    },

    _severityWeight: function (severity) {
        if (severity === 'high') { return 40; }
        if (severity === 'medium') { return 20; }
        return 10;
    },

    _scoreSeverity: function (score) {
        if (score >= 60) { return 'high'; }
        if (score >= 30) { return 'medium'; }
        return 'low';
    },

    _countHighRisk: function (findings) {
        var n = 0;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].severity === 'high') { n++; }
        }
        return n;
    },

    _buildSummary: function (findings) {
        var byCategory = {};
        for (var i = 0; i < findings.length; i++) {
            var c = findings[i].category;
            byCategory[c] = (byCategory[c] || 0) + 1;
        }
        return { total: findings.length, by_category: byCategory };
    },

    _countSlas: function () {
        var ga = new GlideAggregate(this._slaTable);
        ga.addActiveQuery();
        ga.addAggregate('COUNT');
        ga.query();
        if (ga.next()) {
            return parseInt(ga.getAggregate('COUNT'), 10);
        }
        return 0;
    },

    _getDictionaryFields: function (table) {
        var fields = [];
        var gr = new GlideRecord(this._dictTable);
        gr.addQuery('name', table);
        gr.addQuery('element', '!=', '');
        gr.query();
        while (gr.next()) {
            fields.push(gr.getValue('element'));
        }
        return fields;
    },

    _isSystemField: function (fieldName) {
        var sys = ['sys_id', 'sys_created_on', 'sys_created_by', 'sys_updated_on',
            'sys_updated_by', 'sys_mod_count', 'sys_class_name', 'sys_domain',
            'sys_domain_path', 'sys_scope', 'sys_tags'];
        return sys.indexOf(fieldName) !== -1;
    },

    /**
     * Extract field names from a condition string. Handles encoded-query style
     * (field=value^field2=value2) and script-style (current.field_name) references.
     */
    _extractFieldRefs: function (cond) {
        var refs = [];
        var seen = {};
        // Encoded query: field=value or field!=value or fieldINvalue
        var eqRe = /(?:^|\^|[\s])([A-Za-z_][A-Za-z0-9_]*)(?:=|!=|IN|NOT IN|LIKE|STARTSWITH|ENDSWITH)/g;
        var m;
        while ((m = eqRe.exec(cond)) !== null) {
            if (!seen[m[1]]) { seen[m[1]] = true; refs.push(m[1]); }
        }
        // Script style: current.field_name or current.getValue('field_name')
        var curRe = /current\.([A-Za-z_][A-Za-z0-9_]*)/g;
        while ((m = curRe.exec(cond)) !== null) {
            if (!seen[m[1]]) { seen[m[1]] = true; refs.push(m[1]); }
        }
        var gvRe = /getValue\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g;
        while ((m = gvRe.exec(cond)) !== null) {
            if (!seen[m[1]]) { seen[m[1]] = true; refs.push(m[1]); }
        }
        return refs;
    },

    _scheduleFingerprint: function (scheduleSysId) {
        var parts = [];
        var sched = new GlideRecord(this._scheduleTable);
        if (sched.get(scheduleSysId)) {
            parts.push('name=' + (sched.getValue('name') || ''));
            parts.push('tz=' + (sched.getValue('time_zone') || ''));
        }
        var span = new GlideRecord(this._spanTable);
        span.addQuery('schedule', scheduleSysId);
        span.orderBy('sys_id');
        span.query();
        var spanCount = 0;
        while (span.next()) {
            spanCount++;
            parts.push(span.getValue('day_of_week') + ':' + span.getValue('start_time') + '-' + span.getValue('end_time'));
        }
        parts.push('spans=' + spanCount);
        return parts.join('|');
    },

    /**
     * Load the most recent non-empty schedule baseline map (single query).
     * Replaces the fragile CONTAINS substring match with a direct JSON parse.
     */
    _getBaselineMap: function () {
        var gr = new GlideRecord(this._scanTable);
        gr.addQuery('baseline_json', '!=', '');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            try {
                return JSON.parse(gr.getValue('baseline_json') || '{}');
            } catch (e) {
                return {};
            }
        }
        return {};
    },

    _getBaseline: function (slaSysId) {
        return this._baselineMap[slaSysId] || '';
    },

    _mergeBaseline: function () {
        var merged = {};
        var k;
        for (k in this._baselineMap) {
            if (this._baselineMap.hasOwnProperty(k)) { merged[k] = this._baselineMap[k]; }
        }
        for (k in this._baselineUpdates) {
            if (this._baselineUpdates.hasOwnProperty(k)) { merged[k] = this._baselineUpdates[k]; }
        }
        return merged;
    },

    _getHighWaterMark: function () {
        var gr = new GlideRecord(this._scanTable);
        gr.addQuery('status', 'completed');
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('completed_at') || gr.getValue('sys_created_on') || '';
        }
        return '';
    },

    _lastAttachment: function (slaSysId) {
        var gr = new GlideRecord(this._taskSlaTable);
        gr.addQuery('sla', slaSysId);
        gr.orderByDesc('sys_created_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('sys_created_on');
        }
        return '';
    },

    type: 'SlaWatchEngine'
};
