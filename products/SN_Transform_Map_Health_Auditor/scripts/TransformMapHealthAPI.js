// SN Transform Map Health Auditor — TransformMapHealthAPI
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// REST endpoint handler: action dispatch for POST /execute and
// query-parameter routing for GET /status.
// @class TransformMapHealthAPI @namespace x_snc_tmh

var TransformMapHealthAPI = Class.create();
TransformMapHealthAPI.prototype = {
    initialize: function() {
        this.engine = new x_snc_tmh.TransformMapHealthEngine();
    },

    /**
     * Main entry point for Scripted REST API.
     * Called by both POST /execute and GET /status endpoints.
     * @param {RESTAPIRequest} request
     * @param {RESTAPIResponse} response
     */
    process: function(request, response) {
        var method = request.method || 'GET';

        if (method === 'POST') {
            this._handlePost(request, response);
        } else if (method === 'GET') {
            this._handleGet(request, response);
        } else {
            response.setStatus(405);
            response.setBody(JSON.stringify({
                error: 'Method not allowed',
                allowed_methods: ['GET', 'POST']
            }));
        }
    },

    // ─── POST /execute handler ────────────────────────────────────────────

    /**
     * Handle POST /api/x_snc_tmh/execute with action dispatch.
     * @param {RESTAPIRequest} request
     * @param {RESTAPIResponse} response
     */
    _handlePost: function(request, response) {
        var body = request.body;
        var data = {};

        if (body && body.data) {
            data = body.data;
        }

        var action = data.action || '';

        switch (action) {
            case 'scan':
                this._handleScan(data, response);
                break;
            case 'health':
                this._handleHealth(data, response);
                break;
            case 'config':
                this._handleConfig(data, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Invalid action',
                    message: 'Supported actions: scan, health, config',
                    received: action
                }));
        }
    },

    /**
     * POST /execute {action: "scan"} — trigger a scan.
     */
    _handleScan: function(data, response) {
        var transformMapId = data.transform_map || '';

        try {
            var resultId = '';
            if (transformMapId) {
                resultId = this.engine.scanOne(transformMapId);
            } else {
                resultId = this.engine.scanAll();
            }

            if (!resultId) {
                response.setStatus(500);
                response.setBody(JSON.stringify({
                    result: 'error',
                    message: 'Scan failed — no result produced'
                }));
                return;
            }

            // Read back the result for the response
            var gr = new GlideRecord('x_snc_tmh_scan_result');
            if (gr.get(resultId)) {
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    result: 'success',
                    scan_result_id: resultId,
                    health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                    error_count: parseInt(gr.getValue('error_count'), 10) || 0,
                    stale_mappings: parseInt(gr.getValue('stale_mappings'), 10) || 0,
                    coalesce_issues: parseInt(gr.getValue('coalesce_issues'), 10) || 0,
                    script_issues: parseInt(gr.getValue('script_issues'), 10) || 0,
                    scan_time: gr.getValue('scan_time') || ''
                }));
            } else {
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    result: 'success',
                    scan_result_id: resultId,
                    message: 'Scan completed. Result record created.'
                }));
            }
        } catch (e) {
            response.setStatus(500);
            response.setBody(JSON.stringify({
                result: 'error',
                message: 'Scan failed: ' + e.message
            }));
        }
    },

    /**
     * POST /execute {action: "health"} — get health summary for a transform map.
     */
    _handleHealth: function(data, response) {
        var transformMapId = data.transform_map || '';

        try {
            if (!transformMapId) {
                // Return latest results for all transform maps
                var results = [];
                var gr = new GlideRecord('x_snc_tmh_scan_result');
                gr.addNotNullQuery('transform_map');
                gr.orderByDesc('scan_time');
                gr.setLimit(50);
                gr.query();

                var seenMaps = {};
                while (gr.next()) {
                    var tmId = gr.getValue('transform_map') || '';
                    if (seenMaps[tmId]) {
                        continue; // only latest per transform map
                    }
                    seenMaps[tmId] = true;

                    var tmName = '';
                    var tm = new GlideRecord('sys_transform_map');
                    if (tm.get(tmId)) {
                        tmName = tm.getValue('name') || tmId;
                    }

                    results.push({
                        transform_map_id: tmId,
                        transform_map_name: tmName,
                        health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                        error_count: parseInt(gr.getValue('error_count'), 10) || 0,
                        error_rate: parseFloat(gr.getValue('error_rate')) || 0,
                        stale_mappings: parseInt(gr.getValue('stale_mappings'), 10) || 0,
                        coalesce_issues: parseInt(gr.getValue('coalesce_issues'), 10) || 0,
                        script_issues: parseInt(gr.getValue('script_issues'), 10) || 0,
                        scan_time: gr.getValue('scan_time') || ''
                    });
                }

                response.setStatus(200);
                response.setBody(JSON.stringify({
                    result: 'success',
                    transform_maps: results,
                    total: results.length
                }));
                return;
            }

            // Single transform map — get latest result
            var gr = new GlideRecord('x_snc_tmh_scan_result');
            gr.addQuery('transform_map', transformMapId);
            gr.orderByDesc('scan_time');
            gr.setLimit(1);
            gr.query();

            if (gr.next()) {
                response.setStatus(200);
                response.setBody(JSON.stringify({
                    result: 'success',
                    transform_map_id: transformMapId,
                    health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                    error_count: parseInt(gr.getValue('error_count'), 10) || 0,
                    error_rate: parseFloat(gr.getValue('error_rate')) || 0,
                    stale_mappings: parseInt(gr.getValue('stale_mappings'), 10) || 0,
                    coalesce_issues: parseInt(gr.getValue('coalesce_issues'), 10) || 0,
                    script_issues: parseInt(gr.getValue('script_issues'), 10) || 0,
                    findings_json: gr.getValue('findings_json') || '',
                    recommendations_json: gr.getValue('recommendations_json') || '',
                    scan_time: gr.getValue('scan_time') || ''
                }));
            } else {
                response.setStatus(404);
                response.setBody(JSON.stringify({
                    result: 'not_found',
                    message: 'No scan results found for transform map ' + transformMapId
                }));
            }
        } catch (e) {
            response.setStatus(500);
            response.setBody(JSON.stringify({
                result: 'error',
                message: 'Health query failed: ' + e.message
            }));
        }
    },

    /**
     * POST /execute {action: "config"} — read or update configuration.
     */
    _handleConfig: function(data, response) {
        var configKey = data.config_key || '';
        var configValue = data.config_value;

        try {
            if (!configKey) {
                // List all config entries
                var results = [];
                var gr = new GlideRecord('x_snc_tmh_config');
                gr.query();

                while (gr.next()) {
                    results.push({
                        config_key: gr.getValue('config_key') || '',
                        config_value: gr.getValue('config_value') || '',
                        description: gr.getValue('description') || ''
                    });
                }

                response.setStatus(200);
                response.setBody(JSON.stringify({
                    result: 'success',
                    config: results
                }));
                return;
            }

            if (configValue === undefined || configValue === null) {
                // Read single config
                var gr = new GlideRecord('x_snc_tmh_config');
                gr.addQuery('config_key', configKey);
                gr.setLimit(1);
                gr.query();

                if (gr.next()) {
                    response.setStatus(200);
                    response.setBody(JSON.stringify({
                        result: 'success',
                        config_key: configKey,
                        config_value: gr.getValue('config_value') || '',
                        description: gr.getValue('description') || ''
                    }));
                } else {
                    response.setStatus(404);
                    response.setBody(JSON.stringify({
                        result: 'not_found',
                        message: 'Config key "' + configKey + '" not found'
                    }));
                }
                return;
            }

            // Update or create config entry
            var gr = new GlideRecord('x_snc_tmh_config');
            gr.addQuery('config_key', configKey);
            gr.setLimit(1);
            gr.query();

            if (gr.next()) {
                gr.setValue('config_value', String(configValue));
                gr.setWorkflow(false);
                gr.update();
            } else {
                gr.initialize();
                gr.setValue('config_key', configKey);
                gr.setValue('config_value', String(configValue));
                gr.setValue('description', data.description || '');
                gr.insert();
            }

            response.setStatus(200);
            response.setBody(JSON.stringify({
                result: 'success',
                config_key: configKey,
                config_value: String(configValue),
                message: 'Configuration updated'
            }));
        } catch (e) {
            response.setStatus(500);
            response.setBody(JSON.stringify({
                result: 'error',
                message: 'Config operation failed: ' + e.message
            }));
        }
    },

    // ─── GET /status handler ──────────────────────────────────────────────

    /**
     * Handle GET /api/x_snc_tmh/status with query parameter routing.
     * @param {RESTAPIRequest} request
     * @param {RESTAPIResponse} response
     */
    _handleGet: function(request, response) {
        var queryParams = request.queryParams || {};
        var transformMapId = queryParams.transform_map || '';
        var summary = queryParams.summary || '';
        var genai = queryParams.genai || '';
        var limit = parseInt(queryParams.limit, 10) || 10;

        try {
            // GenAI Controller context format
            if (genai === 'true' && transformMapId) {
                this._handleGenAI(transformMapId, response);
                return;
            }

            // Summary mode: all transform maps, latest scores only
            if (summary === 'true') {
                this._handleSummary(response);
                return;
            }

            // Single transform map latest result
            if (transformMapId) {
                this._handleSingleStatus(transformMapId, response);
                return;
            }

            // Default: recent scan results
            var gr = new GlideRecord('x_snc_tmh_scan_result');
            gr.orderByDesc('scan_time');
            gr.setLimit(limit);
            gr.query();

            var results = [];
            while (gr.next()) {
                var tmId = gr.getValue('transform_map') || '';
                var tmName = '';
                if (tmId) {
                    var tm = new GlideRecord('sys_transform_map');
                    if (tm.get(tmId)) {
                        tmName = tm.getValue('name') || tmId;
                    }
                }

                results.push({
                    scan_result_id: gr.getUniqueValue(),
                    transform_map_id: tmId,
                    transform_map_name: tmName,
                    health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                    error_count: parseInt(gr.getValue('error_count'), 10) || 0,
                    error_rate: parseFloat(gr.getValue('error_rate')) || 0,
                    stale_mappings: parseInt(gr.getValue('stale_mappings'), 10) || 0,
                    coalesce_issues: parseInt(gr.getValue('coalesce_issues'), 10) || 0,
                    script_issues: parseInt(gr.getValue('script_issues'), 10) || 0,
                    scan_time: gr.getValue('scan_time') || ''
                });
            }

            response.setStatus(200);
            response.setBody(JSON.stringify({
                result: 'success',
                scan_results: results,
                total: results.length
            }));
        } catch (e) {
            response.setStatus(500);
            response.setBody(JSON.stringify({
                result: 'error',
                message: 'Status query failed: ' + e.message
            }));
        }
    },

    /**
     * GET /status?summary=true — all transform maps, latest scores only.
     */
    _handleSummary: function(response) {
        var gr = new GlideRecord('x_snc_tmh_scan_result');
        gr.addNotNullQuery('transform_map');
        gr.orderByDesc('scan_time');
        gr.setLimit(200);
        gr.query();

        var seenMaps = {};
        var results = [];
        var totalScore = 0;
        var criticalCount = 0;
        var warningCount = 0;

        while (gr.next()) {
            var tmId = gr.getValue('transform_map') || '';
            if (seenMaps[tmId]) {
                continue;
            }
            seenMaps[tmId] = true;

            var score = parseInt(gr.getValue('health_score'), 10) || 0;
            totalScore += score;

            if (score < 40) {
                criticalCount++;
            } else if (score < 70) {
                warningCount++;
            }

            var tmName = '';
            var tm = new GlideRecord('sys_transform_map');
            if (tm.get(tmId)) {
                tmName = tm.getValue('name') || tmId;
            }

            results.push({
                transform_map_id: tmId,
                transform_map_name: tmName,
                health_score: score,
                error_rate: parseFloat(gr.getValue('error_rate')) || 0,
                scan_time: gr.getValue('scan_time') || ''
            });
        }

        var avgScore = results.length > 0 ? Math.round(totalScore / results.length) : 0;

        response.setStatus(200);
        response.setBody(JSON.stringify({
            result: 'success',
            summary: {
                total_transform_maps: results.length,
                average_health_score: avgScore,
                critical: criticalCount,
                warning: warningCount,
                healthy: results.length - criticalCount - warningCount
            },
            transform_maps: results
        }));
    },

    /**
     * GET /status?transform_map=<id> — single transform map latest result.
     */
    _handleSingleStatus: function(transformMapId, response) {
        var gr = new GlideRecord('x_snc_tmh_scan_result');
        gr.addQuery('transform_map', transformMapId);
        gr.orderByDesc('scan_time');
        gr.setLimit(1);
        gr.query();

        if (gr.next()) {
            response.setStatus(200);
            response.setBody(JSON.stringify({
                result: 'success',
                scan_result_id: gr.getUniqueValue(),
                transform_map_id: transformMapId,
                health_score: parseInt(gr.getValue('health_score'), 10) || 0,
                error_count: parseInt(gr.getValue('error_count'), 10) || 0,
                error_rate: parseFloat(gr.getValue('error_rate')) || 0,
                stale_mappings: parseInt(gr.getValue('stale_mappings'), 10) || 0,
                coalesce_issues: parseInt(gr.getValue('coalesce_issues'), 10) || 0,
                script_issues: parseInt(gr.getValue('script_issues'), 10) || 0,
                findings_json: gr.getValue('findings_json') || '',
                recommendations_json: gr.getValue('recommendations_json') || '',
                run_trend_json: gr.getValue('run_trend_json') || '',
                scan_time: gr.getValue('scan_time') || ''
            }));
        } else {
            response.setStatus(404);
            response.setBody(JSON.stringify({
                result: 'not_found',
                message: 'No scan results for transform map ' + transformMapId
            }));
        }
    },

    /**
     * GET /status?genai=true&transform_map=<id> — GenAI Controller context.
     */
    _handleGenAI: function(transformMapId, response) {
        var gr = new GlideRecord('x_snc_tmh_scan_result');
        gr.addQuery('transform_map', transformMapId);
        gr.orderByDesc('scan_time');
        gr.setLimit(1);
        gr.query();

        if (!gr.next()) {
            response.setStatus(404);
            response.setBody(JSON.stringify({
                result: 'not_found',
                message: 'No scan results for transform map ' + transformMapId
            }));
            return;
        }

        var tmName = '';
        var tm = new GlideRecord('sys_transform_map');
        if (tm.get(transformMapId)) {
            tmName = tm.getValue('name') || transformMapId;
        }

        var findingsJson = gr.getValue('findings_json') || '';
        var recommendationsJson = gr.getValue('recommendations_json') || '';

        var findings = {};
        var recommendations = [];
        try {
            if (findingsJson) {
                findings = JSON.parse(findingsJson);
            }
            if (recommendationsJson) {
                recommendations = JSON.parse(recommendationsJson);
            }
        } catch (e) {
            // JSON parse failure — return raw strings
        }

        var recommendedActions = [];
        for (var i = 0; i < recommendations.length; i++) {
            if (recommendations[i].recommendation) {
                recommendedActions.push(recommendations[i].recommendation);
            }
        }

        response.setStatus(200);
        response.setBody(JSON.stringify({
            transform_map: tmName,
            transform_map_id: transformMapId,
            health_score: parseInt(gr.getValue('health_score'), 10) || 0,
            findings: findings,
            recommendations: recommendations,
            recommended_actions: recommendedActions,
            scan_time: gr.getValue('scan_time') || ''
        }));
    },

    type: 'TransformMapHealthAPI'
};
