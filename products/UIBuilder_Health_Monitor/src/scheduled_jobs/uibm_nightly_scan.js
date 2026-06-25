/**
 * UIBM Nightly Scan — Scheduled Job Script
 *
 * Runs at 02:00 daily (configurable via x_snc_uibm.scan.schedule).
 * Executes full complexity scan + dependency analysis across all UI Builder pages.
 */
(function() {
    gs.log('[UIBM] Nightly scan started at ' + new GlideDateTime().getDisplayValue());

    try {
        // Phase 1: Complexity scan
        var core = new UIBMCore();
        var scanResult = core.scanAllPages();
        gs.log('[UIBM] Complexity scan complete: ' + (scanResult.ok ? scanResult.data.pages_scanned + ' pages scanned' : scanResult.error));

        // Phase 2: Dependency analysis (cycle detection, orphan detection, broken refs)
        var analyzer = new UIBMAnalyzer();
        var analysisResult = analyzer.runFullAnalysis();
        gs.log('[UIBM] Dependency analysis complete: ' + (analysisResult.ok ?
            analysisResult.data.pages_analyzed + ' pages, ' +
            analysisResult.data.cycles_found + ' cycles, ' +
            analysisResult.data.broken_refs_found + ' broken refs, ' +
            analysisResult.data.orphans_found + ' orphans' : analysisResult.error));

        // Phase 3: Generate recommendations for pages with findings
        var grHealth = new GlideRecord('x_snc_uibm_page_health');
        grHealth.addNotNullQuery('complexity_score');
        grHealth.addQuery('score_category', 'red');
        grHealth.query();
        var recCount = 0;
        while (grHealth.next()) {
            var pageId = grHealth.page_sys_id.toString();
            var recResult = core.getRecommendations(pageId);
            if (recResult.ok) recCount += recResult.data.length;
        }
        gs.log('[UIBM] Recommendations generated: ' + recCount + ' for red-category pages');

    } catch (ex) {
        gs.logError('[UIBM Nightly Scan] Fatal error: ' + ex.message);
    }

    gs.log('[UIBM] Nightly scan completed at ' + new GlideDateTime().getDisplayValue());
})();