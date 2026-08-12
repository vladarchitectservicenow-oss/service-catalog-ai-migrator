// REST Medic — Scripted REST API Health Auditor
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// RESTMedicEngine — Core engine for endpoint discovery, integrity validation,
// runtime monitoring, and composite health scoring.
// @class RESTMedicEngine @namespace x_vlad_rest_medic

var RESTMedicEngine = Class.create();
RESTMedicEngine.prototype = {
    initialize: function() {
        this.TABLE_ENDPOINT = 'x_vlad_rest_medic_endpoint';
        this.TABLE_CONFIG = 'x_vlad_rest_medic_config';
        this.INTEGRITY_WEIGHT = 0.6;
        this.RUNTIME_WEIGHT = 0.4;
        this.REST_LOG_HOURS = 24;
        this.REST_LOG_LIMIT = 10000;
    },

    /**
     * Full scan: discover all endpoints, run integrity + runtime checks, score, persist.
     * @returns {Object} {endpoint_count, healthy, warning, critical, avg_score}
     */
    scanAll: function() {
        var endpoints = this.discoverEndpoints();
        var results = { endpoint_count: 0, healthy: 0, warning: 0, critical: 0, avg_score: 0 };
        var totalScore = 0;

        for (var i = 0; i < endpoints.length; i++) {
            var ep = endpoints[i];
            var integrityResult = this.checkIntegrity(ep);
            var runtimeResult = this.monitorRuntime(ep);
            var score = this.calculateScore(integrityResult, runtimeResult);
            var status = this._scoreToStatus(score);

            this._persistEndpoint(ep, integrityResult, runtimeResult, score, status);
            results.endpoint_count++;
            totalScore += score;
            if (status === 'healthy') { results.healthy++; }
            else if (status === 'warning') { results.warning++; }
            else { results.critical++; }
        }

        if (results.endpoint_count > 0) {
            results.avg_score = Math.round(totalScore / results.endpoint_count);
        }
        return results;
    },

    /**
     * Deep scan a single endpoint by sys_id.
     * @param {string} endpointId - sys_id of x_vlad_rest_medic_endpoint record
     * @returns {Object} Full endpoint health data
     */
    scanOne: function(endpointId) {
        var gr = new GlideRecord(this.TABLE_ENDPOINT);
        if (!gr.get(endpointId)) {
            return { error: 'Endpoint not found: ' + endpointId };
        }

        var ep = {
            sys_id: gr.getUniqueValue(),
            endpoint_name: gr.getValue('endpoint_name'),
            endpoint_path: gr.getValue('endpoint_path'),
            http_method: gr.getValue('http_method'),
            scope: gr.getValue('scope'),
            script_include: gr.getValue('script_include'),
            auth_profile: gr.getValue('auth_profile')
        };

        var integrityResult = this.checkIntegrity(ep);
        var runtimeResult = this.monitorRuntime(ep);
        var score = this.calculateScore(integrityResult, runtimeResult);
        var status = this._scoreToStatus(score);

        this._persistEndpoint(ep, integrityResult, runtimeResult, score, status);

        return {
            endpoint: ep,
            integrity: integrityResult,
            runtime: runtimeResult,
            health_score: score,
            status: status
        };
    },

    /**
     * Discover all Scripted REST API endpoints across all scopes.
     * @returns {Array} Array of endpoint objects
     */
    discoverEndpoints: function() {
        var endpoints = [];
        var defGr = new GlideRecord('sys_ws_definition');
        defGr.addActiveQuery();
        defGr.query();

        while (defGr.next()) {
            var defId = defGr.getUniqueValue();
            var defName = defGr.getValue('name') || '';
            var defPath = defGr.getValue('path') || '';
            var defScope = defGr.getValue('sys_scope') || '';

            var opGr = new GlideRecord('sys_ws_operation');
            opGr.addQuery('web_service_definition', defId);
            opGr.addActiveQuery();
            opGr.query();

            while (opGr.next()) {
                var method = opGr.getValue('http_method') || 'GET';
                var scriptBody = opGr.getValue('script') || '';
                var authProfile = opGr.getValue('authentication_profile') || '';

                // Extract Script Include name from script body
                var siName = this._extractScriptInclude(scriptBody);

                endpoints.push({
                    definition_id: defId,
                    definition_name: defName,
                    endpoint_path: defPath,
                    http_method: method,
                    scope: defScope,
                    script_include: siName,
                    auth_profile: authProfile,
                    operation_id: opGr.getUniqueValue(),
                    script_body: scriptBody
                });
            }
        }
        return endpoints;
    },

    /**
     * Run 5 integrity checks against an endpoint.
     * @param {Object} ep - Endpoint object from discoverEndpoints()
     * @returns {Object} {checks: Array, pass_count, fail_count, warn_count, score}
     */
    checkIntegrity: function(ep) {
        var checks = [];
        var passCount = 0;
        var failCount = 0;
        var warnCount = 0;

        // Check 1: Script Include reference
        var siCheck = this._checkScriptInclude(ep.script_include);
        checks.push(siCheck);
        if (siCheck.status === 'pass') { passCount++; }
        else if (siCheck.status === 'fail') { failCount++; }
        else { warnCount++; }

        // Check 2: Authentication profile
        var authCheck = this._checkAuthProfile(ep.auth_profile);
        checks.push(authCheck);
        if (authCheck.status === 'pass') { passCount++; }
        else if (authCheck.status === 'fail') { failCount++; }
        else { warnCount++; }

        // Check 3: ACL coverage
        var aclCheck = this._checkACLCoverage(ep.operation_id);
        checks.push(aclCheck);
        if (aclCheck.status === 'pass') { passCount++; }
        else if (aclCheck.status === 'fail') { failCount++; }
        else { warnCount++; }

        // Check 4: Response consistency (schema check)
        var respCheck = this._checkResponseConsistency(ep.script_body);
        checks.push(respCheck);
        if (respCheck.status === 'pass') { passCount++; }
        else if (respCheck.status === 'fail') { failCount++; }
        else { warnCount++; }

        // Check 5: Deprecated API usage
        var depCheck = this._checkDeprecatedAPI(ep.script_body);
        checks.push(depCheck);
        if (depCheck.status === 'pass') { passCount++; }
        else if (depCheck.status === 'fail') { failCount++; }
        else { warnCount++; }

        var total = checks.length;
        var score = total > 0 ? Math.round((passCount / total) * 100) : 0;

        return {
            checks: checks,
            pass_count: passCount,
            fail_count: failCount,
            warn_count: warnCount,
            score: score
        };
    },

    /**
     * Analyze sys_rest_log for runtime health metrics.
     * @param {Object} ep - Endpoint object
     * @returns {Object} {error_rate, avg_response_ms, total_requests, error_count, traffic_status, score}
     */
    monitorRuntime: function(ep) {
        var now = new GlideDateTime();
        var since = new GlideDateTime();
        since.addSeconds(-1 * this.REST_LOG_HOURS * 3600);

        var logGr = new GlideRecord('sys_rest_log');
        logGr.addQuery('sys_created_on', '>=', since);
        logGr.addQuery('sys_created_on', '<=', now);
        logGr.addQuery('endpoint', 'CONTAINS', ep.endpoint_path);
        logGr.setLimit(this.REST_LOG_LIMIT);
        logGr.query();

        var totalRequests = 0;
        var agg = new GlideAggregate('sys_rest_log');
        agg.addQuery('sys_created_on', '>=', since);
        agg.addQuery('sys_created_on', '<=', now);
        agg.addQuery('endpoint', 'CONTAINS', ep.endpoint_path);
        agg.addAggregate('COUNT');
        agg.query();
        if (agg.next()) {
            totalRequests = parseInt(agg.getAggregate('COUNT') || '0', 10);
        }
        var errorCount = 0;
        var totalResponseTime = 0;
        var responseTimeCount = 0;

        while (logGr.next()) {
            var statusCode = parseInt(logGr.getValue('status_code') || '0', 10);
            if (statusCode >= 400) {
                errorCount++;
            }
            var respTime = parseInt(logGr.getValue('response_time') || '0', 10);
            if (respTime > 0) {
                totalResponseTime += respTime;
                responseTimeCount++;
            }
        }

        var errorRate = totalRequests > 0 ? Math.round((errorCount / totalRequests) * 100) : 0;
        var avgResponseMs = responseTimeCount > 0 ? Math.round(totalResponseTime / responseTimeCount) : 0;

        // Traffic status
        var trafficStatus = 'normal';
        if (totalRequests === 0) {
            trafficStatus = 'zero_traffic';
        } else if (totalRequests < 5) {
            trafficStatus = 'low_traffic';
        }

        // Runtime score: 100 - error_rate penalty - response_time penalty
        var score = 100;
        if (errorRate > 0) {
            score -= Math.min(errorRate * 2, 60);
        }
        if (avgResponseMs > 5000) {
            score -= 20;
        } else if (avgResponseMs > 2000) {
            score -= 10;
        }
        if (trafficStatus === 'zero_traffic') {
            score = Math.max(score - 10, 0);
        }
        score = Math.max(score, 0);

        return {
            error_rate: errorRate,
            avg_response_ms: avgResponseMs,
            total_requests: totalRequests,
            error_count: errorCount,
            traffic_status: trafficStatus,
            score: score
        };
    },

    /**
     * Calculate composite health score (integrity 60% + runtime 40%).
     * @param {Object} integrityResult - From checkIntegrity()
     * @param {Object} runtimeResult - From monitorRuntime()
     * @returns {number} 0-100 composite score
     */
    calculateScore: function(integrityResult, runtimeResult) {
        var integrityScore = integrityResult.score || 0;
        var runtimeScore = runtimeResult.score || 0;
        return Math.round(integrityScore * this.INTEGRITY_WEIGHT + runtimeScore * this.RUNTIME_WEIGHT);
    },

    /**
     * Get full health report for dashboard consumption.
     * @returns {Object} Summary + endpoint list
     */
    getHealthReport: function() {
        var gr = new GlideRecord(this.TABLE_ENDPOINT);
        gr.orderBy('health_score');
        gr.query();

        var endpoints = [];
        var totalScore = 0;
        var healthy = 0;
        var warning = 0;
        var critical = 0;

        while (gr.next()) {
            var status = gr.getValue('status') || 'unknown';
            var score = parseInt(gr.getValue('health_score') || '0', 10);

            endpoints.push({
                sys_id: gr.getUniqueValue(),
                endpoint_name: gr.getValue('endpoint_name') || '',
                endpoint_path: gr.getValue('endpoint_path') || '',
                http_method: gr.getValue('http_method') || '',
                scope: gr.getValue('scope') || '',
                health_score: score,
                integrity_score: parseInt(gr.getValue('integrity_score') || '0', 10),
                runtime_score: parseInt(gr.getValue('runtime_score') || '0', 10),
                status: status,
                error_count_24h: parseInt(gr.getValue('error_count_24h') || '0', 10),
                avg_response_ms: parseInt(gr.getValue('avg_response_ms') || '0', 10),
                last_scan: gr.getValue('last_scan') || ''
            });

            totalScore += score;
            if (status === 'healthy') { healthy++; }
            else if (status === 'warning') { warning++; }
            else { critical++; }
        }

        var count = endpoints.length;
        return {
            last_scan: new GlideDateTime().toString(),
            endpoint_count: count,
            healthy: healthy,
            warning: warning,
            critical: critical,
            avg_score: count > 0 ? Math.round(totalScore / count) : 0,
            endpoints: endpoints
        };
    },

    /**
     * Get AI-powered remediation suggestion via GenAI Controller.
     * @param {string} endpointId - sys_id of endpoint record
     * @returns {string} Natural-language remediation suggestion
     */
    getAISuggestion: function(endpointId) {
        var gr = new GlideRecord(this.TABLE_ENDPOINT);
        if (!gr.get(endpointId)) {
            return 'Endpoint not found.';
        }

        var issuesJson = gr.getValue('issues_json') || '[]';
        var issues = JSON.parse(issuesJson);
        if (issues.length === 0) {
            return 'No issues detected for this endpoint.';
        }

        var endpointName = gr.getValue('endpoint_name') || 'Unknown';
        var context = 'Scripted REST API "' + endpointName + '" has the following issues:\n';
        for (var i = 0; i < issues.length; i++) {
            var issue = issues[i];
            context += '- [' + issue.check + '] ' + issue.status + ': ' + issue.detail + '\n';
        }
        context += '\nProvide a concise remediation plan with actionable steps.';

        try {
            var genAI = new sn_generative_ai.GlideGenAI();
            var result = genAI.generate(context, { max_tokens: 500 });
            return result || 'AI suggestion unavailable.';
        } catch (e) {
            return 'AI suggestion unavailable: ' + e.toString();
        }
    },

    /**
     * Get a config property value.
     * @param {string} name - Property name
     * @param {string} defaultValue - Fallback value
     * @returns {string} Property value
     */
    getConfig: function(name, defaultValue) {
        var gr = new GlideRecord(this.TABLE_CONFIG);
        gr.addQuery('property_name', name);
        gr.setLimit(1);
        gr.query();
        if (gr.next()) {
            return gr.getValue('property_value') || defaultValue;
        }
        return defaultValue;
    },

    // ─── Private helpers ────────────────────────────────────────────

    _scoreToStatus: function(score) {
        if (score >= 80) { return 'healthy'; }
        if (score >= 50) { return 'warning'; }
        return 'critical';
    },

    _extractScriptInclude: function(scriptBody) {
        if (!scriptBody) { return ''; }
        // Match patterns like: new MyScriptInclude() or MyScriptInclude.method()
        var match = scriptBody.match(/new\s+(\w+)\s*\(/);
        if (match) { return match[1]; }
        match = scriptBody.match(/(\w+)\.\w+\s*\(/);
        if (match && match[1] !== 'this' && match[1] !== 'request' && match[1] !== 'response' && match[1] !== 'JSON' && match[1] !== 'gs' && match[1] !== 'GlideRecord' && match[1] !== 'GlideDateTime' && match[1] !== 'GlideEmailOutbound' && match[1] !== 'sn_ws' && match[1] !== 'GlideAggregate' && match[1] !== 'GlideDigest') {
            return match[1];
        }
        return '';
    },

    _checkScriptInclude: function(siName) {
        if (!siName) {
            return {
                check: 'script_include_reference',
                status: 'warn',
                detail: 'No Script Include reference detected. Endpoint may use inline script only.',
                remediation: 'If this endpoint uses a Script Include, ensure the class name is referenced in the script body.'
            };
        }

        var siGr = new GlideRecord('sys_script_include');
        siGr.addQuery('name', siName);
        siGr.addActiveQuery();
        siGr.setLimit(1);
        siGr.query();

        if (siGr.next()) {
            return {
                check: 'script_include_reference',
                status: 'pass',
                detail: 'Script Include "' + siName + '" found and active.',
                remediation: ''
            };
        }

        return {
            check: 'script_include_reference',
            status: 'fail',
            detail: 'Script Include "' + siName + '" not found or inactive.',
            remediation: 'Search sys_script_include for similar names. Check sys_audit for rename or delete events. Update the operation script with the correct Script Include name.'
        };
    },

    _checkAuthProfile: function(authProfile) {
        if (!authProfile) {
            return {
                check: 'auth_profile',
                status: 'warn',
                detail: 'No authentication profile configured. Endpoint may be unauthenticated.',
                remediation: 'Configure an authentication profile (Basic Auth or OAuth) if this endpoint should be secured.'
            };
        }

        // Check Basic Auth profile
        var basicGr = new GlideRecord('sys_auth_profile_basic');
        basicGr.addQuery('name', authProfile);
        basicGr.addActiveQuery();
        basicGr.setLimit(1);
        basicGr.query();
        if (basicGr.next()) {
            return {
                check: 'auth_profile',
                status: 'pass',
                detail: 'Basic Auth profile "' + authProfile + '" found and active.',
                remediation: ''
            };
        }

        // Check OAuth profile
        var oauthGr = new GlideRecord('sys_oauth_entity');
        oauthGr.addQuery('name', authProfile);
        oauthGr.addActiveQuery();
        oauthGr.setLimit(1);
        oauthGr.query();
        if (oauthGr.next()) {
            var accessExpiry = oauthGr.getValue('access_token_expires_at') || '';
            var refreshExpiry = oauthGr.getValue('refresh_token_expires_at') || '';
            var now = new GlideDateTime();

            if (accessExpiry) {
                var expiryGdt = new GlideDateTime();
                expiryGdt.setValue(accessExpiry);
                if (expiryGdt.before(now)) {
                    if (refreshExpiry) {
                        var refreshGdt = new GlideDateTime();
                        refreshGdt.setValue(refreshExpiry);
                        if (refreshGdt.after(now)) {
                            return {
                                check: 'auth_profile',
                                status: 'warn',
                                detail: 'OAuth access token expired but refresh token is still valid. Auto-refresh should handle this.',
                                remediation: 'Verify that the OAuth refresh mechanism is working. If auto-refresh fails, manually re-authorize the OAuth entity.'
                            };
                        }
                    }
                    return {
                        check: 'auth_profile',
                        status: 'fail',
                        detail: 'OAuth access token expired and no valid refresh token.',
                        remediation: 'Re-authorize the OAuth entity in sys_oauth_entity. Check that the OAuth provider credentials are still valid.'
                    };
                }
            }
            return {
                check: 'auth_profile',
                status: 'pass',
                detail: 'OAuth profile "' + authProfile + '" found and active.',
                remediation: ''
            };
        }

        return {
            check: 'auth_profile',
            status: 'fail',
            detail: 'Auth profile "' + authProfile + '" not found in sys_auth_profile_basic or sys_oauth_entity.',
            remediation: 'Verify the auth profile name matches an existing Basic Auth or OAuth profile. Check for typos or renamed profiles.'
        };
    },

    _checkACLCoverage: function(operationId) {
        if (!operationId) {
            return {
                check: 'acl_coverage',
                status: 'warn',
                detail: 'No operation ID available for ACL check.',
                remediation: ''
            };
        }

        var aclGr = new GlideRecord('sys_security_acl');
        aclGr.addQuery('operation', operationId);
        aclGr.addActiveQuery();
        aclGr.setLimit(1);
        aclGr.query();

        if (aclGr.next()) {
            return {
                check: 'acl_coverage',
                status: 'pass',
                detail: 'ACL records found for this operation.',
                remediation: ''
            };
        }

        return {
            check: 'acl_coverage',
            status: 'fail',
            detail: 'No ACL records found for this operation. Endpoint may be either wide-open or completely blocked.',
            remediation: 'Create ACL records in sys_security_acl for this operation. Define appropriate role-based access (e.g., x_vlad_rest_medic.user for read, x_vlad_rest_medic.admin for write).'
        };
    },

    _checkResponseConsistency: function(scriptBody) {
        if (!scriptBody) {
            return {
                check: 'response_consistency',
                status: 'warn',
                detail: 'No script body available for response consistency check.',
                remediation: ''
            };
        }

        var setBodyCalls = scriptBody.match(/response\.setBody\s*\(/g);
        if (!setBodyCalls || setBodyCalls.length === 0) {
            return {
                check: 'response_consistency',
                status: 'warn',
                detail: 'No response.setBody() calls found. Endpoint may not return a response body.',
                remediation: 'Ensure the endpoint returns a consistent JSON response body for all code paths.'
            };
        }

        // Check for JSON.stringify usage (best practice)
        var jsonStringifyCalls = scriptBody.match(/JSON\.stringify\s*\(/g);
        if (!jsonStringifyCalls || jsonStringifyCalls.length < setBodyCalls.length) {
            return {
                check: 'response_consistency',
                status: 'warn',
                detail: 'Not all response.setBody() calls use JSON.stringify(). Raw objects may return [object Object].',
                remediation: 'Wrap all response.setBody() arguments with JSON.stringify() to ensure consistent JSON output.'
            };
        }

        return {
            check: 'response_consistency',
            status: 'pass',
            detail: 'All response.setBody() calls use JSON.stringify().',
            remediation: ''
        };
    },

    _checkDeprecatedAPI: function(scriptBody) {
        if (!scriptBody) {
            return {
                check: 'deprecated_api',
                status: 'warn',
                detail: 'No script body available for deprecated API check.',
                remediation: ''
            };
        }

        var deprecatedAPIs = [
            { pattern: /\.getRowCount\s*\(/g, name: 'getRowCount()', replacement: 'GlideAggregate' },
            { pattern: /\.addEncodedQuery\s*\(/g, name: 'addEncodedQuery()', replacement: 'addQuery()' },
            { pattern: /gs\.eventQueue\b\s*\(/g, name: 'gs.eventQueue()', replacement: 'gs.eventQueueScheduled()' },
            { pattern: /GlideDigest\.getDigest\s*\(/g, name: 'GlideDigest.getDigest()', replacement: 'GlideDigest (deprecated, use external hashing)' }
        ];

        var found = [];
        for (var i = 0; i < deprecatedAPIs.length; i++) {
            var api = deprecatedAPIs[i];
            if (api.pattern.test(scriptBody)) {
                found.push({ name: api.name, replacement: api.replacement });
            }
        }

        if (found.length > 0) {
            var detail = 'Deprecated APIs found: ';
            for (var j = 0; j < found.length; j++) {
                detail += found[j].name + ' (use ' + found[j].replacement + ')';
                if (j < found.length - 1) { detail += ', '; }
            }
            return {
                check: 'deprecated_api',
                status: 'fail',
                detail: detail,
                remediation: 'Replace deprecated APIs with their recommended alternatives. These may break on future platform upgrades.'
            };
        }

        return {
            check: 'deprecated_api',
            status: 'pass',
            detail: 'No deprecated APIs detected.',
            remediation: ''
        };
    },

    _persistEndpoint: function(ep, integrityResult, runtimeResult, score, status) {
        var gr = new GlideRecord(this.TABLE_ENDPOINT);

        // Find existing record by path + method
        gr.addQuery('endpoint_path', ep.endpoint_path);
        gr.addQuery('http_method', ep.http_method);
        gr.setLimit(1);
        gr.query();

        var isNew = !gr.next();
        if (isNew) {
            gr.initialize();
        }

        gr.setValue('endpoint_name', ep.definition_name || ep.endpoint_path);
        gr.setValue('endpoint_path', ep.endpoint_path);
        gr.setValue('http_method', ep.http_method);
        gr.setValue('scope', ep.scope);
        gr.setValue('script_include', ep.script_include || '');
        gr.setValue('auth_profile', ep.auth_profile || '');
        gr.setValue('health_score', score);
        gr.setValue('integrity_score', integrityResult.score);
        gr.setValue('runtime_score', runtimeResult.score);
        gr.setValue('issues_json', JSON.stringify(integrityResult.checks));
        gr.setValue('error_count_24h', runtimeResult.error_count);
        gr.setValue('avg_response_ms', runtimeResult.avg_response_ms);
        gr.setValue('status', status);
        gr.setValue('last_scan', new GlideDateTime().toString());

        // Append to score history
        var historyJson = gr.getValue('score_history_json') || '[]';
        var history = JSON.parse(historyJson);
        history.push({ date: new GlideDateTime().toString().split(' ')[0], score: score });
        // Keep last 30 entries
        if (history.length > 30) {
            history = history.slice(history.length - 30);
        }
        gr.setValue('score_history_json', JSON.stringify(history));

        try {
            if (isNew) {
                gr.insert();
            } else {
                gr.setWorkflow(false);
                gr.update();
            }
        } catch (e) {
            gs.error('RESTMedicEngine: Failed to persist endpoint ' + ep.endpoint_path + ': ' + e.toString());
        }
    },

    type: 'RESTMedicEngine'
};
