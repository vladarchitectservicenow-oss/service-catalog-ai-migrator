// ChangeCollision Radar — CollisionRadarEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Deterministic collision detection and risk scoring engine for the change
// calendar. Reads change_request, cmdb_rel_ci, cmdb_ci, and blackout windows,
// resolves CI topology, detects overlapping change windows and freeze
// violations, computes a weighted 0-100 risk score, and writes snapshot rows
// to x_snc_ccr_collision and x_snc_ccr_risk.
//
// @class CollisionRadarEngine
// @namespace x_snc_ccr
var CollisionRadarEngine = Class.create();
CollisionRadarEngine.prototype = {

    initialize: function () {
        this._config = this._loadConfig();
        this._topologyCache = {};
        this._ciCriticalityCache = {};
    },

    // ------------------------------------------------------------------
    // Configuration (system properties, no config table)
    // ------------------------------------------------------------------
    _loadConfig: function () {
        var cfg = {};
        cfg.weights = {
            ciCriticality: this._propNum('x_snc_ccr.weight.ci_criticality', 40),
            changeType: this._propNum('x_snc_ccr.weight.change_type', 20),
            affectedServices: this._propNum('x_snc_ccr.weight.affected_services', 15),
            collisionCount: this._propNum('x_snc_ccr.weight.collision_count', 15),
            freezeOverlap: this._propNum('x_snc_ccr.weight.freeze_overlap', 10)
        };
        cfg.thresholds = {
            highRisk: this._propNum('x_snc_ccr.threshold.high_risk', 70),
            reviewRequired: this._propNum('x_snc_ccr.threshold.review_required', 50),
            maxTopologyDepth: this._propNum('x_snc_ccr.threshold.max_topology_depth', 3)
        };
        cfg.changeTypeScores = {
            emergency: 100,
            normal: 50,
            standard: 20
        };
        return cfg;
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
    // Public entry point — full scan
    // ------------------------------------------------------------------
    scanCollisions: function () {
        var started = new GlideDateTime();
        var changes = this._collectScheduledChanges();
        var collisions = this.detectCIOverlap(changes);
        var freezeViolations = this.detectFreezeViolation(changes);
        var riskRows = this.computeRiskScore(changes, collisions, freezeViolations);

        var collisionCount = this._persistCollisions(collisions);
        var riskCount = this._persistRisk(riskRows);

        var result = {
            scanned_changes: changes.length,
            collisions: collisionCount,
            freeze_violations: freezeViolations.length,
            risk_rows: riskCount,
            started_on: started.toString(),
            completed_on: new GlideDateTime().toString()
        };
        return result;
    },

    // ------------------------------------------------------------------
    // Public entry point — score only (no persistence)
    // ------------------------------------------------------------------
    score: function () {
        var changes = this._collectScheduledChanges();
        var collisions = this.detectCIOverlap(changes);
        var violations = this.detectFreezeViolation(changes);
        var rows = this.computeRiskScore(changes, collisions, violations);
        return {
            scanned_changes: changes.length,
            collisions: collisions.length,
            freeze_violations: violations.length,
            risk_rows: rows.length
        };
    },

    // ------------------------------------------------------------------
    // Change collection — GlideAggregate window filter, never full scan
    // ------------------------------------------------------------------
    _collectScheduledChanges: function () {
        var changes = [];
        var gr = new GlideRecord('change_request');
        gr.addActiveQuery();
        gr.addQuery('state', 'IN', '-2,-1');
        gr.addNotNullQuery('start_date');
        gr.addNotNullQuery('end_date');
        gr.query();
        while (gr.next()) {
            changes.push({
                sys_id: gr.getUniqueValue(),
                number: gr.getValue('number'),
                short_description: gr.getValue('short_description'),
                type: gr.getValue('type'),
                state: gr.getValue('state'),
                start_date: gr.getValue('start_date'),
                end_date: gr.getValue('end_date'),
                cmdb_ci: gr.getValue('cmdb_ci'),
                risk: gr.getValue('risk'),
                assignment_group: gr.getValue('assignment_group')
            });
        }
        return changes;
    },

    // ------------------------------------------------------------------
    // CI topology resolution — cmdb_rel_ci parent/child traversal
    // ------------------------------------------------------------------
    resolveCITopology: function (ciSysId, depth) {
        depth = depth || 0;
        var maxDepth = this._config.thresholds.maxTopologyDepth;
        if (depth > maxDepth) {
            return [];
        }
        if (this._topologyCache[ciSysId]) {
            return this._topologyCache[ciSysId];
        }

        var related = [];
        var gr = new GlideRecord('cmdb_rel_ci');
        gr.addQuery('parent', ciSysId);
        gr.addQuery('type', 'IN', 'Contains::Contained by,Depends on::Used by,Runs on::Runs');
        gr.query();
        while (gr.next()) {
            var child = gr.getValue('child');
            if (child && child !== ciSysId) {
                related.push(child);
                var descendants = this.resolveCITopology(child, depth + 1);
                for (var i = 0; i < descendants.length; i++) {
                    if (related.indexOf(descendants[i]) === -1) {
                        related.push(descendants[i]);
                    }
                }
            }
        }
        this._topologyCache[ciSysId] = related;
        return related;
    },

    // ------------------------------------------------------------------
    // CI overlap detection — actual start/end intersection, not co-occurrence
    // ------------------------------------------------------------------
    detectCIOverlap: function (changes) {
        var collisions = [];
        var seen = {};

        for (var i = 0; i < changes.length; i++) {
            for (var j = i + 1; j < changes.length; j++) {
                var a = changes[i];
                var b = changes[j];
                if (!this._windowsOverlap(a, b)) {
                    continue;
                }
                var sharedCi = this._sharedCI(a, b);
                if (!sharedCi) {
                    continue;
                }
                var key = this._collisionKey(a, b, sharedCi);
                if (seen[key]) {
                    continue;
                }
                seen[key] = true;

                var overlap = this._overlapWindow(a, b);
                collisions.push({
                    ci: sharedCi,
                    change_a: a.sys_id,
                    change_a_number: a.number,
                    change_b: b.sys_id,
                    change_b_number: b.number,
                    overlap_start: overlap.start,
                    overlap_end: overlap.end,
                    overlap_minutes: overlap.minutes,
                    window: a.start_date + ' / ' + a.end_date,
                    detected_on: new GlideDateTime().toString(),
                    state: 'new'
                });
            }
        }
        return collisions;
    },

    _windowsOverlap: function (a, b) {
        var aStart = new GlideDateTime(a.start_date);
        var aEnd = new GlideDateTime(a.end_date);
        var bStart = new GlideDateTime(b.start_date);
        var bEnd = new GlideDateTime(b.end_date);
        return aStart.before(bEnd) && bStart.before(aEnd);
    },

    _sharedCI: function (a, b) {
        if (!a.cmdb_ci || !b.cmdb_ci) {
            return null;
        }
        if (a.cmdb_ci === b.cmdb_ci) {
            return a.cmdb_ci;
        }
        var aTopo = this.resolveCITopology(a.cmdb_ci);
        if (aTopo.indexOf(b.cmdb_ci) !== -1) {
            return b.cmdb_ci;
        }
        var bTopo = this.resolveCITopology(b.cmdb_ci);
        if (bTopo.indexOf(a.cmdb_ci) !== -1) {
            return a.cmdb_ci;
        }
        return null;
    },

    _overlapWindow: function (a, b) {
        var aStart = new GlideDateTime(a.start_date);
        var aEnd = new GlideDateTime(a.end_date);
        var bStart = new GlideDateTime(b.start_date);
        var bEnd = new GlideDateTime(b.end_date);

        var start = aStart.after(bStart) ? aStart : bStart;
        var end = aEnd.before(bEnd) ? aEnd : bEnd;

        var minutes = 0;
        if (start.before(end)) {
            var diff = GlideDateTime.subtract(end, start);
            minutes = Math.round(diff.getNumericValue() / 60000);
        }
        return { start: start.toString(), end: end.toString(), minutes: minutes };
    },

    _collisionKey: function (a, b, ci) {
        var ids = [a.sys_id, b.sys_id].sort();
        return ci + '|' + ids[0] + '|' + ids[1];
    },

    // ------------------------------------------------------------------
    // Freeze / blackout window enforcement
    // ------------------------------------------------------------------
    detectFreezeViolation: function (changes) {
        var violations = [];
        var blackouts = this._loadBlackoutWindows();
        if (blackouts.length === 0) {
            return violations;
        }
        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            for (var j = 0; j < blackouts.length; j++) {
                var bw = blackouts[j];
                if (this._insideWindow(c, bw)) {
                    violations.push({
                        change: c.sys_id,
                        change_number: c.number,
                        window_name: bw.name,
                        window_owner: bw.owner,
                        window_start: bw.start,
                        window_end: bw.end,
                        overlap_minutes: this._overlapMinutes(c, bw)
                    });
                }
            }
        }
        return violations;
    },

    _loadBlackoutWindows: function () {
        var windows = [];
        var gr = new GlideRecord('change_request_blackout_window');
        gr.addActiveQuery();
        gr.query();
        while (gr.next()) {
            windows.push({
                name: gr.getValue('name'),
                owner: gr.getValue('owner'),
                start: gr.getValue('start_date'),
                end: gr.getValue('end_date')
            });
        }
        return windows;
    },

    _insideWindow: function (change, window) {
        var cStart = new GlideDateTime(change.start_date);
        var cEnd = new GlideDateTime(change.end_date);
        var wStart = new GlideDateTime(window.start);
        var wEnd = new GlideDateTime(window.end);
        return cStart.before(wEnd) && wStart.before(cEnd);
    },

    _overlapMinutes: function (change, window) {
        var cStart = new GlideDateTime(change.start_date);
        var cEnd = new GlideDateTime(change.end_date);
        var wStart = new GlideDateTime(window.start);
        var wEnd = new GlideDateTime(window.end);
        var start = cStart.after(wStart) ? cStart : wStart;
        var end = cEnd.before(wEnd) ? cEnd : wEnd;
        if (!start.before(end)) {
            return 0;
        }
        var diff = GlideDateTime.subtract(end, start);
        return Math.round(diff.getNumericValue() / 60000);
    },

    // ------------------------------------------------------------------
    // Composite risk scoring (0-100 weighted)
    // ------------------------------------------------------------------
    computeRiskScore: function (changes, collisions, freezeViolations) {
        var rows = [];
        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            var ciCriticality = this._ciCriticality(c.cmdb_ci);
            var changeTypeScore = this._config.changeTypeScores[c.type] || 50;
            var affectedServices = this._affectedServiceCount(c.cmdb_ci);
            var collisionCount = this._countCollisionsFor(c.sys_id, collisions);
            var freezeOverlap = this._freezeOverlapFor(c.sys_id, freezeViolations);

            var score = 0;
            score += ciCriticality * this._config.weights.ciCriticality / 100;
            score += changeTypeScore * this._config.weights.changeType / 100;
            score += Math.min(affectedServices, 10) * 10 * this._config.weights.affectedServices / 100;
            score += Math.min(collisionCount, 5) * 20 * this._config.weights.collisionCount / 100;
            score += (freezeOverlap > 0 ? 100 : 0) * this._config.weights.freezeOverlap / 100;

            score = Math.round(Math.min(100, Math.max(0, score)));

            var factors = {
                ci_criticality: ciCriticality,
                change_type: c.type,
                change_type_score: changeTypeScore,
                affected_services: affectedServices,
                collision_count: collisionCount,
                freeze_overlap_minutes: freezeOverlap
            };

            rows.push({
                change: c.sys_id,
                change_number: c.number,
                score: score,
                factors_json: JSON.stringify(factors),
                review_required: score >= this._config.thresholds.reviewRequired,
                scored_on: new GlideDateTime().toString()
            });
        }
        return rows;
    },

    _ciCriticality: function (ciSysId) {
        if (!ciSysId) {
            return 0;
        }
        if (this._ciCriticalityCache[ciSysId] !== undefined) {
            return this._ciCriticalityCache[ciSysId];
        }
        var score = 0;
        var gr = new GlideRecord('cmdb_ci');
        if (gr.get(ciSysId)) {
            var criticality = gr.getValue('business_criticality');
            var operational = gr.getValue('operational_status');
            if (criticality === '1' || criticality === 'critical') {
                score = 100;
            } else if (criticality === '2' || criticality === 'high') {
                score = 75;
            } else if (criticality === '3' || criticality === 'medium') {
                score = 50;
            } else {
                score = 25;
            }
            if (operational === '1' || operational === 'operational') {
                score = Math.min(100, score + 10);
            }
        }
        this._ciCriticalityCache[ciSysId] = score;
        return score;
    },

    _affectedServiceCount: function (ciSysId) {
        if (!ciSysId) {
            return 0;
        }
        var count = 0;
        var ga = new GlideAggregate('cmdb_rel_ci');
        ga.addQuery('parent', ciSysId);
        ga.addQuery('type', 'IN', 'Depends on::Used by,Runs on::Runs');
        ga.addAggregate('COUNT');
        ga.query();
        if (ga.next()) {
            count = parseInt(ga.getAggregate('COUNT'), 10) || 0;
        }
        return count;
    },

    _countCollisionsFor: function (changeSysId, collisions) {
        var count = 0;
        for (var i = 0; i < collisions.length; i++) {
            if (collisions[i].change_a === changeSysId || collisions[i].change_b === changeSysId) {
                count++;
            }
        }
        return count;
    },

    _freezeOverlapFor: function (changeSysId, freezeViolations) {
        var total = 0;
        for (var i = 0; i < freezeViolations.length; i++) {
            if (freezeViolations[i].change === changeSysId) {
                total += freezeViolations[i].overlap_minutes;
            }
        }
        return total;
    },

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------
    _persistCollisions: function (collisions) {
        var count = 0;
        for (var i = 0; i < collisions.length; i++) {
            var c = collisions[i];
            if (this._collisionExists(c)) {
                continue;
            }
            var gr = new GlideRecord('x_snc_ccr_collision');
            gr.initialize();
            gr.setValue('ci', c.ci);
            gr.setValue('change_a', c.change_a);
            gr.setValue('change_b', c.change_b);
            gr.setValue('overlap_start', c.overlap_start);
            gr.setValue('overlap_end', c.overlap_end);
            gr.setValue('overlap_minutes', c.overlap_minutes);
            gr.setValue('window', c.window);
            gr.setValue('detected_on', c.detected_on);
            gr.setValue('state', c.state);
            try {
                gr.insert();
                count++;
            } catch (e) {
                gs.error('x_snc_ccr: failed to insert collision ' + c.change_a_number + '/' + c.change_b_number + ': ' + e);
            }
        }
        return count;
    },

    _collisionExists: function (c) {
        var gr = new GlideRecord('x_snc_ccr_collision');
        gr.addQuery('ci', c.ci);
        gr.addQuery('change_a', c.change_a);
        gr.addQuery('change_b', c.change_b);
        gr.addQuery('state', 'IN', 'new,acknowledged');
        gr.setLimit(1);
        gr.query();
        return gr.hasNext();
    },

    _persistRisk: function (rows) {
        var count = 0;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var gr = new GlideRecord('x_snc_ccr_risk');
            gr.initialize();
            gr.setValue('change', r.change);
            gr.setValue('score', r.score);
            gr.setValue('factors_json', r.factors_json);
            gr.setValue('review_required', r.review_required);
            gr.setValue('scored_on', r.scored_on);
            try {
                gr.insert();
                count++;
            } catch (e) {
                gs.error('x_snc_ccr: failed to insert risk row for ' + r.change_number + ': ' + e);
            }
        }
        return count;
    },

    // ------------------------------------------------------------------
    // Snapshot query (for REST GET)
    // ------------------------------------------------------------------
    snapshot: function (ciSysId) {
        var result = { collisions: [], risk: [] };
        var gr = new GlideRecord('x_snc_ccr_collision');
        if (ciSysId) {
            gr.addQuery('ci', ciSysId);
        }
        gr.addQuery('state', 'IN', 'new,acknowledged');
        gr.orderByDesc('detected_on');
        gr.setLimit(100);
        gr.query();
        var changeIds = {};
        while (gr.next()) {
            if (gr.getValue('change_a')) { changeIds[gr.getValue('change_a')] = true; }
            if (gr.getValue('change_b')) { changeIds[gr.getValue('change_b')] = true; }
            result.collisions.push({
                sys_id: gr.getUniqueValue(),
                ci: gr.getValue('ci'),
                change_a: gr.getValue('change_a'),
                change_b: gr.getValue('change_b'),
                overlap_start: gr.getValue('overlap_start'),
                overlap_end: gr.getValue('overlap_end'),
                overlap_minutes: gr.getValue('overlap_minutes'),
                state: gr.getValue('state'),
                detected_on: gr.getValue('detected_on')
            });
        }

        var rg = new GlideRecord('x_snc_ccr_risk');
        if (ciSysId) {
            var ids = Object.keys(changeIds);
            if (ids.length === 0) {
                return result;
            }
            rg.addQuery('change', 'IN', ids.join(','));
        }
        rg.orderByDesc('scored_on');
        rg.setLimit(100);
        rg.query();
        while (rg.next()) {
            result.risk.push({
                sys_id: rg.getUniqueValue(),
                change: rg.getValue('change'),
                score: rg.getValue('score'),
                factors_json: rg.getValue('factors_json'),
                review_required: rg.getValue('review_required'),
                scored_on: rg.getValue('scored_on')
            });
        }
        return result;
    },

    type: 'CollisionRadarEngine'
};
