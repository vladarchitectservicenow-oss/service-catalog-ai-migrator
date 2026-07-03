// SN Release Impact Digest — RIDImpactScoringEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Cross-references release note entries against instance inventory using
// three-tier matching and computes Breaking Risk Scores (0–100).
//
// Tier 1: Exact match (plugin name, table name, API signature) → HIGH confidence
// Tier 2: Keyword heuristic (overlap + dependency graph traversal) → MEDIUM confidence
// Tier 3: Broad pattern match → LOW confidence with explicit caveat
//
// @class RIDImpactScoringEngine
// @namespace x_snc_rid
var RIDImpactScoringEngine = Class.create();
RIDImpactScoringEngine.prototype = {

    /**
     * Initialize the engine. The optional `options` argument allows callers to
     * pass configuration such as custom stop-word lists for non-English release
     * notes. When omitted, a small built-in English stop-word set is used.
     *
     * @param {string} inventoryJson
     * @param {Object} [options]
     * @param {string[]} [options.stopWords] — extra stop words to add to the
     *   built-in list (does not replace it). Pass an entire localized list and
     *   set `options.replaceStopWords=true` to override.
     * @param {boolean} [options.replaceStopWords=false] — when true, the
     *   `stopWords` array fully replaces the built-in list.
     */
    initialize: function(inventoryJson, options) {
        this._inventory = JSON.parse(inventoryJson);
        this._results = [];
        this._options = options || {};

        // Default English stop word list. Callers may extend or replace this
        // via the `options.stopWords` argument (see above) for non-English
        // instances. This avoids the L5 issue where hardcoded English stop
        // words degraded Tier 2/3 matching on Japanese / Spanish / etc.
        // release notes.
        this._stopWords = [
            'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been',
            'will', 'when', 'your', 'can', 'not', 'are', 'was', 'has', 'but',
            'all', 'its'
        ];
        if (Array.isArray(this._options.stopWords)) {
            if (this._options.replaceStopWords === true) {
                this._stopWords = this._options.stopWords;
            } else {
                // Merge: built-in + caller-supplied, deduplicated.
                var merged = this._stopWords.slice();
                for (var i = 0; i < this._options.stopWords.length; i++) {
                    if (merged.indexOf(this._options.stopWords[i]) === -1) {
                        merged.push(this._options.stopWords[i]);
                    }
                }
                this._stopWords = merged;
            }
        }
    },

    /**
     * Run cross-reference against a set of release note entries.
     * @param {Array} releaseNotes — array of {id, module, component, change_type, description, affected_apis, release_family}
     * @return {Array} impact events with risk scores
     */
    crossReference: function(releaseNotes) {
        this._results = [];

        for (var i = 0; i < releaseNotes.length; i++) {
            var note = releaseNotes[i];
            var match = this._matchEntry(note);
            if (match) {
                this._results.push(match);
            }
        }

        this._results.sort(function(a, b) {
            return b.breaking_risk_score - a.breaking_risk_score;
        });

        return this._results;
    },

    /**
     * Match a single release note entry against the inventory.
     * @param {Object} note
     * @return {Object|null} match result or null if no match
     */
    _matchEntry: function(note) {
        // Tier 1: Exact match
        var tier1 = this._tier1ExactMatch(note);
        if (tier1) { return tier1; }

        // Tier 2: Keyword heuristic
        var tier2 = this._tier2KeywordMatch(note);
        if (tier2) { return tier2; }

        // Tier 3: Broad pattern
        var tier3 = this._tier3BroadMatch(note);
        if (tier3) { return tier3; }

        return null;
    },

    /**
     * Tier 1: Exact match on plugin name, table name, or API signature.
     */
    _tier1ExactMatch: function(note) {
        // Defensive: affected_apis may arrive as a comma-separated string (per the
        // x_snc_rid_impact_event.affected_apis field type=string). Normalize to an
        // array so .length returns the element count, not the character count.
        var affectedApisRaw = note.affected_apis;
        var affectedApis = [];
        if (Array.isArray(affectedApisRaw)) {
            affectedApis = affectedApisRaw;
        } else if (typeof affectedApisRaw === 'string' && affectedApisRaw.length > 0) {
            affectedApis = affectedApisRaw.split(',').map(function(s) {
                return s.trim();
            }).filter(function(s) {
                return s.length > 0;
            });
        }
        var component = (note.component || '').toLowerCase();
        var module = (note.module || '').toLowerCase();

        // Check plugins
        for (var i = 0; i < this._inventory.plugins.length; i++) {
            var p = this._inventory.plugins[i];
            if (component && p.name.toLowerCase().indexOf(component) !== -1) {
                return this._buildResult(note, 'TIER_1', 95, 'Plugin exact match: ' + p.name, [p.name]);
            }
            if (module && p.name.toLowerCase().indexOf(module) !== -1) {
                return this._buildResult(note, 'TIER_1', 90, 'Plugin module match: ' + p.name, [p.name]);
            }
        }

        // Check custom tables
        for (var j = 0; j < this._inventory.custom_tables.length; j++) {
            var t = this._inventory.custom_tables[j];
            if (component && t.name.toLowerCase().indexOf(component) !== -1) {
                return this._buildResult(note, 'TIER_1', 90, 'Table exact match: ' + t.name, [t.name]);
            }
        }

        // Check API usage
        for (var k = 0; k < affectedApis.length; k++) {
            var api = affectedApis[k].toLowerCase();
            for (var m = 0; m < this._inventory.api_usage.length; m++) {
                if (this._inventory.api_usage[m].api.toLowerCase() === api) {
                    return this._buildResult(note, 'TIER_1', 100, 'API exact match: ' + api, [api]);
                }
            }
        }

        return null;
    },

    /**
     * Tier 2: Keyword overlap heuristic with dependency chain awareness.
     */
    _tier2KeywordMatch: function(note) {
        var description = (note.description || '').toLowerCase();
        var component = (note.component || '').toLowerCase();
        var module = (note.module || '').toLowerCase();
        var searchText = description + ' ' + component + ' ' + module;

        var keywords = this._extractKeywords(searchText);
        if (keywords.length === 0) { return null; }

        var matchedComponents = [];
        var totalScore = 0;

        // Check against business rules
        for (var i = 0; i < this._inventory.business_rules.length; i++) {
            var br = this._inventory.business_rules[i];
            var brText = (br.name || '').toLowerCase();
            var hits = this._countKeywordHits(brText, keywords);
            if (hits >= 2) {
                matchedComponents.push('BR: ' + br.name);
                totalScore += hits * 10;
            }
        }

        // Check against flows
        for (var j = 0; j < this._inventory.flows.length; j++) {
            var flow = this._inventory.flows[j];
            var flowText = ((flow.name || '') + ' ' + (flow.description || '')).toLowerCase();
            var hits = this._countKeywordHits(flowText, keywords);
            if (hits >= 2) {
                matchedComponents.push('Flow: ' + flow.name);
                totalScore += hits * 8;
            }
        }

        // Check against REST endpoints
        for (var k = 0; k < this._inventory.rest_endpoints.length; k++) {
            var ep = this._inventory.rest_endpoints[k];
            var epText = ((ep.name || '') + ' ' + (ep.base_path || '')).toLowerCase();
            var hits = this._countKeywordHits(epText, keywords);
            if (hits >= 1) {
                matchedComponents.push('REST: ' + ep.name);
                totalScore += hits * 12;
            }
        }

        if (matchedComponents.length === 0) { return null; }

        var confidence = Math.min(70, 40 + totalScore);
        return this._buildResult(note, 'TIER_2', confidence,
            'Keyword overlap: ' + matchedComponents.length + ' components matched',
            matchedComponents);
    },

    /**
     * Tier 3: Broad pattern match — low confidence, explicit caveat.
     * Searches individual inventory arrays (plugins, tables, BRs, etc.) for
     * keyword overlap instead of serializing the whole inventory object into a
     * single multi-MB string. Scales to large instances.
     */
    _tier3BroadMatch: function(note) {
        var description = (note.description || '').toLowerCase();
        var changeType = (note.change_type || '').toLowerCase();

        // Broad signals: deprecation, breaking, removal
        var broadSignals = ['deprecat', 'remov', 'break', 'migrat', 'upgrad', 'replac'];
        var signalCount = 0;
        for (var i = 0; i < broadSignals.length; i++) {
            if (description.indexOf(broadSignals[i]) !== -1) { signalCount++; }
            if (changeType.indexOf(broadSignals[i]) !== -1) { signalCount++; }
        }

        if (signalCount < 2) { return null; }

        // Search each inventory array independently and count keyword overlaps.
        // Avoids JSON.stringify of the entire inventory object.
        var keywords = this._extractKeywords(description);
        if (keywords.length === 0) { return null; }

        var inv = this._inventory;
        var searchableSources = [
            inv.plugins,           // [{name, ...}]
            inv.custom_tables,     // [{name, ...}]
            inv.business_rules,    // [{name, table, ...}]
            inv.client_scripts,    // [{name, table, ...}]
            inv.flows,             // [{name, description, ...}]
            inv.rest_endpoints     // [{name, base_path, ...}]
        ];

        var overlap = 0;
        for (var s = 0; s < searchableSources.length; s++) {
            var arr = searchableSources[s] || [];
            for (var a = 0; a < arr.length; a++) {
                var itemText = JSON.stringify(arr[a]).toLowerCase();
                for (var k = 0; k < keywords.length; k++) {
                    if (itemText.indexOf(keywords[k]) !== -1) { overlap++; }
                }
            }
        }

        if (overlap === 0) { return null; }

        var confidence = Math.min(35, 10 + overlap * 5);
        return this._buildResult(note, 'TIER_3', confidence,
            'Broad pattern match: ' + signalCount + ' signals, ' + overlap + ' keyword overlaps. LOW CONFIDENCE — manual review required.',
            ['Pattern-based match']);
    },

    /**
     * Build a standardized result object.
     */
    _buildResult: function(note, tier, confidence, reasoning, affectedComponents) {
        var changeType = (note.change_type || '').toLowerCase();
        var baseRisk = 0;

        if (changeType.indexOf('break') !== -1 || changeType.indexOf('remov') !== -1) {
            baseRisk = 100;
        } else if (changeType.indexOf('deprecat') !== -1) {
            baseRisk = 90;
        } else if (changeType.indexOf('chang') !== -1) {
            baseRisk = 50;
        } else if (changeType.indexOf('add') !== -1) {
            baseRisk = 10;
        } else {
            baseRisk = 30;
        }

        // Adjust by tier confidence
        var riskScore = Math.round(baseRisk * (confidence / 100));
        riskScore = Math.min(100, Math.max(0, riskScore));

        return {
            release_note_id: note.id || '',
            module: note.module || '',
            component: note.component || '',
            change_type: note.change_type || '',
            release_family: note.release_family || '',
            match_tier: tier,
            confidence: confidence,
            breaking_risk_score: riskScore,
            reasoning: reasoning,
            affected_components: affectedComponents,
            description: note.description || '',
            migration_notes: note.migration_notes || ''
        };
    },

    /**
     * Extract meaningful keywords from text.
     */
    _extractKeywords: function(text) {
        // Stop word list is configurable via initialize({stopWords: [...]}) for
        // non-English release notes. Default is English (set in initialize).
        var stopWords = this._stopWords || [];
        var words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
        var keywords = [];
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (w.length < 3) { continue; }
            if (stopWords.indexOf(w) !== -1) { continue; }
            keywords.push(w);
        }
        return keywords;
    },

    /**
     * Count how many keywords appear in the target text.
     */
    _countKeywordHits: function(text, keywords) {
        var count = 0;
        for (var i = 0; i < keywords.length; i++) {
            if (text.indexOf(keywords[i]) !== -1) { count++; }
        }
        return count;
    },

    /**
     * Generate a regression test checklist from impact results.
     * @param {Array} impactResults — output from crossReference()
     * @return {Array} prioritized test cases
     */
    generateRegressionChecklist: function(impactResults) {
        var checklist = [];
        for (var i = 0; i < impactResults.length; i++) {
            var r = impactResults[i];
            var riskLabel = r.breaking_risk_score >= 80 ? 'CRITICAL' :
                           r.breaking_risk_score >= 50 ? 'HIGH' :
                           r.breaking_risk_score >= 25 ? 'MEDIUM' : 'LOW';

            checklist.push({
                priority: i + 1,
                risk_label: riskLabel,
                breaking_risk_score: r.breaking_risk_score,
                module: r.module,
                component: r.component,
                change_type: r.change_type,
                test_instruction: 'Verify ' + r.component + ' functionality after ' +
                    r.change_type + ' change in ' + r.release_family + '. ' +
                    'Affected: ' + r.affected_components.join(', ') + '.',
                expected_behavior: r.component + ' should function correctly with ' +
                    (r.migration_notes || 'no migration required') + '.',
                risk_if_skipped: riskLabel === 'CRITICAL' ? 'Production outage likely' :
                                riskLabel === 'HIGH' ? 'Major feature degradation' :
                                riskLabel === 'MEDIUM' ? 'Minor functionality loss' : 'Cosmetic impact',
                match_tier: r.match_tier,
                release_note_id: r.release_note_id
            });
        }
        return checklist;
    },

    type: 'RIDImpactScoringEngine'
};
