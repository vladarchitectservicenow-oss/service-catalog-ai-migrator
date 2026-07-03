// SN Release Impact Digest — REST API: GET /status
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Consolidated reporting endpoint. Query parameters:
//   - run_id: Fetch a specific digest run with its impact events and regression cases
//   - latest: Fetch the most recent completed digest run
//   - summary: Fetch summary of all digest runs (no detail)
//
// @endpoint GET /api/x_snc_rid/v1/status
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var queryParams = request.queryParams;
    var runId = queryParams.run_id || '';
    var latest = queryParams.latest === 'true';
    var summary = queryParams.summary === 'true';

    try {
        if (runId) {
            _handleRunById(response, runId);
        } else if (latest) {
            _handleLatest(response);
        } else if (summary) {
            _handleSummary(response);
        } else {
            _handleLatest(response); // default: return latest
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error fetching status',
            message: e.message || e.toString()
        }));
    }

    /**
     * Fetch a specific digest run by run_id.
     */
    function _handleRunById(response, runId) {
        var gr = new GlideRecord('x_snc_rid_digest_run');
        gr.addQuery('run_id', runId);
        gr.query();
        if (!gr.next()) {
            response.setStatus(404);
            response.setBody(JSON.stringify({
                error: 'Digest run not found',
                run_id: runId
            }));
            return;
        }

        var runData = _serializeRun(gr);

        // Fetch associated impact events — ordered by breaking_risk_score DESC
        // so the highest-risk items appear first in the response (UX expectation
        // for an impact report).
        var impactEvents = [];
        var eventGr = new GlideRecord('x_snc_rid_impact_event');
        eventGr.addQuery('digest_run', gr.getUniqueValue());
        eventGr.addQuery('record_type', 'impact_event');
        eventGr.orderByDesc('breaking_risk_score');
        eventGr.query();
        while (eventGr.next()) {
            impactEvents.push({
                sys_id: eventGr.getUniqueValue(),
                name: eventGr.getValue('name') || '',
                component: eventGr.getValue('component') || '',
                change_type: eventGr.getValue('change_type') || '',
                match_tier: eventGr.getValue('match_tier') || '',
                confidence: parseInt(eventGr.getValue('confidence') || '0', 10),
                breaking_risk_score: parseInt(eventGr.getValue('breaking_risk_score') || '0', 10),
                reasoning: eventGr.getValue('reasoning') || '',
                affected_components: eventGr.getValue('affected_components') || '',
                migration_notes: eventGr.getValue('migration_notes') || ''
            });
        }

        // Fetch associated regression cases
        var regressionCases = [];
        var caseGr = new GlideRecord('x_snc_rid_impact_event');
        caseGr.addQuery('digest_run', gr.getUniqueValue());
        caseGr.addQuery('record_type', 'regression_case');
        caseGr.orderBy('priority');
        caseGr.query();
        while (caseGr.next()) {
            regressionCases.push({
                sys_id: caseGr.getUniqueValue(),
                name: caseGr.getValue('name') || '',
                priority: parseInt(caseGr.getValue('priority') || '0', 10),
                risk_label: caseGr.getValue('risk_label') || '',
                breaking_risk_score: parseInt(caseGr.getValue('breaking_risk_score') || '0', 10),
                test_instruction: caseGr.getValue('test_instruction') || '',
                expected_behavior: caseGr.getValue('expected_behavior') || '',
                risk_if_skipped: caseGr.getValue('risk_if_skipped') || '',
                state: caseGr.getValue('state') || 'pending',
                assigned_to: caseGr.getValue('assigned_to') || ''
            });
        }

        response.setStatus(200);
        response.setBody(JSON.stringify({
            run: runData,
            impact_events: impactEvents,
            regression_cases: regressionCases
        }));
    }

    /**
     * Fetch the most recent completed digest run.
     */
    function _handleLatest(response) {
        var gr = new GlideRecord('x_snc_rid_digest_run');
        gr.addQuery('status', 'complete');
        gr.orderByDesc('completed_at');
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) {
            response.setStatus(404);
            response.setBody(JSON.stringify({
                error: 'No completed digest runs found'
            }));
            return;
        }

        _handleRunById(response, gr.getValue('run_id'));
    }

    /**
     * Fetch summary of all digest runs.
     * Supports pagination via `offset` and `limit` query parameters.
     * Default: limit=50, offset=0. Hard cap: limit<=200.
     */
    function _handleSummary(response) {
        var offsetParam = parseInt(queryParams.offset || '0', 10);
        var limitParam = parseInt(queryParams.limit || '50', 10);
        if (isNaN(offsetParam) || offsetParam < 0) { offsetParam = 0; }
        if (isNaN(limitParam) || limitParam <= 0) { limitParam = 50; }
        if (limitParam > 200) { limitParam = 200; }

        var runs = [];
        var gr = new GlideRecord('x_snc_rid_digest_run');
        gr.orderByDesc('started_at');
        gr.setLimit(limitParam);
        gr.setOffset(offsetParam);
        gr.query();
        while (gr.next()) {
            runs.push(_serializeRun(gr));
        }

        // Total count for pagination metadata
        var totalGr = new GlideRecord('x_snc_rid_digest_run');
        totalGr.query();
        totalGr.getRowCount();

        response.setStatus(200);
        response.setBody(JSON.stringify({
            total_runs: totalGr.getRowCount(),
            offset: offsetParam,
            limit: limitParam,
            returned: runs.length,
            runs: runs
        }));
    }

    /**
     * Serialize a digest run GlideRecord to a plain object.
     */
    function _serializeRun(gr) {
        return {
            sys_id: gr.getUniqueValue(),
            run_id: gr.getValue('run_id') || '',
            release_family: gr.getValue('release_family') || '',
            status: gr.getValue('status') || '',
            started_at: gr.getValue('started_at') || '',
            completed_at: gr.getValue('completed_at') || '',
            total_plugins: parseInt(gr.getValue('total_plugins') || '0', 10),
            total_custom_tables: parseInt(gr.getValue('total_custom_tables') || '0', 10),
            total_business_rules: parseInt(gr.getValue('total_business_rules') || '0', 10),
            total_client_scripts: parseInt(gr.getValue('total_client_scripts') || '0', 10),
            total_ui_policies: parseInt(gr.getValue('total_ui_policies') || '0', 10),
            total_scheduled_jobs: parseInt(gr.getValue('total_scheduled_jobs') || '0', 10),
            total_flows: parseInt(gr.getValue('total_flows') || '0', 10),
            total_rest_endpoints: parseInt(gr.getValue('total_rest_endpoints') || '0', 10),
            total_release_notes: parseInt(gr.getValue('total_release_notes') || '0', 10),
            total_impact_events: parseInt(gr.getValue('total_impact_events') || '0', 10),
            critical_count: parseInt(gr.getValue('critical_count') || '0', 10),
            high_count: parseInt(gr.getValue('high_count') || '0', 10),
            medium_count: parseInt(gr.getValue('medium_count') || '0', 10),
            low_count: parseInt(gr.getValue('low_count') || '0', 10),
            error_message: gr.getValue('error_message') || ''
        };
    }

})(request, response);
