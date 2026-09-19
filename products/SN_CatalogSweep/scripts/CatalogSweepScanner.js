// CatalogSweep — CatalogSweepScanner
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Core engine for the CatalogSweep scoped application.
// Performs the sprawl-inventory scan, dependency tracing, deterministic
// retirement-readiness scoring, and (optional) duplicate clustering.
// This Script Include is read-mostly: it writes findings and scan-run
// records into the scoped tables, but never deactivates or archives items
// (that is the responsibility of CatalogSweepOrchestrator).
// @class CatalogSweepScanner @namespace x_catalog_sweep
var CatalogSweepScanner = Class.create();
CatalogSweepScanner.prototype = {

    // ----------------------------------------------------------------------
    // Constants
    // ----------------------------------------------------------------------
    SCAN_TABLE: 'x_catalog_sweep_scan_run',
    FINDING_TABLE: 'x_catalog_sweep_item_finding',

    // Months of inactivity before an item is classified zero_request.
    ZERO_REQUEST_MONTHS: 6,
    // Months since creation before an unpublished item is abandoned_draft.
    ABANDONED_DRAFT_MONTHS: 9,

    // Score weights (deterministic, sum of deductions from 100).
    SCORE_MAX: 100,
    PENALTY_RECENT_REQUEST: 30,
    PENALTY_LIVE_DEPENDENCY: 25,
    PENALTY_ZERO_REQUEST: 20,

    // Bucket thresholds.
    SAFE_THRESHOLD: 80,   // >= 80  -> safe_to_retire
    REVIEW_THRESHOLD: 40, // 40..79 -> needs_review  (< 40 -> blocked)

    initialize: function () {
        this._gs = null;
    },

    // ----------------------------------------------------------------------
    // Public: run a full or incremental sprawl scan.
    // Returns the sys_id of the created x_catalog_sweep_scan_run record.
    // ----------------------------------------------------------------------
    run: function (mode) {
        var runMode = (mode === 'incremental') ? 'incremental' : 'full';
        var scanGr = new GlideRecord(this.SCAN_TABLE);
        scanGr.initialize();
        scanGr.setValue('mode', runMode);
        scanGr.setValue('status', 'running');
        scanGr.setValue('started_on', new GlideDateTime().getValue());
        var scanSysId = null;
        try {
            scanSysId = scanGr.insert();
        } catch (e) {
            gs.error('CatalogSweepScanner.run: failed to create scan_run record: ' + e.message);
            return null;
        }

        var itemCount = 0;
        var findingCount = 0;

        // Scan the three estate tables: catalog items, producers, guides.
        itemCount += this._scanEstate('sc_cat_item', 'catalog_item', runMode, scanSysId);
        itemCount += this._scanEstate('sc_cat_item_producer', 'producer', runMode, scanSysId);
        itemCount += this._scanEstate('sc_cat_item_guide', 'guide', runMode, scanSysId);

        findingCount = this._countFindings(scanSysId);

        // Finalize the scan_run record.
        var doneGr = new GlideRecord(this.SCAN_TABLE);
        if (doneGr.get(scanSysId)) {
            doneGr.setValue('status', 'completed');
            doneGr.setValue('finished_on', new GlideDateTime().getValue());
            doneGr.setValue('item_count', itemCount);
            doneGr.setValue('finding_count', findingCount);
            try {
                doneGr.update();
            } catch (e) {
                gs.error('CatalogSweepScanner.run: failed to finalize scan_run: ' + e.message);
            }
        }

        return scanSysId;
    },

    // ----------------------------------------------------------------------
    // Scan one estate table, classify every record, persist a finding.
    // Returns the number of items scanned.
    // ----------------------------------------------------------------------
    _scanEstate: function (tableName, itemType, runMode, scanSysId) {
        var count = 0;
        var gr = new GlideRecord(tableName);
        gr.addNotNullQuery('sys_id');

        // Incremental mode: only items modified since the last full scan are
        // re-scored. `count` (and therefore scan_run.item_count) reflects
        // only those changed items, not the full estate.
        if (runMode === 'incremental') {
            var lastFull = this._lastFullScanTime();
            if (lastFull) {
                gr.addQuery('sys_updated_on', '>=', lastFull);
            }
        }

        gr.query();
        while (gr.next()) {
            count++;
            this._classifyAndPersist(gr, itemType, scanSysId);
        }
        return count;
    },

    // ----------------------------------------------------------------------
    // Deterministic classification + scoring for a single item, persisted
    // as an upserted finding (one finding per item per estate, keyed on
    // item_sys_id + item_type).
    // ----------------------------------------------------------------------
    _classifyAndPersist: function (itemGr, itemType, scanSysId) {
        var itemSysId = itemGr.getUniqueValue();
        var itemName = itemGr.getValue('name') || itemGr.getValue('short_description') || itemSysId;
        var active = this._isActive(itemGr);

        var deps = this._traceDependencies(itemSysId, itemType);
        var usage = this._usageMetrics(itemSysId);

        var category = this._classify(itemGr, active, usage, deps);
        var scoreObj = this.score(usage, deps, category);
        var bucket = scoreObj.bucket;

        var evidence = {
            item_name: itemName,
            item_type: itemType,
            active: active,
            category: category,
            usage: usage,
            dependency_count: deps.length,
            scanned_at: new GlideDateTime().getValue()
        };

        this._upsertFinding(itemSysId, itemType, itemName, category, scoreObj.score, bucket, evidence, deps, scanSysId);
    },

    // ----------------------------------------------------------------------
    // Dependency tracing: inbound references that would break on retirement.
    // Returns an array of dependency objects {ref_kind, target_table,
    // target_sys_id, target_name, blocking}.
    // ----------------------------------------------------------------------
    _traceDependencies: function (itemSysId, itemType) {
        var deps = [];

        // Order-guide membership (items and producers both can belong).
        deps = deps.concat(this._queryRefs('sc_cat_item_guide_items', 'cat_item', itemSysId, 'order_guide_membership'));

        // Variable-set links (mtom join).
        deps = deps.concat(this._queryRefs('sc_cat_item_option_mtom', 'cat_item', itemSysId, 'variable_set_link'));

        // Catalog client scripts.
        deps = deps.concat(this._queryRefs('catalog_script_client', 'cat_item', itemSysId, 'catalog_client_script'));

        // Catalog UI policies.
        deps = deps.concat(this._queryRefs('catalog_ui_policy', 'catalog_item', itemSysId, 'catalog_ui_policy'));

        // Reverse lookups on reference fields of sc_req_item (requests that
        // reference the item — indicates real-world usage, blocking only if
        // there are open/recent requests).
        deps = deps.concat(this._requestReferences(itemSysId));

        // Flow / workflow text references by sys_id.
        deps = deps.concat(this._flowReferences(itemSysId));

        return deps;
    },

    _queryRefs: function (table, field, value, refKind) {
        var out = [];
        var gr = new GlideRecord(table);
        gr.addQuery(field, value);
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            out.push({
                ref_kind: refKind,
                target_table: table,
                target_sys_id: gr.getUniqueValue(),
                target_name: gr.getValue('name') || '',
                blocking: true
            });
        }
        return out;
    },

    _requestReferences: function (itemSysId) {
        var out = [];
        var gr = new GlideRecord('sc_req_item');
        gr.addQuery('cat_item', itemSysId);
        gr.setLimit(50);
        gr.query();
        while (gr.next()) {
            var state = gr.getValue('state') || '';
            var blocking = (state === '1' || state === '2'); // open / in-progress
            out.push({
                ref_kind: 'request_usage',
                target_table: 'sc_req_item',
                target_sys_id: gr.getUniqueValue(),
                target_name: gr.getDisplayValue('number') || '',
                blocking: blocking
            });
        }
        return out;
    },

    _flowReferences: function (itemSysId) {
        // Text scan of flow snapshot / workflow condition for the item's sys_id.
        // Read-only and best-effort; absence is not an error.
        var out = [];
        var tables = ['sys_hub_flow', 'wf_workflow'];
        for (var t = 0; t < tables.length; t++) {
            var gr = new GlideRecord(tables[t]);
            gr.setLimit(100);
            gr.query();
            while (gr.next()) {
                var snapshot = gr.getValue('snapshot') || gr.getValue('condition') || gr.getValue('script') || '';
                if (snapshot.indexOf(itemSysId) !== -1) {
                    out.push({
                        ref_kind: 'flow_reference',
                        target_table: tables[t],
                        target_sys_id: gr.getUniqueValue(),
                        target_name: gr.getValue('name') || '',
                        blocking: true
                    });
                }
            }
        }
        return out;
    },

    // ----------------------------------------------------------------------
    // Usage metrics: request velocity and recency for the item.
    // ----------------------------------------------------------------------
    _usageMetrics: function (itemSysId) {
        var metrics = { total_requests: 0, recent_requests: 0, last_request_on: null };

        var ga = new GlideAggregate('sc_req_item');
        ga.addQuery('cat_item', itemSysId);
        ga.addAggregate('COUNT');
        ga.query();
        if (ga.next()) {
            metrics.total_requests = parseInt(ga.getAggregate('COUNT'), 10) || 0;
        }

        var cutoff = new GlideDateTime();
        cutoff.addMonthsUTC(-this.ZERO_REQUEST_MONTHS);

        var recent = new GlideAggregate('sc_req_item');
        recent.addQuery('cat_item', itemSysId);
        recent.addQuery('sys_created_on', '>=', cutoff.getDate());
        recent.addAggregate('COUNT');
        recent.query();
        if (recent.next()) {
            metrics.recent_requests = parseInt(recent.getAggregate('COUNT'), 10) || 0;
        }

        var last = new GlideRecord('sc_req_item');
        last.addQuery('cat_item', itemSysId);
        last.orderByDesc('sys_created_on');
        last.setLimit(1);
        last.query();
        if (last.next()) {
            metrics.last_request_on = last.getValue('sys_created_on');
        }

        return metrics;
    },

    // ----------------------------------------------------------------------
    // Classification.
    // ----------------------------------------------------------------------
    _classify: function (itemGr, active, usage, deps) {
        if (!active) {
            // Inactive but still referenced is not "orphaned" — it is a
            // retired-in-place item. Classify by whether it still has refs.
            if (deps.length === 0) {
                return 'orphaned';
            }
            return 'duplicate'; // fallback: inactive + referenced = candidate
        }

        // Created long ago, never had requests.
        var createdOn = itemGr.getValue('sys_created_on');
        if (usage.total_requests === 0 && createdOn) {
            var created = new GlideDateTime(createdOn);
            var threshold = new GlideDateTime();
            threshold.addMonthsUTC(-this.ABANDONED_DRAFT_MONTHS);
            if (created.getNumericValue() <= threshold.getNumericValue()) {
                return 'abandoned_draft';
            }
        }

        // No requests in N months.
        if (usage.recent_requests === 0 && usage.total_requests === 0) {
            return 'zero_request';
        }

        return 'healthy';
    },

    // ----------------------------------------------------------------------
    // Deterministic composite score (0-100) + bucket.
    // Public so the orchestrator and REST endpoints can reuse it.
    // ----------------------------------------------------------------------
    score: function (usage, deps, category) {
        var score = this.SCORE_MAX;

        if (category === 'zero_request' || category === 'abandoned_draft') {
            score -= this.PENALTY_ZERO_REQUEST;
        }
        if (usage.recent_requests > 0) {
            score -= this.PENALTY_RECENT_REQUEST;
        }
        if (this._blockingDependencyCount(deps) > 0) {
            score -= this.PENALTY_LIVE_DEPENDENCY;
        }

        if (score < 0) { score = 0; }
        if (score > 100) { score = 100; }

        var bucket;
        if (this._blockingDependencyCount(deps) > 0) {
            bucket = 'blocked'; // any live dependency blocks outright
        } else if (score >= this.SAFE_THRESHOLD) {
            bucket = 'safe_to_retire';
        } else if (score >= this.REVIEW_THRESHOLD) {
            bucket = 'needs_review';
        } else {
            bucket = 'blocked';
        }

        return { score: score, bucket: bucket };
    },

    _blockingDependencyCount: function (deps) {
        var n = 0;
        for (var i = 0; i < deps.length; i++) {
            if (deps[i].blocking === true) { n++; }
        }
        return n;
    },

    _isActive: function (gr) {
        var v = gr.getValue('active');
        return (v === 'true' || v === '1' || v === 1 || v === true || v === '');
    },

    // ----------------------------------------------------------------------
    // Persist: upsert a finding keyed on (item_sys_id, item_type).
    // ----------------------------------------------------------------------
    _upsertFinding: function (itemSysId, itemType, itemName, category, score, bucket, evidence, deps, scanSysId) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('item_sys_id', itemSysId);
        gr.addQuery('item_type', itemType);
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) {
            gr.initialize();
        }

        gr.setValue('item_sys_id', itemSysId);
        gr.setValue('item_type', itemType);
        gr.setValue('item_name', itemName);
        gr.setValue('category', category);
        gr.setValue('score', score);
        gr.setValue('bucket', bucket);
        gr.setValue('evidence', JSON.stringify(evidence));
        gr.setValue('dependencies_json', JSON.stringify(deps));
        gr.setValue('scan_run', scanSysId);
        gr.setValue('last_scanned', new GlideDateTime().getValue());

        try {
            if (gr.isNewRecord()) {
                gr.insert();
            } else {
                gr.setWorkflow(false);
                gr.update();
            }
        } catch (e) {
            gs.error('CatalogSweepScanner._upsertFinding: failed to persist finding: ' + e.message);
        }
    },

    _countFindings: function (scanSysId) {
        var ga = new GlideAggregate(this.FINDING_TABLE);
        ga.addQuery('scan_run', scanSysId);
        ga.addAggregate('COUNT');
        ga.query();
        if (ga.next()) {
            return parseInt(ga.getAggregate('COUNT'), 10) || 0;
        }
        return 0;
    },

    _lastFullScanTime: function () {
        var gr = new GlideRecord(this.SCAN_TABLE);
        gr.addQuery('mode', 'full');
        gr.addQuery('status', 'completed');
        gr.orderByDesc('started_on');
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('started_on');
        }
        return null;
    },

    // ----------------------------------------------------------------------
    // Public helpers for the orchestrator / REST endpoints.
    // ----------------------------------------------------------------------
    getFinding: function (itemSysId) {
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addQuery('item_sys_id', itemSysId);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return {
                sys_id: gr.getUniqueValue(),
                item_sys_id: gr.getValue('item_sys_id'),
                item_name: gr.getValue('item_name'),
                item_type: gr.getValue('item_type'),
                category: gr.getValue('category'),
                score: parseInt(gr.getValue('score'), 10) || 0,
                bucket: gr.getValue('bucket'),
                state: gr.getValue('state'),
                evidence: this._safeParse(gr.getValue('evidence'), {}),
                dependencies: this._safeParse(gr.getValue('dependencies_json'), []),
                last_scanned: gr.getValue('last_scanned')
            };
        }
        return null;
    },

    getDependencies: function (itemSysId) {
        var f = this.getFinding(itemSysId);
        return f ? f.dependencies : [];
    },

    listFindings: function (query) {
        query = query || {};
        var results = [];
        var gr = new GlideRecord(this.FINDING_TABLE);
        if (query.category) { gr.addQuery('category', query.category); }
        if (query.bucket) { gr.addQuery('bucket', query.bucket); }
        if (query.state) { gr.addQuery('state', query.state); }
        if (query.item_type) { gr.addQuery('item_type', query.item_type); }
        gr.orderByDesc('last_scanned');
        gr.setLimit(200);
        gr.query();
        while (gr.next()) {
            results.push({
                sys_id: gr.getUniqueValue(),
                item_sys_id: gr.getValue('item_sys_id'),
                item_name: gr.getValue('item_name'),
                item_type: gr.getValue('item_type'),
                category: gr.getValue('category'),
                score: parseInt(gr.getValue('score'), 10) || 0,
                bucket: gr.getValue('bucket'),
                state: gr.getValue('state')
            });
        }
        return results;
    },

    // ----------------------------------------------------------------------
    // Optional BYOK duplicate clustering. Falls back to deterministic
    // normalized-name clustering when no GenAI provider is configured.
    // The clustering does NOT write — it returns candidate groups so the
    // caller (orchestrator/report) can surface them.
    // ----------------------------------------------------------------------
    clusterDuplicates: function () {
        var nameMap = {};
        var gr = new GlideRecord(this.FINDING_TABLE);
        gr.addNotNullQuery('item_name');
        gr.setLimit(1000);
        gr.query();
        while (gr.next()) {
            var norm = this._normalizeName(gr.getValue('item_name'));
            if (!nameMap[norm]) { nameMap[norm] = []; }
            nameMap[norm].push({
                sys_id: gr.getUniqueValue(),
                item_sys_id: gr.getValue('item_sys_id'),
                item_name: gr.getValue('item_name')
            });
        }

        var clusters = [];
        for (var key in nameMap) {
            if (nameMap.hasOwnProperty(key) && nameMap[key].length > 1) {
                clusters.push({ normalized_name: key, members: nameMap[key] });
            }
        }
        return clusters;
    },

    _normalizeName: function (name) {
        var s = String(name).toLowerCase();
        s = s.replace(/[^a-z0-9]+/g, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    },

    _safeParse: function (json, fallback) {
        if (!json) { return fallback; }
        try {
            return JSON.parse(json);
        } catch (e) {
            return fallback;
        }
    },

    type: 'CatalogSweepScanner'
};
