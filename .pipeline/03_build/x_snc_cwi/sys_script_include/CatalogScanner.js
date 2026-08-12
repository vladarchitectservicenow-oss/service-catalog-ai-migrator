var CatalogScanner = Class.create();
CatalogScanner.prototype = {
    initialize: function() {},

    /**
     * Execute full catalog scan and persist results.
     * @return {Object} { scannedCount, classifiedItems, patterns }
     */
    runFullScan: function() {
        var classifier = new CatalogPatternClassifier();
        var items = classifier.classifyAll();
        var patterns = { APPROVAL: 0, PROVISIONING: 0, NOTIFICATION: 0, ESCALATION: 0, UNKNOWN: 0 };
        var runGr = new GlideRecord('x_snc_cwi_scan_run');
        runGr.initialize();
        runGr.state = 'running';
        runGr.started = new GlideDateTime();
        var runId = runGr.insert();

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            patterns[item.primaryPattern] = (patterns[item.primaryPattern] || 0) + 1;

            var resGr = new GlideRecord('x_snc_cwi_scan_result');
            resGr.initialize();
            resGr.scan_run = runId;
            resGr.catalog_item = item.sys_id;
            resGr.catalog_item_name = item.name;
            resGr.primary_pattern = item.primaryPattern;
            resGr.confidence = item.confidence;
            resGr.score_json = JSON.stringify(item.scores);
            resGr.state = item.confidence >= 60 ? 'classified' : 'needs_review';
            resGr.insert();
        }

        runGr.state = 'complete';
        runGr.completed = new GlideDateTime();
        runGr.items_scanned = items.length;
        runGr.update();

        return { scannedCount: items.length, classifiedItems: items, patterns: patterns, runId: runId };
    },

    type: 'CatalogScanner'
};
