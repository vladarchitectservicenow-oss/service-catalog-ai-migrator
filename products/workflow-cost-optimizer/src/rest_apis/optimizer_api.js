/**
 * Scripted REST API — Workflow Cost Optimizer
 * Base: /api/x_snc_wco/v1/
 */
(function process(request, response) {
    var path = request.pathInfo, method = request.method;
    try {
        if (method === "GET" && path === "profiles") return getProfiles(request, response);
        if (method === "GET" && path === "compare") return compareCosts(request, response);
        if (method === "POST" && path === "optimize") return optimizeRouting(request, response);
        response.setStatus(404); response.setBody(JSON.stringify({error:"Not found"}));
    } catch(e) { response.setStatus(500); response.setBody(JSON.stringify({error:e.message})); }
    
    function getProfiles(req, res) {
        var gr = new GlideRecord("x_snc_wco_profile"), profiles = []; gr.query();
        while(gr.next()) profiles.push({id:gr.getUniqueValue(),name:gr.getValue("name"),volume:gr.getValue("monthly_volume"),affinity:gr.getValue("channel_affinity"),complexity:gr.getValue("complexity")});
        res.setStatus(200); res.setBody(JSON.stringify({profiles:profiles,count:profiles.length}));
    }
    
    function compareCosts(req, res) {
        var profGr = new GlideRecord("x_snc_wco_profile"); profGr.query();
        var calc = new x_snc_wco.CostCalculator(), comparisons = [];
        while(profGr.next()) comparisons.push(calc.calculateForWorkflow(profGr.getUniqueValue()));
        res.setStatus(200); res.setBody(JSON.stringify({comparisons:comparisons}));
    }
    
    function optimizeRouting(req, res) {
        var body = request.body ? request.body.data : {}, budget = body.budget || null;
        var profiler = new x_snc_wco.WorkflowProfiler(); profiler.profileAll();
        var engine = new x_snc_wco.RoutingEngine();
        var routing = engine.generateOptimalRouting(budget);
        var roi = engine.roiProjection();
        res.setStatus(200); res.setBody(JSON.stringify({routing:routing,roi:roi}));
    }
})(request, response);
