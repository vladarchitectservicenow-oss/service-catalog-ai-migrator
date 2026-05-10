/** Monthly Cost Scan — Scheduled Job. Runs 1st of month at 02:00. */
(function() {
    var profiler = new x_snc_wco.WorkflowProfiler(); profiler.profileAll();
    var engine = new x_snc_wco.RoutingEngine();
    var result = engine.generateOptimalRouting(null);
    gs.info("WCO Monthly Scan: " + result.routing_map.length + " workflows routed. Monthly: $" + result.total_monthly_cost);
})();
