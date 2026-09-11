// DedupeGuard — DedupeGuardMerge
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Safe merge engine. Re-points child records (reference fields discovered via
// sys_dictionary introspection) from the loser record to the survivor, flags
// the loser inactive (never hard-deletes), and writes a full before/after
// snapshot to x_snc_ddg_merge for audit and rollback.
//
// @class DedupeGuardMerge
// @namespace x_snc_ddg
var DedupeGuardMerge = Class.create();
DedupeGuardMerge.prototype = {

    initialize: function () {
        this._config = this._loadConfig();
    },

    _loadConfig: function () {
        var cfg = {};
        cfg.protectedTables = this._propStr('x_snc_ddg.merge.protected_tables',
            'sys_user,cmdb_ci,sys_user_group');
        cfg.maxRepoint = this._propNum('x_snc_ddg.merge.max_repoint', 5000);
        return cfg;
    },

    _propStr: function (name, def) {
        var v = gs.getProperty(name);
        return (v === null || v === undefined || v === '') ? def : v;
    },

    _propNum: function (name, def) {
        var v = gs.getProperty(name);
        if (v === null || v === undefined || v === '') {
            return def;
        }
        var n = parseFloat(v);
        return isNaN(n) ? def : n;
    },

    // ------------------------------------------------------------------
    // Public entry point — merge a candidate pair
    //   tableName: source table of the duplicate records
    //   survivor:  sys_id of the record to keep
    //   loser:     sys_id of the record to deactivate
    //   actor:     sys_id of the user performing the merge
    // ------------------------------------------------------------------
    merge: function (tableName, survivor, loser, actor) {
        if (!tableName || !survivor || !loser) {
            return { ok: false, error: 'tableName, survivor, and loser are required' };
        }
        if (survivor === loser) {
            return { ok: false, error: 'survivor and loser must differ' };
        }

        var protectedTables = this._config.protectedTables.split(',');
        for (var i = 0; i < protectedTables.length; i++) {
            if (protectedTables[i].trim() === tableName) {
                return { ok: false, error: 'table ' + tableName + ' is protected from auto-merge' };
            }
        }

        // Discover reference fields pointing at this table.
        var refFields = this._discoverReferenceFields(tableName);
        var repointed = [];
        var totalRepointed = 0;

        for (var f = 0; f < refFields.length; f++) {
            var rf = refFields[f];
            var count = this._repoint(rf.table, rf.field, loser, survivor);
            if (count > 0) {
                repointed.push({ table: rf.table, field: rf.field, count: count });
                totalRepointed += count;
            }
        }

        // Flag the loser inactive (never hard-delete).
        var loserFlagged = this._flagLoser(tableName, loser);

        // Write the audit snapshot.
        var mergeSysId = this._writeAudit(tableName, survivor, loser, actor, repointed, totalRepointed);

        return {
            ok: true,
            merge_sys_id: mergeSysId,
            survivor: survivor,
            loser: loser,
            repointed_fields: repointed,
            total_repointed: totalRepointed,
            loser_flagged: loserFlagged
        };
    },

    // ------------------------------------------------------------------
    // Reference-field discovery via sys_dictionary introspection.
    // Matches both single-reference and multi-reference (glide_list) fields.
    // ------------------------------------------------------------------
    _discoverReferenceFields: function (tableName) {
        var fields = [];
        var gr = new GlideRecord('sys_dictionary');
        gr.addQuery('internal_type', 'IN', 'reference,glide_list');
        gr.addQuery('reference', tableName);
        gr.addQuery('name', '!=', tableName);
        gr.query();
        while (gr.next()) {
            var refTable = gr.getValue('name');
            var element = gr.getValue('element');
            if (refTable && element) {
                fields.push({ table: refTable, field: element });
            }
        }
        return fields;
    },

    // ------------------------------------------------------------------
    // Re-point one reference field from loser to survivor (bounded)
    // ------------------------------------------------------------------
    _repoint: function (refTable, refField, loser, survivor) {
        var count = 0;
        var gr = new GlideRecord(refTable);
        gr.addQuery(refField, loser);
        gr.setLimit(this._config.maxRepoint);
        gr.query();
        while (gr.next()) {
            try {
                gr.setValue(refField, survivor);
                if (gr.update()) {
                    count++;
                }
            } catch (e) {
                gs.error('x_snc_ddg repoint failed on ' + refTable + '.' + refField + ': ' + e.message);
            }
        }
        return count;
    },

    // ------------------------------------------------------------------
    // Flag the loser inactive — preserve history, never hard-delete.
    // Handles tables that use `active` (sys_user, incident, task) and
    // tables that use `install_status` (cmdb_ci).
    // ------------------------------------------------------------------
    _flagLoser: function (tableName, loser) {
        var gr = new GlideRecord(tableName);
        if (!gr.get(loser)) {
            return false;
        }
        try {
            if (gr.isValidField('active')) {
                gr.setValue('active', false);
            } else if (gr.isValidField('install_status')) {
                gr.setValue('install_status', 'retired');
            }
            return gr.update();
        } catch (e) {
            gs.error('x_snc_ddg flag loser failed: ' + e.message);
            return false;
        }
    },

    // ------------------------------------------------------------------
    // Audit snapshot — before/after for rollback
    // ------------------------------------------------------------------
    _writeAudit: function (tableName, survivor, loser, actor, repointed, totalRepointed) {
        try {
            var gr = new GlideRecord('x_snc_ddg_merge');
            gr.initialize();
            gr.setValue('table_name', tableName);
            gr.setValue('survivor', survivor);
            gr.setValue('loser', loser);
            gr.setValue('actor', actor);
            gr.setValue('repointed_fields', JSON.stringify(repointed));
            gr.setValue('total_repointed', totalRepointed);
            gr.setValue('state', 'merged');
            gr.setValue('merged_on', new GlideDateTime().toString());
            var sysId = gr.insert();
            return sysId || '';
        } catch (e) {
            gs.error('x_snc_ddg write audit failed: ' + e.message);
            return '';
        }
    },

    // ------------------------------------------------------------------
    // Rollback — reverse a merge by re-pointing back and reactivating
    // ------------------------------------------------------------------
    rollback: function (mergeSysId, actor) {
        var mgr = new GlideRecord('x_snc_ddg_merge');
        if (!mgr.get(mergeSysId)) {
            return { ok: false, error: 'merge record not found: ' + mergeSysId };
        }

        var tableName = mgr.getValue('table_name');
        var survivor = mgr.getValue('survivor');
        var loser = mgr.getValue('loser');
        var repointed = this._parseRepointed(mgr.getValue('repointed_fields'));

        var reversed = [];
        var totalReversed = 0;
        for (var i = 0; i < repointed.length; i++) {
            var rf = repointed[i];
            var count = this._repoint(rf.table, rf.field, survivor, loser);
            if (count > 0) {
                reversed.push({ table: rf.table, field: rf.field, count: count });
                totalReversed += count;
            }
        }

        // Reactivate the loser.
        var reactivated = this._reactivateLoser(tableName, loser);

        try {
            mgr.setValue('state', 'rolled_back');
            mgr.setValue('rolled_back_on', new GlideDateTime().toString());
            mgr.setValue('rolled_back_by', actor);
            mgr.update();
        } catch (e) {
            gs.error('x_snc_ddg rollback state update failed: ' + e.message);
        }

        return {
            ok: true,
            merge_sys_id: mergeSysId,
            reversed_fields: reversed,
            total_reversed: totalReversed,
            loser_reactivated: reactivated
        };
    },

    _parseRepointed: function (json) {
        if (!json) {
            return [];
        }
        try {
            var parsed = JSON.parse(json);
            return parsed || [];
        } catch (e) {
            return [];
        }
    },

    _reactivateLoser: function (tableName, loser) {
        var gr = new GlideRecord(tableName);
        if (!gr.get(loser)) {
            return false;
        }
        try {
            if (gr.isValidField('active')) {
                gr.setValue('active', true);
            } else if (gr.isValidField('install_status')) {
                gr.setValue('install_status', 'installed');
            }
            return gr.update();
        } catch (e) {
            gs.error('x_snc_ddg reactivate loser failed: ' + e.message);
            return false;
        }
    },

    type: 'DedupeGuardMerge'
};
