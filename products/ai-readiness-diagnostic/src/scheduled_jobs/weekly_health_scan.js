/** Weekly Health Scan — Scheduled Job. Runs Sundays 03:00. */
(function() {
    var scanner = new x_snc_ard.ProcessDebtScanner();
    var result = scanner.fullScan();
    var cmdb = new x_snc_ard.CMDBHealthAnalyzer(scanner.diagRunId); cmdb.analyze("cmdb_ci");
    var kb = new x_snc_ard.KBAnalyzer(scanner.diagRunId); kb.analyze();
    var sim = new x_snc_ard.AISimulator(scanner.diagRunId); sim.simulateAll();
    new x_snc_ard.RoadmapGenerator(scanner.diagRunId).generate();
    gs.info("ARD Weekly Scan: " + result.workflows_scanned + " workflows, " + result.broken_count + " broken");
})();
