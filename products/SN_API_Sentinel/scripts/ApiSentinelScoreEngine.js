// API Sentinel — ApiSentinelScoreEngine
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Risk scoring, banding, delta computation, and report/export assembly.
// AI narrative calls are dispatched from here via sn_generative_ai with a
// graceful fallback when the plugin is absent. Deterministic core: the risk
// score is reproducible; AI only explains and recommends on top of it.
// @class ApiSentinelScoreEngine @namespace x_snc_api_sentinel

var ApiSentinelScoreEngine = Class.create();
ApiSentinelScoreEngine.prototype = {
    initialize: function () {
        this._sensitiveTables = [
            'incident', 'sys_user', 'sys_user_group', 'hr_profile',
            'sn_hr_core_profile', 'sys_user_has_role', 'oauth_credential',
            'sys_user_token', 'sys_user_session'
        ];
    },

    /**
     * Score a single normalized endpoint object. Returns the endpoint object
     * with risk_score and risk_band populated.
     */
    scoreEndpoint: function (endpoint) {
        var exposure = this._exposureFactor(endpoint);
        var sensitivity = this._sensitivityFactor(endpoint);
        var authWeakness = this._authWeaknessFactor(endpoint);
        var raw = exposure * sensitivity * authWeakness;
        var score = Math.round(raw * 100);
        if (score > 100) {
            score = 100;
        }
        endpoint.risk_score = score;
        endpoint.risk_band = this._band(score);
        return endpoint;
    },

    /**
     * Score an array of endpoints and return them sorted by risk descending.
     */
    scoreAll: function (endpoints) {
        for (var i = 0; i < endpoints.length; i++) {
            this.scoreEndpoint(endpoints[i]);
        }
        endpoints.sort(function (a, b) {
            return b.risk_score - a.risk_score;
        });
        return endpoints;
    },

    /**
     * Compute a delta between two scans (arrays of endpoint objects keyed by
     * source_sys_id + endpoint_type). Returns { added, removed, changed }.
     */
    computeDelta: function (previous, current) {
        var prevMap = this._index(previous);
        var currMap = this._index(current);
        var added = [];
        var removed = [];
        var changed = [];
        var key;
        for (key in currMap) {
            if (!currMap.hasOwnProperty(key)) {
                continue;
            }
            if (!prevMap.hasOwnProperty(key)) {
                added.push(currMap[key]);
            } else if (prevMap[key].risk_score !== currMap[key].risk_score ||
                       prevMap[key].role_guard !== currMap[key].role_guard) {
                changed.push({
                    key: key,
                    name: currMap[key].name,
                    before: prevMap[key].risk_score,
                    after: currMap[key].risk_score
                });
            }
        }
        for (key in prevMap) {
            if (!prevMap.hasOwnProperty(key)) {
                continue;
            }
            if (!currMap.hasOwnProperty(key)) {
                removed.push(prevMap[key]);
            }
        }
        return { added: added, removed: removed, changed: changed };
    },

    /**
     * Generate a Markdown compliance report from scored endpoints.
     */
    buildMarkdownReport: function (endpoints, scanInfo) {
        var lines = [];
        lines.push('# API Sentinel — Security Posture Report');
        lines.push('');
        lines.push('Generated: ' + (scanInfo && scanInfo.generated_at ? scanInfo.generated_at : new GlideDateTime().getDisplayValue()));
        lines.push('');
        var counts = this._countBands(endpoints);
        lines.push('## Summary');
        lines.push('');
        lines.push('| Risk Band | Count |');
        lines.push('|-----------|-------|');
        lines.push('| Critical  | ' + counts.critical + ' |');
        lines.push('| High      | ' + counts.high + ' |');
        lines.push('| Medium    | ' + counts.medium + ' |');
        lines.push('| Low       | ' + counts.low + ' |');
        lines.push('');
        lines.push('## Findings');
        lines.push('');
        lines.push('| # | Endpoint | Type | Path | Risk | Band |');
        lines.push('|---|----------|------|------|------|------|');
        for (var i = 0; i < endpoints.length; i++) {
            var e = endpoints[i];
            lines.push('| ' + (i + 1) + ' | ' + this._esc(e.name) + ' | ' + e.endpoint_type +
                       ' | ' + this._esc(e.path) + ' | ' + e.risk_score + ' | ' + e.risk_band + ' |');
        }
        return lines.join('\n');
    },

    /**
     * Generate a JSON report (compliance / CI-CD ingestion).
     */
    buildJsonReport: function (endpoints, scanInfo) {
        var payload = {
            product: 'API Sentinel',
            scope: 'x_snc_api_sentinel',
            generated_at: scanInfo && scanInfo.generated_at ? scanInfo.generated_at : new GlideDateTime().getDisplayValue(),
            counts: this._countBands(endpoints),
            endpoints: endpoints
        };
        return JSON.stringify(payload);
    },

    /**
     * Generate a CSV report (BI / Excel ingestion).
     */
    buildCsvReport: function (endpoints) {
        var rows = ['name,endpoint_type,path,auth_required,role_guard,risk_score,risk_band'];
        for (var i = 0; i < endpoints.length; i++) {
            var e = endpoints[i];
            rows.push(this._csv(e.name) + ',' + this._csv(e.endpoint_type) + ',' +
                      this._csv(e.path) + ',' + this._csv(e.auth_required) + ',' +
                      this._csv(e.role_guard) + ',' + e.risk_score + ',' + e.risk_band);
        }
        return rows.join('\n');
    },

    /**
     * Generate an AI remediation narrative for a flagged endpoint. Falls back
     * to a deterministic message when sn_generative_ai is unavailable.
     */
    generateNarrative: function (endpoint) {
        var prompt = 'Explain why this ServiceNow inbound API endpoint is a security risk ' +
                     'and give a concrete remediation. Endpoint: ' + endpoint.name +
                     ' (type ' + endpoint.endpoint_type + ', path ' + endpoint.path +
                     ', risk score ' + endpoint.risk_score + '/' + endpoint.risk_band + ').';
        try {
            if (typeof sn_generative_ai !== 'undefined' && sn_generative_ai.GenerativeAI) {
                var ai = new sn_generative_ai.GenerativeAI();
                var resp = ai.generate(prompt);
                if (resp && resp.text) {
                    return resp.text;
                }
            }
        } catch (e) {
            // fall through to deterministic fallback
        }
        return this._deterministicNarrative(endpoint);
    },

    /**
     * Deterministic remediation narrative (no AI dependency).
     */
    _deterministicNarrative: function (endpoint) {
        if (endpoint.auth_required === 'public') {
            return 'Endpoint "' + endpoint.name + '" is publicly accessible with no authentication. ' +
                   'Require authentication and add a role guard (gs.getUser().hasRole(...)) before exposing data.';
        }
        if (!endpoint.role_guard && endpoint.endpoint_type === 'scripted_rest') {
            return 'Endpoint "' + endpoint.name + '" has no role guard. Add gs.getUser().hasRole(...) ' +
                   'to restrict access to authorized roles only.';
        }
        if (endpoint.pii_fields && endpoint.pii_fields.length > 0) {
            return 'Endpoint "' + endpoint.name + '" returns PII/sensitive fields: ' +
                   endpoint.pii_fields.join(', ') + '. Restrict access and consider field-level ACLs.';
        }
        return 'Endpoint "' + endpoint.name + '" scored ' + endpoint.risk_score +
               ' (' + endpoint.risk_band + '). Review its ACLs and scope grants.';
    },

    _exposureFactor: function (endpoint) {
        if (endpoint.auth_required === 'public') {
            return 1.0;
        }
        if (endpoint.auth_required === 'authenticated') {
            return 0.5;
        }
        return 0.2;
    },

    _sensitivityFactor: function (endpoint) {
        var factor = 0.2;
        if (endpoint.pii_fields && endpoint.pii_fields.length > 0) {
            factor = 1.0;
        } else if (endpoint.tables_touched && endpoint.tables_touched.length > 0) {
            for (var i = 0; i < endpoint.tables_touched.length; i++) {
                if (this._sensitiveTables.indexOf(endpoint.tables_touched[i]) > -1) {
                    factor = 0.8;
                    break;
                }
            }
        }
        if (endpoint.endpoint_type === 'oauth_scope') {
            var scopes = endpoint.role_guard || '';
            if (scopes.indexOf('admin') > -1 || scopes.indexOf('snc_platform') > -1) {
                factor = 1.0;
            }
        }
        return factor;
    },

    _authWeaknessFactor: function (endpoint) {
        if (endpoint.auth_required === 'public') {
            return 1.0;
        }
        // OAuth scope lists are NOT role guards: a broad admin/snc_platform
        // scope grant is itself a weakness, not a protection.
        if (endpoint.endpoint_type === 'oauth_scope') {
            var scopes = endpoint.role_guard || '';
            if (scopes.indexOf('admin') > -1 || scopes.indexOf('snc_platform') > -1) {
                return 1.0;
            }
            return 0.6;
        }
        if (endpoint.endpoint_type === 'scripted_rest' && !endpoint.role_guard) {
            return 1.0;
        }
        if (endpoint.role_guard) {
            return 0.1;
        }
        return 0.6;
    },

    _band: function (score) {
        if (score >= 80) {
            return 'Critical';
        }
        if (score >= 60) {
            return 'High';
        }
        if (score >= 30) {
            return 'Medium';
        }
        return 'Low';
    },

    _countBands: function (endpoints) {
        var counts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (var i = 0; i < endpoints.length; i++) {
            var band = endpoints[i].risk_band;
            if (band === 'Critical') {
                counts.critical++;
            } else if (band === 'High') {
                counts.high++;
            } else if (band === 'Medium') {
                counts.medium++;
            } else {
                counts.low++;
            }
        }
        return counts;
    },

    _index: function (endpoints) {
        var map = {};
        for (var i = 0; i < endpoints.length; i++) {
            var e = endpoints[i];
            var key = e.endpoint_type + ':' + (e.source_sys_id || e.path || e.name);
            map[key] = e;
        }
        return map;
    },

    _esc: function (s) {
        if (!s) {
            return '';
        }
        return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    },

    _csv: function (s) {
        if (s === null || s === undefined) {
            return '';
        }
        var str = String(s);
        // Neutralize CSV formula injection (values beginning with = + - @).
        if (/^[=+\-@]/.test(str)) {
            str = "'" + str;
        }
        if (str.indexOf(',') > -1 || str.indexOf('"') > -1 || str.indexOf('\n') > -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    },

    type: 'ApiSentinelScoreEngine'
};
