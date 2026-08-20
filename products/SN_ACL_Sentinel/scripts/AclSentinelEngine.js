// ACL Sentinel — AclSentinelEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic ACL audit engine. Implements the five detectors
// (least-privilege scoring, over-permissive, orphan/dead-rule,
// conflict, cross-environment drift) plus access-denied correlation.
// Pure GlideRecord logic — no LLM in the critical path.
// @class AclSentinelEngine @namespace x_sn_acl_sentinel

var AclSentinelEngine = Class.create();
AclSentinelEngine.prototype = {

    initialize: function () {
        this._aclTable = 'sys_security_acl';
        this._aclRoleTable = 'sys_security_acl_role';
        this._findingTable = 'x_sn_acl_sentinel_finding';
        this._scanTable = 'x_sn_acl_sentinel_scan';
        this._logTable = 'syslog';
    },

    /**
     * Run a full scan. Returns the scan sys_id, or null on failure.
     * @param {string} scanType - 'full' | 'delta'
     * @param {string} sourceEnv - environment label (dev/test/prod)
     * @return {string|null} scan sys_id
     */
    runScan: function (scanType, sourceEnv) {
        var scanId = this._createScan(scanType, sourceEnv);
        if (!scanId) {
            return null;
        }
        var acls;
        try {
            acls = this._collectAcls();
        } catch (e) {
            gs.error('AclSentinelEngine.runScan collection failed: ' + e.message);
            this._failScan(scanId, e.message);
            return null;
        }
        var counts = {
            over_permissive: this._detectOverPermissive(acls, scanId),
            orphan: this._detectOrphans(acls, scanId),
            conflict: this._detectConflicts(acls, scanId),
            access_denied: this._correlateAccessDenied(acls, scanId)
        };
        var scores = this._scoreTables(acls);
        this._finalizeScan(scanId, counts, scores);
        return scanId;
    },

    /**
     * Collect all ACLs with their roles into a normalized in-memory
     * structure. Conditions are read inline from sys_security_acl.condition
     * (there is no separate condition table in ServiceNow).
     * @return {Array} normalized ACL records
     */
    _collectAcls: function () {
        var acls = [];
        var gr = new GlideRecord(this._aclTable);
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            var acl = {
                sys_id: gr.getUniqueValue(),
                name: gr.getValue('name'),
                operation: gr.getValue('operation'),
                type: gr.getValue('type'),
                table_name: gr.getValue('name') ? this._extractTable(gr.getValue('name')) : '',
                condition: gr.getValue('condition') || '',
                script: gr.getValue('script') || '',
                requires_role: gr.getValue('requires_role') === 'true' || gr.getValue('requires_role') === '1',
                admin_overrides: gr.getValue('admin_overrides') === 'true' || gr.getValue('admin_overrides') === '1',
                roles: this._getRoles(gr.getUniqueValue())
            };
            acls.push(acl);
        }
        return acls;
    },

    /**
     * Extract the target table name from an ACL name.
     * sys_security_acl.name holds the table name ("incident") or a
     * field-level reference ("incident.short_description"). ServiceNow
     * table names never contain dots, so the first segment is the table.
     * @param {string} name - ACL name
     * @return {string} table name or empty string
     */
    _extractTable: function (name) {
        if (!name) {
            return '';
        }
        var idx = name.indexOf('.');
        if (idx <= 0) {
            return name;
        }
        return name.substring(0, idx);
    },

    /**
     * Fetch the role names required by an ACL.
     * sys_user_role is a reference field; getDisplayValue() returns the
     * role name rather than the 32-char sys_id.
     * @param {string} aclSysId - ACL sys_id
     * @return {Array} role names
     */
    _getRoles: function (aclSysId) {
        var roles = [];
        var gr = new GlideRecord(this._aclRoleTable);
        gr.addQuery('sys_security_acl', aclSysId);
        gr.query();
        while (gr.next()) {
            var role = gr.sys_user_role.getDisplayValue();
            if (role) {
                roles.push(role);
            }
        }
        return roles;
    },

    /**
     * Create a scan record and return its sys_id.
     * @param {string} scanType - 'full' | 'delta'
     * @param {string} sourceEnv - environment label
     * @return {string|null} scan sys_id
     */
    _createScan: function (scanType, sourceEnv) {
        try {
            var gr = new GlideRecord(this._scanTable);
            gr.initialize();
            gr.setValue('type', scanType || 'full');
            gr.setValue('source_env', sourceEnv || 'local');
            gr.setValue('status', 'running');
            gr.setValue('started_at', new GlideDateTime().getValue());
            return gr.insert();
        } catch (e) {
            gs.error('AclSentinelEngine._createScan failed: ' + e.message);
            return null;
        }
    },

    /**
     * Mark a scan as failed with an error message.
     * @param {string} scanId - scan sys_id
     * @param {string} message - error message
     */
    _failScan: function (scanId, message) {
        try {
            var gr = new GlideRecord(this._scanTable);
            if (!gr.get(scanId)) {
                return;
            }
            gr.setValue('status', 'failed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.update();
        } catch (e) {
            gs.error('AclSentinelEngine._failScan failed: ' + e.message);
        }
    },

    /**
     * Finalize a scan record with counts and per-table scores.
     * @param {string} scanId - scan sys_id
     * @param {Object} counts - finding counts by category
     * @param {Object} scores - per-table least-privilege scores
     */
    _finalizeScan: function (scanId, counts, scores) {
        try {
            var gr = new GlideRecord(this._scanTable);
            if (!gr.get(scanId)) {
                return;
            }
            gr.setValue('status', 'completed');
            gr.setValue('completed_at', new GlideDateTime().getValue());
            gr.setValue('over_permissive_count', counts.over_permissive || 0);
            gr.setValue('orphan_count', counts.orphan || 0);
            gr.setValue('conflict_count', counts.conflict || 0);
            gr.setValue('access_denied_count', counts.access_denied || 0);
            gr.setValue('scores_json', JSON.stringify(scores || {}));
            gr.update();
        } catch (e) {
            gs.error('AclSentinelEngine._finalizeScan failed: ' + e.message);
        }
    },

    /**
     * Detector 1 — Over-permissive ACLs.
     * Flags ACLs with a wildcard role, empty conditions, admin-only grants,
     * or no role required (public). Reports every applicable defect on an
     * ACL, not just the first.
     * @param {Array} acls - normalized ACL records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectOverPermissive: function (acls, scanId) {
        var count = 0;
        for (var i = 0; i < acls.length; i++) {
            var acl = acls[i];
            var reasons = [];
            if (this._hasWildcard(acl.roles)) {
                reasons.push({
                    reason: 'ACL grants access to wildcard role "' + (acl.roles.indexOf('*') >= 0 ? '*' : 'public') + '"',
                    suggestion: 'Replace wildcard role with a named role scoped to the least-privilege set of users.'
                });
            }
            if (!acl.condition && !acl.script) {
                reasons.push({
                    reason: 'ACL has no condition and no script (no row-level restriction)',
                    suggestion: 'Add a condition or script to scope the rule to the intended records.'
                });
            }
            if (acl.admin_overrides && acl.roles.length === 0) {
                reasons.push({
                    reason: 'ACL relies solely on admin_overrides with no explicit role',
                    suggestion: 'Assign an explicit role and disable admin_overrides unless required.'
                });
            }
            if (!acl.requires_role && acl.roles.length === 0) {
                reasons.push({
                    reason: 'ACL requires no role (public access)',
                    suggestion: 'Set requires_role=true and assign a named role to enforce least privilege.'
                });
            }
            for (var r = 0; r < reasons.length; r++) {
                this._createFinding(scanId, 'over_permissive', acl, reasons[r].reason, reasons[r].suggestion, 'high');
                count++;
            }
        }
        return count;
    },

    /**
     * Detector 2 — Orphan & dead rules.
     * Flags ACLs referencing non-existent tables, and rules fully shadowed
     * by a strictly-broader earlier rule on the same table+operation.
     * @param {Array} acls - normalized ACL records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectOrphans: function (acls, scanId) {
        var count = 0;
        var tableExists = {};
        for (var i = 0; i < acls.length; i++) {
            var acl = acls[i];
            var table = acl.table_name;
            if (!table) {
                this._createFinding(scanId, 'orphan', acl, 'ACL name has no parseable table reference', 'Rename the ACL to "<table>.<operation>" or retire it.', 'medium');
                count++;
                continue;
            }
            if (tableExists[table] === undefined) {
                tableExists[table] = this._tableExists(table);
            }
            if (!tableExists[table]) {
                this._createFinding(scanId, 'orphan', acl, 'ACL references non-existent table "' + table + '"', 'Retire the ACL or correct the table reference.', 'medium');
                count++;
            }
        }
        // Shadow detection: flag a rule only when an earlier rule on the same
        // table+operation is strictly broader (superset role / no condition).
        var seen = {};
        for (var j = 0; j < acls.length; j++) {
            var a = acls[j];
            var key = a.table_name + '|' + a.operation;
            if (seen[key] !== undefined && this._isShadowedBy(seen[key], a)) {
                this._createFinding(scanId, 'orphan', a, 'ACL is shadowed by a broader earlier rule on ' + a.table_name + '.' + a.operation, 'Review the rule pair and retire the redundant ACL.', 'low');
                count++;
            } else if (seen[key] === undefined) {
                seen[key] = a;
            }
        }
        return count;
    },

    /**
     * Determine whether an earlier ACL strictly shadows a later one.
     * Shadowing requires the earlier rule to be broader: a wildcard/no-role
     * grant where the later rule is role-scoped, or an unconditional rule
     * where the later rule adds a condition/script.
     * @param {Object} earlier - earlier ACL
     * @param {Object} later - later ACL
     * @return {boolean} true if earlier strictly shadows later
     */
    _isShadowedBy: function (earlier, later) {
        var earlierBroad = this._hasWildcard(earlier.roles) || earlier.roles.length === 0;
        var laterBroad = this._hasWildcard(later.roles) || later.roles.length === 0;
        var roleBroader = earlierBroad && !laterBroad;
        var condBroader = (!earlier.condition && !earlier.script) && (later.condition || later.script);
        return roleBroader || condBroader;
    },

    /**
     * Check whether a table exists in the instance.
     * @param {string} tableName - table name
     * @return {boolean} true if the table exists
     */
    _tableExists: function (tableName) {
        var gr = new GlideRecord('sys_db_object');
        gr.addQuery('name', tableName);
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    /**
     * Detector 3 — Conflict detection.
     * Identifies overlapping ACLs on the same table+operation with genuinely
     * contradictory requirements (same role, divergent condition/script).
     * @param {Array} acls - normalized ACL records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _detectConflicts: function (acls, scanId) {
        var count = 0;
        var byKey = {};
        for (var i = 0; i < acls.length; i++) {
            var acl = acls[i];
            var key = acl.table_name + '|' + acl.operation;
            if (!byKey[key]) {
                byKey[key] = [];
            }
            byKey[key].push(acl);
        }
        for (var k in byKey) {
            if (!byKey.hasOwnProperty(k)) {
                continue;
            }
            var group = byKey[k];
            if (group.length < 2) {
                continue;
            }
            for (var a = 0; a < group.length; a++) {
                for (var b = a + 1; b < group.length; b++) {
                    if (this._rolesContradict(group[a], group[b])) {
                        var detail = JSON.stringify({
                            rule_a: group[a].sys_id,
                            rule_b: group[b].sys_id,
                            roles_a: group[a].roles,
                            roles_b: group[b].roles
                        });
                        this._createFinding(scanId, 'conflict', group[a], 'Conflicting ACLs on ' + k + ' with contradictory requirements', 'Merge into a single least-privilege rule; keep the narrower role and add the missing condition.', 'high', detail);
                        count++;
                    }
                }
            }
        }
        return count;
    },

    /**
     * Determine whether two ACLs have genuinely contradictory requirements.
     * ServiceNow ACLs on the same table+operation are OR'd, so wildcard-vs-
     * scoped and empty-vs-nonempty role sets are normal layering, not
     * conflicts. A real conflict is two rules requiring the SAME role but
     * diverging on condition/script, making resolution ambiguous.
     * @param {Object} aclA - first ACL
     * @param {Object} aclB - second ACL
     * @return {boolean} true if contradictory
     */
    _rolesContradict: function (aclA, aclB) {
        var aRoles = (aclA.roles || []).slice().sort().join(',');
        var bRoles = (aclB.roles || []).slice().sort().join(',');
        if (aRoles !== bRoles) {
            return false;
        }
        if (aRoles === '') {
            return false;
        }
        var aCond = aclA.condition || aclA.script || '';
        var bCond = aclB.condition || aclB.script || '';
        return aCond !== bCond;
    },

    /**
     * Check whether a role list contains a wildcard.
     * @param {Array} roles - role names
     * @return {boolean} true if wildcard present
     */
    _hasWildcard: function (roles) {
        for (var i = 0; i < roles.length; i++) {
            if (roles[i] === '*' || roles[i] === 'public') {
                return true;
            }
        }
        return false;
    },

    /**
     * Detector 4 — Access-denied correlation.
     * Joins syslog access-denied entries against the ACL set to surface
     * actual breakage (a real user blocked by a real rule).
     * @param {Array} acls - normalized ACL records
     * @param {string} scanId - scan sys_id
     * @return {number} findings created
     */
    _correlateAccessDenied: function (acls, scanId) {
        var count = 0;
        var gr = new GlideRecord(this._logTable);
        gr.addQuery('level', '2');
        gr.addQuery('message', 'CONTAINS', 'denied');
        gr.setLimit(1000);
        gr.query();
        while (gr.next()) {
            var message = gr.getValue('message') || '';
            var table = this._extractTableFromLog(message);
            if (!table) {
                continue;
            }
            var matched = this._findAclForTable(acls, table);
            if (matched) {
                this._createFinding(scanId, 'access_denied', matched, 'Access denied for table "' + table + '" correlates to an active ACL', 'Review the ACL and the denied user; tighten or relax the rule based on the intended policy.', 'high', message);
                count++;
            }
        }
        return count;
    },

    /**
     * Extract a table name from a syslog access-denied message.
     * @param {string} message - log message
     * @return {string} table name or empty string
     */
    _extractTableFromLog: function (message) {
        if (!message) {
            return '';
        }
        var m = message.match(/table[:=\s]+([a-z0-9_]+)/i);
        if (m && m[1]) {
            return m[1];
        }
        m = message.match(/on\s+([a-z0-9_]+)/i);
        if (m && m[1]) {
            return m[1];
        }
        m = message.match(/\b([a-z][a-z0-9_]{2,})\b/i);
        if (m && m[1]) {
            return m[1];
        }
        return '';
    },

    /**
     * Find the first ACL governing a table.
     * @param {Array} acls - normalized ACL records
     * @param {string} table - table name
     * @return {Object|null} matching ACL or null
     */
    _findAclForTable: function (acls, table) {
        for (var i = 0; i < acls.length; i++) {
            if (acls[i].table_name === table) {
                return acls[i];
            }
        }
        return null;
    },

    /**
     * Detector 5 — Least-privilege scoring.
     * Computes a 0-100 score per table as the average penalty across its
     * ACLs (normalized by ACL count), so a table with many clean ACLs and
     * one bad ACL scores higher than a table with a single bad ACL.
     * @param {Array} acls - normalized ACL records
     * @return {Object} map of table name to score
     */
    _scoreTables: function (acls) {
        var tables = {};
        for (var i = 0; i < acls.length; i++) {
            var acl = acls[i];
            var table = acl.table_name;
            if (!table) {
                continue;
            }
            if (!tables[table]) {
                tables[table] = { total: 0, penalties: 0 };
            }
            tables[table].total++;
            if (this._hasWildcard(acl.roles)) {
                tables[table].penalties += 30;
            }
            if (!acl.condition && !acl.script) {
                tables[table].penalties += 20;
            }
            if (acl.admin_overrides && acl.roles.length === 0) {
                tables[table].penalties += 15;
            }
            if (!acl.requires_role && acl.roles.length === 0) {
                tables[table].penalties += 25;
            }
        }
        var scores = {};
        for (var t in tables) {
            if (!tables.hasOwnProperty(t)) {
                continue;
            }
            var entry = tables[t];
            var raw = 100 - Math.round(entry.penalties / entry.total);
            scores[t] = raw < 0 ? 0 : raw;
        }
        return scores;
    },

    /**
     * Create a finding record.
     * @param {string} scanId - scan sys_id
     * @param {string} category - finding category
     * @param {Object} acl - source ACL
     * @param {string} reason - human-readable reason
     * @param {string} suggestion - remediation suggestion
     * @param {string} severity - 'high' | 'medium' | 'low'
     * @param {string} detail - optional JSON detail
     * @return {string|null} finding sys_id
     */
    _createFinding: function (scanId, category, acl, reason, suggestion, severity, detail) {
        try {
            var gr = new GlideRecord(this._findingTable);
            gr.initialize();
            gr.setValue('scan', scanId);
            gr.setValue('category', category);
            gr.setValue('acl_sys_id', acl.sys_id || '');
            gr.setValue('acl_name', acl.name || '');
            gr.setValue('table_name', acl.table_name || '');
            gr.setValue('operation', acl.operation || '');
            gr.setValue('reason', reason);
            gr.setValue('suggestion', suggestion);
            gr.setValue('severity', severity);
            gr.setValue('status', 'open');
            if (detail) {
                gr.setValue('detail_json', detail);
            }
            return gr.insert();
        } catch (e) {
            gs.error('AclSentinelEngine._createFinding failed: ' + e.message);
            return null;
        }
    },

    /**
     * Cross-environment drift diff.
     * Compares the local ACL set against a remote ACL set (fetched via
     * Table API by the caller) and returns a drift summary.
     * @param {Array} remoteAcls - normalized remote ACL records
     * @return {Object} drift summary { added, removed, changed, total }
     */
    diffEnvironments: function (remoteAcls) {
        var local = this._collectAcls();
        var localMap = this._indexByName(local);
        var remoteMap = this._indexByName(remoteAcls || []);
        var added = [];
        var removed = [];
        var changed = [];
        for (var r in remoteMap) {
            if (!remoteMap.hasOwnProperty(r)) {
                continue;
            }
            if (!localMap[r]) {
                added.push(r);
            } else if (this._fingerprint(localMap[r]) !== this._fingerprint(remoteMap[r])) {
                changed.push(r);
            }
        }
        for (var l in localMap) {
            if (!localMap.hasOwnProperty(l)) {
                continue;
            }
            if (!remoteMap[l]) {
                removed.push(l);
            }
        }
        return {
            added: added,
            removed: removed,
            changed: changed,
            total: added.length + removed.length + changed.length
        };
    },

    /**
     * Index ACLs by name.
     * @param {Array} acls - normalized ACL records
     * @return {Object} name -> ACL map
     */
    _indexByName: function (acls) {
        var map = {};
        for (var i = 0; i < acls.length; i++) {
            map[acls[i].name] = acls[i];
        }
        return map;
    },

    /**
     * Compute a stable fingerprint for an ACL (roles + condition + script).
     * @param {Object} acl - normalized ACL record
     * @return {string} fingerprint
     */
    _fingerprint: function (acl) {
        var roles = (acl.roles || []).slice().sort().join(',');
        return [roles, acl.condition || '', acl.script || ''].join('|');
    },

    type: 'AclSentinelEngine'
};
