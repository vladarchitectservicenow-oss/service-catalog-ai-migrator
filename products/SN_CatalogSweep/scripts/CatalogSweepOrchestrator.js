// CatalogSweep — CatalogSweepOrchestrator
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Governed retirement workflow engine. Stages items for retirement, creates
// the approval change record, re-verifies the dependency graph at approval
// time (TOCTOU guard), and archives (deactivate + snapshot) — never deletes.
// Retirement state is tracked on the finding record itself (state +
// change_request + snapshot columns) to keep the scoped schema to two tables.
// Also owns the machine-readable export and dashboard aggregation.
// @class CatalogSweepOrchestrator @namespace x_catalog_sweep
var CatalogSweepOrchestrator = Class.create();
CatalogSweepOrchestrator.prototype = {

    FINDING_TABLE: 'x_catalog_sweep_item_finding',

    // Retirement state values (stored on the finding record's `state` field).
    STATE_ACTIVE: 'active',
    STATE_STAGED: 'staged',
    STATE_PENDING_APPROVAL: 'pending_approval',
    STATE_APPROVED: 'approved',
    STATE_ARCHIVED: 'archived',
    STATE_BLOCKED: 'blocked',

    initialize: function () {
        this._scanner = new CatalogSweepScanner();
    },

    // ----------------------------------------------------------------------
    // Stage an item for retirement. Creates the approval change_request and
    // marks the finding staged (attaching dependency evidence).
    // ----------------------------------------------------------------------
    stage: function (itemSysId, requestedBy) {
        var finding = this._scanner.getFinding(itemSysId);
        if (!finding) {
            return { ok: false, error: 'NO_FINDING', message: 'No finding for item ' + itemSysId };
        }
        if (finding.bucket !== 'safe_to_retire' && finding.bucket !== 'needs_review') {
            return { ok: false, error: 'NOT_RETIRABLE', message: 'Item is blocked and cannot be staged' };
        }

        // Create the approval change request.
        var changeSysId = this._createChangeRequest(itemSysId, finding);

        // Update the finding record with retirement state.
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (!gr.get(finding.sys_id)) {
            return { ok: false, error: 'FINDING_NOT_FOUND', message: 'Finding record not found' };
        }
        gr.setValue('state', this.STATE_PENDING_APPROVAL);
        gr.setValue('change_request', changeSysId);
        gr.setValue('requested_by', requestedBy || gs.getUserName());
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('CatalogSweepOrchestrator.stage: update failed: ' + e.message);
            return { ok: false, error: 'UPDATE_FAILED', message: e.message };
        }

        return { ok: true, finding_sys_id: finding.sys_id, change_request: changeSysId, item_sys_id: itemSysId };
    },

    _createChangeRequest: function (itemSysId, finding) {
        var gr = new GlideRecord('change_request');
        gr.initialize();
        gr.setValue('type', 'normal');
        gr.setValue('short_description', 'CatalogSweep retirement: ' + finding.item_name);
        gr.setValue('description',
            'CatalogSweep staged this catalog item for retirement.\n' +
            'Item: ' + finding.item_name + ' (' + itemSysId + ')\n' +
            'Category: ' + finding.category + '\n' +
            'Score: ' + finding.score + ' / bucket: ' + finding.bucket);
        var changeSysId = null;
        try {
            changeSysId = gr.insert();
        } catch (e) {
            gs.error('CatalogSweepOrchestrator._createChangeRequest: insert failed: ' + e.message);
            return null;
        }
        return changeSysId;
    },

    // ----------------------------------------------------------------------
    // Approve a staged retirement. Re-runs the dependency trace (TOCTOU
    // guard) and blocks archiving if the item gained a live dependency.
    // `findingSysId` identifies the finding record (the task identity).
    // ----------------------------------------------------------------------
    approve: function (findingSysId, approvedBy) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (!gr.get(findingSysId)) {
            return { ok: false, error: 'FINDING_NOT_FOUND', message: 'Finding not found: ' + findingSysId };
        }

        var itemSysId = gr.getValue('item_sys_id');
        var itemType = gr.getValue('item_type') || 'catalog_item';

        // TOCTOU re-check: fresh dependency trace.
        var deps = this._scanner._traceDependencies(itemSysId, itemType);
        var blocking = 0;
        for (var i = 0; i < deps.length; i++) {
            if (deps[i].blocking === true) { blocking++; }
        }

        if (blocking > 0) {
            gr.setValue('state', this.STATE_BLOCKED);
            gr.setValue('approved_by', approvedBy || gs.getUserName());
            try {
                gr.setWorkflow(false);
                gr.update();
            } catch (e) { /* ignore */ }
            return { ok: false, error: 'DEPENDENCY_ADDED', message: 'Item gained ' + blocking + ' live dependency since staging; archive blocked', blocking_count: blocking };
        }

        gr.setValue('state', this.STATE_APPROVED);
        gr.setValue('approved_by', approvedBy || gs.getUserName());
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('CatalogSweepOrchestrator.approve: update failed: ' + e.message);
            return { ok: false, error: 'UPDATE_FAILED', message: e.message };
        }

        // Proceed to archive.
        return this.archive(itemSysId, findingSysId);
    },

    // ----------------------------------------------------------------------
    // Archive: snapshot the item, set active=false, persist the snapshot on
    // the finding record. Never deletes. Reversible by design.
    // ----------------------------------------------------------------------
    archive: function (itemSysId, findingSysId) {
        var itemType = this._detectItemType(itemSysId);
        var snapshot = this._snapshotItem(itemSysId, itemType);
        if (!snapshot) {
            return { ok: false, error: 'ITEM_NOT_FOUND', message: 'Could not read item ' + itemSysId + ' for snapshot' };
        }

        // Deactivate the item (reversible).
        this._deactivateItem(itemSysId, itemType);

        // Persist the archive snapshot on the finding record.
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (!gr.get(findingSysId)) {
            return { ok: false, error: 'FINDING_NOT_FOUND', message: 'Finding record not found' };
        }
        gr.setValue('state', this.STATE_ARCHIVED);
        gr.setValue('snapshot', JSON.stringify(snapshot));
        gr.setValue('archived_on', new GlideDateTime().getValue());
        try {
            gr.setWorkflow(false);
            gr.update();
        } catch (e) {
            gs.error('CatalogSweepOrchestrator.archive: update failed: ' + e.message);
            return { ok: false, error: 'UPDATE_FAILED', message: e.message };
        }

        return { ok: true, finding_sys_id: findingSysId, item_sys_id: itemSysId, item_type: itemType };
    },

    _detectItemType: function (itemSysId) {
        var gr = new GlideRecord('sc_cat_item');
        if (gr.get(itemSysId)) { return 'catalog_item'; }
        var pr = new GlideRecord('sc_cat_item_producer');
        if (pr.get(itemSysId)) { return 'producer'; }
        var gu = new GlideRecord('sc_cat_item_guide');
        if (gu.get(itemSysId)) { return 'guide'; }
        return 'catalog_item';
    },

    _snapshotItem: function (itemSysId, itemType) {
        var table = this._tableForType(itemType);
        var gr = new GlideRecord(table);
        if (!gr.get(itemSysId)) { return null; }

        var snapshot = { sys_id: itemSysId, item_type: itemType, table: table };
        var fieldNames = gr.getElements();
        for (var i = 0; i < fieldNames.length; i++) {
            var name = fieldNames[i];
            var value = gr.getValue(name);
            if (value !== null && value !== undefined) {
                snapshot[name] = value;
            }
        }
        return snapshot;
    },

    _tableForType: function (itemType) {
        if (itemType === 'producer') { return 'sc_cat_item_producer'; }
        if (itemType === 'guide') { return 'sc_cat_item_guide'; }
        return 'sc_cat_item';
    },

    _deactivateItem: function (itemSysId, itemType) {
        var table = this._tableForType(itemType);
        var gr = new GlideRecord(table);
        if (gr.get(itemSysId)) {
            gr.setValue('active', false);
            try {
                gr.setWorkflow(false);
                gr.update();
            } catch (e) {
                gs.error('CatalogSweepOrchestrator._deactivateItem: failed: ' + e.message);
            }
        }
    },

    // ----------------------------------------------------------------------
    // Machine-readable export: full finding + dependency set as stable JSON.
    // ----------------------------------------------------------------------
    exportFull: function () {
        var findings = this._scanner.listFindings({});
        var enriched = [];
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            var detail = this._scanner.getFinding(f.item_sys_id);
            enriched.push({
                item_sys_id: detail.item_sys_id,
                item_name: detail.item_name,
                item_type: detail.item_type,
                category: detail.category,
                score: detail.score,
                bucket: detail.bucket,
                state: detail.state,
                dependencies: detail.dependencies,
                evidence: detail.evidence
            });
        }

        return {
            schema_version: '1.0',
            generated_at: new GlideDateTime().getValue(),
            scope: 'x_catalog_sweep',
            counts: {
                total_findings: enriched.length,
                safe_to_retire: this._countBucket(enriched, 'safe_to_retire'),
                needs_review: this._countBucket(enriched, 'needs_review'),
                blocked: this._countBucket(enriched, 'blocked')
            },
            findings: enriched
        };
    },

    _countBucket: function (findings, bucket) {
        var n = 0;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].bucket === bucket) { n++; }
        }
        return n;
    },

    // ----------------------------------------------------------------------
    // Dashboard aggregation: sprawl counts + duplicate clusters.
    // ----------------------------------------------------------------------
    dashboardSummary: function () {
        var findings = this._scanner.listFindings({});
        var categories = {};
        var buckets = { safe_to_retire: 0, needs_review: 0, blocked: 0 };
        for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            if (!categories[f.category]) { categories[f.category] = 0; }
            categories[f.category]++;
            if (buckets[f.bucket] !== undefined) { buckets[f.bucket]++; }
        }

        var clusters = this._scanner.clusterDuplicates();

        return {
            total_findings: findings.length,
            by_category: categories,
            by_bucket: buckets,
            duplicate_clusters: clusters.length,
            generated_at: new GlideDateTime().getValue()
        };
    },

    type: 'CatalogSweepOrchestrator'
};
