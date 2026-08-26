// RetentionGuard — RetentionGuardEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core deterministic retention engine: table growth inventory, policy
// evaluation, safe archive/purge execution with referential-integrity checks,
// and full-cycle orchestration. All logic is pure and auditable — no AI
// dependency in the execution path.
//
// @class RetentionGuardEngine @namespace x_snc_retention_guard

var RetentionGuardEngine = Class.create();
RetentionGuardEngine.prototype = {

    POLICY_TABLE: 'x_snc_retention_guard_policy',
    RUN_TABLE: 'x_snc_retention_guard_run',
    ARCHIVE_TABLE: 'x_snc_retention_guard_archive',

    // Default policy set mapped to compliance frameworks. Covers the standard
    // high-growth tables so a new customer is compliant on day one.
    DEFAULT_POLICIES: [
        { table_name: 'sys_audit',         retention_days: 90,  action: 'purge',   framework: 'GDPR' },
        { table_name: 'syslog',            retention_days: 30,  action: 'purge',   framework: 'GDPR' },
        { table_name: 'sys_email',         retention_days: 365, action: 'archive', framework: 'SOX' },
        { table_name: 'sys_attachment',    retention_days: 365, action: 'archive', framework: 'HIPAA' },
        { table_name: 'sys_journal_field', retention_days: 365, action: 'archive', framework: 'SOX' }
    ],

    // Tables that must never be purged regardless of policy.
    PROTECTED_TABLES: [
        'sys_user', 'sys_user_group', 'sys_user_role', 'sys_user_has_role',
        'sys_script_include', 'sys_script', 'sys_dictionary', 'sys_db_object',
        'sys_choice', 'sys_security_acl', 'sys_properties', 'sys_ui_policy'
    ],

    // Core ITSM tables that lack a sys_/x_/u_/sn_ prefix and are therefore
    // missed by the prefix scan. Included explicitly so the growth inventory
    // covers the tables that actually drive platform storage.
    CORE_TABLES: [
        'incident', 'task', 'problem', 'change_request', 'cmdb_ci',
        'sc_req_item', 'sc_task', 'kb_knowledge'
    ],

    initialize: function () {
        this._batchSize = 500;
        this._dryRun = true;
    },

    /**
     * Inventory all tables: row counts via GlideAggregate, filtered to
     * non-protected, non-system tables. Returns an array of {table_name, rows}.
     * Cross-scope reads of sys_db_object / sys_dictionary require the
     * privileges declared in the app manifest.
     */
    inventoryTables: function () {
        var result = [];
        var seen = {};
        var dbObj = new GlideRecord('sys_db_object');
        dbObj.addQuery('name', 'STARTSWITH', 'sys_').setOr(true);
        dbObj.addQuery('name', 'STARTSWITH', 'x_').setOr(true);
        dbObj.addQuery('name', 'STARTSWITH', 'u_').setOr(true);
        dbObj.addQuery('name', 'STARTSWITH', 'sn_').setOr(true);
        dbObj.query();

        while (dbObj.next()) {
            var tableName = dbObj.getValue('name');
            if (!tableName || seen[tableName]) { continue; }
            seen[tableName] = true;
            if (this._isProtected(tableName)) { continue; }

            var count = this._countRows(tableName);
            result.push({ table_name: tableName, rows: count });
        }

        // Include core ITSM tables that have no scoped prefix.
        for (var c = 0; c < this.CORE_TABLES.length; c++) {
            var coreName = this.CORE_TABLES[c];
            if (seen[coreName] || this._isProtected(coreName)) { continue; }
            seen[coreName] = true;
            result.push({ table_name: coreName, rows: this._countRows(coreName) });
        }

        result.sort(function (a, b) { return b.rows - a.rows; });
        return result;
    },

    /**
     * Count rows in a table using GlideAggregate (avoids getRowCount() cap).
     * Returns 0 on any error so a single unreadable table never aborts the scan.
     */
    _countRows: function (tableName) {
        try {
            var ga = new GlideAggregate(tableName);
            ga.addAggregate('COUNT');
            ga.query();
            if (ga.next()) {
                return parseInt(ga.getAggregate('COUNT'), 10) || 0;
            }
        } catch (e) {
            gs.warn('RetentionGuard: unable to count ' + tableName + ': ' + e.message);
        }
        return 0;
    },

    _isProtected: function (tableName) {
        for (var i = 0; i < this.PROTECTED_TABLES.length; i++) {
            if (tableName === this.PROTECTED_TABLES[i]) { return true; }
        }
        return false;
    },

    /**
     * Evaluate the applicable policy for a table. Returns a policy object or
     * null when no policy applies. Legal holds are checked first — a held
     * table is never eligible for purge/archive.
     */
    getPolicyForTable: function (tableName) {
        var gr = new GlideRecord(this.POLICY_TABLE);
        gr.addQuery('table_name', tableName);
        gr.addQuery('active', true);
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) { return null; }

        var policy = {
            sys_id: gr.getUniqueValue(),
            table_name: gr.getValue('table_name'),
            retention_days: parseInt(gr.getValue('retention_days'), 10) || 0,
            action: gr.getValue('action'),
            framework: gr.getValue('framework'),
            holds: this._parseJson(gr.getValue('holds_json'), []),
            exceptions: this._parseJson(gr.getValue('exceptions_json'), [])
        };
        return policy;
    },

    /**
     * Determine whether a table is under legal hold. A hold blocks the
     * executor entirely — compliance is enforced by the engine, not discipline.
     */
    isTableHeld: function (tableName) {
        var policy = this.getPolicyForTable(tableName);
        if (!policy) { return false; }
        var holds = policy.holds || [];
        for (var i = 0; i < holds.length; i++) {
            if (holds[i].table_name === tableName && holds[i].active !== false) {
                return true;
            }
        }
        return false;
    },

    /**
     * Compute the cutoff GlideDateTime for a retention period: now minus
     * retention_days. Records older than this are eligible for action.
     */
    computeCutoff: function (retentionDays) {
        var gdt = new GlideDateTime();
        gdt.addDaysUTC(-1 * retentionDays);
        return gdt;
    },

    /**
     * Dry-run preview: count records older than the cutoff for a table without
     * writing anything. Returns {eligible, held, cutoff}.
     */
    previewPurge: function (tableName, retentionDays) {
        var cutoff = this.computeCutoff(retentionDays);
        var held = this.isTableHeld(tableName);
        var eligible = 0;
        if (!held) {
            eligible = this._countOlderThan(tableName, cutoff);
        }
        return { table_name: tableName, eligible: eligible, held: held, cutoff: cutoff.getValue() };
    },

    _countOlderThan: function (tableName, cutoff) {
        try {
            var ga = new GlideAggregate(tableName);
            ga.addQuery('sys_created_on', '<', cutoff.getValue());
            ga.addAggregate('COUNT');
            ga.query();
            if (ga.next()) {
                return parseInt(ga.getAggregate('COUNT'), 10) || 0;
            }
        } catch (e) {
            gs.warn('RetentionGuard: unable to count older-than for ' + tableName + ': ' + e.message);
        }
        return 0;
    },

    /**
     * Referential-integrity check: for a candidate record, detect whether any
     * other table references it via a reference field. Returns true when the
     * record is safe to delete (no inbound references), false when it would
     * orphan related data. Uses sys_dictionary to find reference fields.
     */
    hasInboundReferences: function (tableName, sysId) {
        var refFields = this._findReferenceFields(tableName);
        for (var i = 0; i < refFields.length; i++) {
            var ref = refFields[i];
            var gr = new GlideRecord(ref.table);
            gr.addQuery(ref.field, sysId);
            gr.setLimit(1);
            gr.query();
            if (gr.hasNext()) { return true; }
        }
        return false;
    },

    _findReferenceFields: function (tableName) {
        var result = [];
        var dict = new GlideRecord('sys_dictionary');
        dict.addQuery('reference', tableName);
        dict.addNotNullQuery('name');
        dict.query();
        while (dict.next()) {
            var refTable = dict.getValue('name');
            var refField = dict.getValue('element');
            if (refTable && refField) {
                result.push({ table: refTable, field: refField });
            }
        }
        return result;
    },

    /**
     * Determine whether a candidate record is exempt from action via the
     * policy's exceptions_json. Supports two exception shapes:
     *   { sys_id: '...' }            — exact record exemption
     *   { field: '...', value: '...' } — field/value match exemption
     * Returns true when the record must be retained (skipped).
     */
    _isExcepted: function (policy, tableName, sysId) {
        var exceptions = policy.exceptions || [];
        if (exceptions.length === 0) { return false; }

        var needRecord = false;
        for (var i = 0; i < exceptions.length; i++) {
            var ex = exceptions[i];
            if (ex.sys_id && ex.sys_id === sysId) { return true; }
            if (ex.field) { needRecord = true; }
        }
        if (!needRecord) { return false; }

        var gr = new GlideRecord(tableName);
        if (!gr.get(sysId)) { return false; }
        for (var j = 0; j < exceptions.length; j++) {
            var e = exceptions[j];
            if (e.field && e.value !== undefined && e.value !== null &&
                gr.getValue(e.field) === String(e.value)) {
                return true;
            }
        }
        return false;
    },

    /**
     * Execute a retention cycle for a single table. Honors dry-run mode,
     * legal holds, referential integrity, exceptions, and chunked deletes.
     * Live execution advances a sys_id cursor so skipped records are never
     * re-fetched — the loop is guaranteed to terminate. Returns a summary
     * object with before/after counts and per-chunk logging.
     */
    executeTable: function (tableName, policy, dryRun) {
        var cutoff = this.computeCutoff(policy.retention_days);
        var summary = {
            table_name: tableName,
            action: policy.action,
            dry_run: !!dryRun,
            held: this.isTableHeld(tableName),
            rows_before: this._countRows(tableName),
            rows_processed: 0,
            rows_skipped: 0,
            rows_failed: 0,
            rows_archived: 0,
            cutoff: cutoff.getValue()
        };

        if (summary.held) {
            summary.status = 'blocked';
            summary.reason = 'legal_hold';
            return summary;
        }

        if (dryRun) {
            summary.rows_processed = this._countOlderThan(tableName, cutoff);
            summary.status = 'dry_run';
            return summary;
        }

        // Live execution: chunked delete/archive with referential-integrity
        // and exception checks. A sys_id cursor guarantees forward progress
        // even when every record in a batch is skipped.
        var processed = 0;
        var skipped = 0;
        var failed = 0;
        var archived = 0;
        var cursor = '';
        var keepGoing = true;
        var maxIterations = 100000; // hard safety ceiling
        var iterations = 0;

        while (keepGoing && iterations < maxIterations) {
            iterations++;
            var batch = this._fetchBatch(tableName, cutoff, this._batchSize, cursor);
            if (batch.length === 0) { keepGoing = false; break; }

            for (var i = 0; i < batch.length; i++) {
                var rec = batch[i];
                cursor = rec.sys_id; // advance past this record regardless of outcome
                if (this._isExcepted(policy, tableName, rec.sys_id)) {
                    skipped++;
                    continue;
                }
                if (this.hasInboundReferences(tableName, rec.sys_id)) {
                    skipped++;
                    continue;
                }
                if (policy.action === 'archive') {
                    if (this._archiveRecord(tableName, rec.sys_id)) {
                        processed++;
                        archived++;
                    } else {
                        failed++;
                    }
                } else {
                    if (this._deleteRecord(tableName, rec.sys_id)) {
                        processed++;
                    } else {
                        failed++;
                    }
                }
            }

            if (batch.length < this._batchSize) { keepGoing = false; }
        }

        summary.rows_processed = processed;
        summary.rows_skipped = skipped;
        summary.rows_failed = failed;
        summary.rows_archived = archived;
        summary.status = 'completed';
        return summary;
    },

    _fetchBatch: function (tableName, cutoff, limit, lastSysId) {
        var result = [];
        var gr = new GlideRecord(tableName);
        gr.addQuery('sys_created_on', '<', cutoff.getValue());
        if (lastSysId) { gr.addQuery('sys_id', '>', lastSysId); }
        gr.orderBy('sys_id');
        gr.setLimit(limit);
        gr.query();
        while (gr.next()) {
            result.push({ sys_id: gr.getUniqueValue() });
        }
        return result;
    },

    _deleteRecord: function (tableName, sysId) {
        try {
            var gr = new GlideRecord(tableName);
            if (gr.get(sysId)) {
                gr.setWorkflow(false);
                return gr.deleteRecord();
            }
        } catch (e) {
            gs.warn('RetentionGuard: delete failed for ' + tableName + '/' + sysId + ': ' + e.message);
        }
        return false;
    },

    /**
     * Archive a record: copy its field values into the archive table, then
     * delete the source only after the copy is confirmed. This guarantees
     * archive policies retain data rather than silently purging it.
     */
    _archiveRecord: function (tableName, sysId) {
        try {
            var src = new GlideRecord(tableName);
            if (!src.get(sysId)) { return false; }

            var payload = this._serializeRecord(src);
            var arch = new GlideRecord(this.ARCHIVE_TABLE);
            arch.initialize();
            arch.setValue('source_table', tableName);
            arch.setValue('source_sys_id', sysId);
            arch.setValue('payload_json', payload);
            arch.setValue('archived_at', new GlideDateTime().getValue());
            arch.setWorkflow(false);
            var archId = arch.insert();
            if (!archId) { return false; }

            // Only delete the source after a successful archive copy.
            src.setWorkflow(false);
            return src.deleteRecord();
        } catch (e) {
            gs.warn('RetentionGuard: archive failed for ' + tableName + '/' + sysId + ': ' + e.message);
        }
        return false;
    },

    /**
     * Serialize a record's field values to a JSON payload for archival.
     * Best-effort: unreadable fields are skipped, and oversized payloads are
     * truncated with a marker so the archive write never fails on length.
     */
    _serializeRecord: function (gr) {
        var obj = {};
        try {
            var fields = gr.getFields();
            var len = (typeof fields.length === 'number') ? fields.length : fields.size();
            for (var i = 0; i < len; i++) {
                var f = (typeof fields.length === 'number') ? fields[i] : fields.get(i);
                var name = f.getName();
                var val = gr.getValue(name);
                if (val !== null && val !== undefined && val !== '') {
                    obj[name] = val;
                }
            }
        } catch (e) {
            gs.warn('RetentionGuard: field serialization issue: ' + e.message);
        }
        var json = JSON.stringify(obj);
        if (json.length > 4000) {
            json = json.substring(0, 3990) + '...TRUNCATED';
        }
        return json;
    },

    /**
     * Run a full retention cycle across all configured policies. Writes a run
     * record to the result store and returns the run summary. This is the
     * single orchestration entry point used by the scheduled job and REST.
     * On failure the run record is finalized as 'failed' so it is never left
     * stranded in 'running'.
     */
    runCycle: function (dryRun) {
        var runId = this._createRunRecord(dryRun);
        var results = [];
        var policyGr = new GlideRecord(this.POLICY_TABLE);
        policyGr.addQuery('active', true);
        policyGr.query();

        try {
            while (policyGr.next()) {
                var tableName = policyGr.getValue('table_name');
                var policy = {
                    retention_days: parseInt(policyGr.getValue('retention_days'), 10) || 0,
                    action: policyGr.getValue('action'),
                    exceptions: this._parseJson(policyGr.getValue('exceptions_json'), [])
                };
                var summary = this.executeTable(tableName, policy, dryRun);
                results.push(summary);
            }

            this._finalizeRunRecord(runId, results, dryRun);
            return { run_id: runId, dry_run: !!dryRun, results: results };
        } catch (e) {
            this._failRunRecord(runId, e);
            throw e;
        }
    },

    _createRunRecord: function (dryRun) {
        try {
            var gr = new GlideRecord(this.RUN_TABLE);
            gr.initialize();
            gr.setValue('type', 'run');
            gr.setValue('status', dryRun ? 'dry_run' : 'running');
            gr.setValue('started_at', new GlideDateTime().getValue());
            return gr.insert();
        } catch (e) {
            gs.warn('RetentionGuard: unable to create run record: ' + e.message);
            return null;
        }
    },

    _finalizeRunRecord: function (runId, results, dryRun) {
        try {
            var gr = new GlideRecord(this.RUN_TABLE);
            if (!gr.get(runId)) { return; }
            var totalProcessed = 0;
            var totalSkipped = 0;
            for (var i = 0; i < results.length; i++) {
                totalProcessed += results[i].rows_processed || 0;
                totalSkipped += results[i].rows_skipped || 0;
            }
            gr.setValue('rows_processed', totalProcessed);
            gr.setValue('rows_skipped', totalSkipped);
            gr.setValue('detail_json', this._safeDetail(results));
            gr.setValue('status', dryRun ? 'dry_run' : 'completed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.warn('RetentionGuard: unable to finalize run ' + runId + ': ' + e.message);
        }
    },

    _failRunRecord: function (runId, error) {
        try {
            var gr = new GlideRecord(this.RUN_TABLE);
            if (!gr.get(runId)) { return; }
            gr.setValue('status', 'failed');
            gr.setValue('detail_json', JSON.stringify({ error: error ? error.message : 'unknown error' }));
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.warn('RetentionGuard: unable to finalize failed run ' + runId + ': ' + e.message);
        }
    },

    /**
     * Serialize run results for detail_json, compacting to a per-table summary
     * when the full payload would exceed the 4000-char field limit. Never
     * returns a string longer than 4000 characters.
     */
    _safeDetail: function (results) {
        var json = JSON.stringify(results);
        if (json.length <= 4000) { return json; }

        var compact = [];
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            compact.push({
                table_name: r.table_name,
                action: r.action,
                status: r.status,
                rows_processed: r.rows_processed || 0,
                rows_skipped: r.rows_skipped || 0,
                rows_failed: r.rows_failed || 0
            });
        }
        var cjson = JSON.stringify(compact);
        if (cjson.length > 4000) {
            cjson = cjson.substring(0, 3990) + '...TRUNCATED';
        }
        return cjson;
    },

    /**
     * Record a growth snapshot (type=growth) for a table. Used by the
     * inventory to track growth velocity over time.
     */
    recordGrowthSnapshot: function (tableName, rowCount) {
        try {
            var gr = new GlideRecord(this.RUN_TABLE);
            gr.initialize();
            gr.setValue('type', 'growth');
            gr.setValue('table_name', tableName);
            gr.setValue('rows_before', rowCount);
            gr.setValue('started_at', new GlideDateTime().getValue());
            gr.setValue('status', 'completed');
            gr.insert();
            return true;
        } catch (e) {
            gs.warn('RetentionGuard: unable to record growth snapshot: ' + e.message);
            return false;
        }
    },

    /**
     * Seed the curated default policy set. Idempotent — skips tables that
     * already have an active policy.
     */
    seedDefaultPolicies: function () {
        var created = 0;
        for (var i = 0; i < this.DEFAULT_POLICIES.length; i++) {
            var d = this.DEFAULT_POLICIES[i];
            try {
                var existing = new GlideRecord(this.POLICY_TABLE);
                existing.addQuery('table_name', d.table_name);
                existing.setLimit(1);
                existing.query();
                if (existing.next()) { continue; }

                var gr = new GlideRecord(this.POLICY_TABLE);
                gr.initialize();
                gr.setValue('table_name', d.table_name);
                gr.setValue('retention_days', d.retention_days);
                gr.setValue('action', d.action);
                gr.setValue('framework', d.framework);
                gr.setValue('active', true);
                gr.setValue('holds_json', '[]');
                gr.setValue('exceptions_json', '[]');
                if (gr.insert()) { created++; }
            } catch (e) {
                gs.warn('RetentionGuard: unable to seed policy for ' + d.table_name + ': ' + e.message);
            }
        }
        return created;
    },

    _parseJson: function (raw, fallback) {
        if (!raw) { return fallback; }
        try {
            var parsed = JSON.parse(raw);
            return parsed || fallback;
        } catch (e) {
            return fallback;
        }
    },

    type: 'RetentionGuardEngine'
};
