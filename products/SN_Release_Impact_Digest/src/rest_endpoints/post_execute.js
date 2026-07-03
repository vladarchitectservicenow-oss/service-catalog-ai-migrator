// SN Release Impact Digest — REST API: POST /execute
// Copyright (C) 2026 Vladimir Kapustin
// SPDX-License-Identifier: AGPL-3.0
//
// Consolidated REST endpoint. Accepts an "action" body parameter to dispatch:
//   - "inventory": Run inventory scan and return instance fingerprint
//   - "run_digest": Run full digest (inventory + cross-reference + scoring + checklist)
//
// @endpoint POST /api/x_snc_rid/v1/execute
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var body = request.body.data;
    var action = body.action || '';

    try {
        switch (action) {
            case 'inventory':
                _handleInventory(request, response);
                break;
            case 'run_digest':
                _handleRunDigest(request, response);
                break;
            default:
                response.setStatus(400);
                response.setBody(JSON.stringify({
                    error: 'Invalid action. Supported actions: inventory, run_digest',
                    provided: action
                }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({
            error: 'Internal error during execution',
            message: e.message || e.toString(),
            action: action
        }));
    }

    /**
     * Handle inventory scan action.
     */
    function _handleInventory(request, response) {
        var scanner = new RIDInventoryScanner();
        var includeApiUsage = body.include_api_usage !== false;
        var inventoryJson = scanner.scan(includeApiUsage);

        // Persist inventory snapshot
        _persistInventory(inventoryJson);

        response.setStatus(200);
        response.setBody(JSON.stringify({
            action: 'inventory',
            status: 'complete',
            data: JSON.parse(inventoryJson)
        }));
    }

    /**
     * Handle full digest run: inventory → cross-reference → scoring → checklist.
     */
    function _handleRunDigest(request, response) {
        var releaseFamily = body.release_family || '';
        var releaseNotes = body.release_notes || [];

        if (!releaseFamily) {
            response.setStatus(400);
            response.setBody(JSON.stringify({
                error: 'release_family is required for run_digest action'
            }));
            return;
        }

        // Step 1: Create digest run record
        var runGr = new GlideRecord('x_snc_rid_digest_run');
        runGr.initialize();
        runGr.setValue('run_id', gs.generateGUID());
        runGr.setValue('release_family', releaseFamily);
        runGr.setValue('status', 'scanning');
        runGr.setValue('started_at', new GlideDateTime().getDisplayValue());
        runGr.setValue('triggered_by', gs.getUserID());
        var runSysId = runGr.insert();

        // Step 2: Run inventory scan
        var scanner = new RIDInventoryScanner();
        var inventoryJson = scanner.scan(true);
        var inventory = JSON.parse(inventoryJson);

        // GlideRecord remains writable after insert(); re-query here is a defensive
        // pattern that gives us a fresh, server-populated object (e.g. with
        // auto-numbered fields or BR-derived values reflected). Not strictly
        // required for setValue+update, but kept for clarity and to avoid stale
        // local state if a before-insert BR mutates fields.
        runGr = new GlideRecord('x_snc_rid_digest_run');
        runGr.get(runSysId);

        // Update run with inventory stats
        runGr.setValue('total_plugins', inventory.summary.total_plugins);
        runGr.setValue('total_custom_tables', inventory.summary.total_custom_tables);
        runGr.setValue('total_business_rules', inventory.summary.total_business_rules);
        runGr.setValue('total_client_scripts', inventory.summary.total_client_scripts);
        runGr.setValue('total_ui_policies', inventory.summary.total_ui_policies);
        runGr.setValue('total_scheduled_jobs', inventory.summary.total_scheduled_jobs);
        runGr.setValue('total_flows', inventory.summary.total_flows);
        runGr.setValue('total_rest_endpoints', inventory.summary.total_rest_endpoints);
        runGr.setValue('status', 'matching');
        runGr.update();

        // Step 3: Cross-reference
        var engine = new RIDImpactScoringEngine(inventoryJson);
        var impactResults = engine.crossReference(releaseNotes);

        // Step 4: Generate regression checklist
        var checklist = engine.generateRegressionChecklist(impactResults);

        // Step 5: Persist impact events
        var criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0;
        for (var i = 0; i < impactResults.length; i++) {
            var r = impactResults[i];
            var eventGr = new GlideRecord('x_snc_rid_impact_event');
            eventGr.initialize();
            eventGr.setValue('record_type', 'impact_event');
            eventGr.setValue('name', r.component + ' — ' + r.change_type);
            eventGr.setValue('description', r.description);
            eventGr.setValue('release_family', r.release_family);
            eventGr.setValue('module', r.module);
            eventGr.setValue('component', r.component);
            eventGr.setValue('change_type', r.change_type);
            eventGr.setValue('match_tier', r.match_tier);
            eventGr.setValue('confidence', r.confidence);
            eventGr.setValue('breaking_risk_score', r.breaking_risk_score);
            eventGr.setValue('reasoning', r.reasoning);
            eventGr.setValue('affected_components', r.affected_components.join(', '));
            eventGr.setValue('migration_notes', r.migration_notes);
            eventGr.setValue('digest_run', runSysId);
            eventGr.insert();

            if (r.breaking_risk_score >= 80) { criticalCount++; }
            else if (r.breaking_risk_score >= 50) { highCount++; }
            else if (r.breaking_risk_score >= 25) { mediumCount++; }
            else { lowCount++; }
        }

        // Step 6: Persist regression cases
        for (var j = 0; j < checklist.length; j++) {
            var tc = checklist[j];
            var caseGr = new GlideRecord('x_snc_rid_impact_event');
            caseGr.initialize();
            caseGr.setValue('record_type', 'regression_case');
            caseGr.setValue('name', 'TC-' + tc.priority + ': ' + tc.component);
            caseGr.setValue('description', tc.test_instruction);
            caseGr.setValue('priority', tc.priority);
            caseGr.setValue('risk_label', tc.risk_label);
            caseGr.setValue('breaking_risk_score', tc.breaking_risk_score);
            caseGr.setValue('test_instruction', tc.test_instruction);
            caseGr.setValue('expected_behavior', tc.expected_behavior);
            caseGr.setValue('risk_if_skipped', tc.risk_if_skipped);
            caseGr.setValue('state', 'pending');
            caseGr.setValue('digest_run', runSysId);
            caseGr.insert();
        }

        // Step 7: Finalize run
        runGr = new GlideRecord('x_snc_rid_digest_run');
        runGr.get(runSysId);
        runGr.setValue('status', 'complete');
        runGr.setValue('completed_at', new GlideDateTime().getDisplayValue());
        runGr.setValue('total_release_notes', releaseNotes.length);
        runGr.setValue('total_impact_events', impactResults.length);
        runGr.setValue('critical_count', criticalCount);
        runGr.setValue('high_count', highCount);
        runGr.setValue('medium_count', mediumCount);
        runGr.setValue('low_count', lowCount);
        // Guard against silent truncation: summary_json has max_length=8000.
        // If the JSON grows beyond that, store a summary in error_message and
        // log a warning instead of overwriting with a truncated blob.
        var summaryObj = {
            total_impact_events: impactResults.length,
            critical: criticalCount,
            high: highCount,
            medium: mediumCount,
            low: lowCount,
            regression_cases: checklist.length
        };
        var summaryStr = JSON.stringify(summaryObj);
        if (summaryStr.length > 8000) {
            runGr.setValue('error_message',
                'summary_json exceeded 8000 chars (actual=' + summaryStr.length +
                '). Object skipped to prevent silent truncation. Increase field max_length or split payload.');
            runGr.setValue('summary_json', '');
        } else {
            runGr.setValue('summary_json', summaryStr);
        }
        runGr.update();

        response.setStatus(200);
        response.setBody(JSON.stringify({
            action: 'run_digest',
            status: 'complete',
            run_id: runGr.getValue('run_id'),
            run_sys_id: runSysId,
            summary: {
                total_impact_events: impactResults.length,
                critical: criticalCount,
                high: highCount,
                medium: mediumCount,
                low: lowCount,
                regression_cases: checklist.length
            },
            impact_events: impactResults,
            regression_checklist: checklist
        }));
    }

    /**
     * Persist inventory snapshot to the impact_event table (record_type=inventory).
     */
    function _persistInventory(inventoryJson) {
        var inventory = JSON.parse(inventoryJson);

        // Store summary as a single inventory record
        var gr = new GlideRecord('x_snc_rid_impact_event');
        gr.initialize();
        gr.setValue('record_type', 'inventory');
        gr.setValue('name', 'Inventory Snapshot — ' + inventory.generated_at);
        gr.setValue('description', 'Instance fingerprint with ' +
            inventory.summary.total_plugins + ' plugins, ' +
            inventory.summary.total_custom_tables + ' custom tables, ' +
            inventory.summary.total_business_rules + ' business rules');
        gr.setValue('payload', inventoryJson);
        gr.insert();
    }

})(request, response);
