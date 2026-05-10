/**
 * Scripted REST API — AI Readiness Diagnostic
 * Base: /api/x_snc_ard/v1/
 */
(function process(request, response) {
    var path = request.pathInfo, method = request.method;
    try {
        if (method === "POST" && path === "diagnose") return runDiagnostic(request, response);
        if (method === "GET" && path.startsWith("diagnose/")) return getDiagnostic(request, response, path.substring(9));
        if (method === "GET" && path === "simulate") return runSimulation(request, response);
        if (method === "GET" && path === "dashboard") return getDashboard(request, response);
        response.setStatus(404); response.setBody(JSON.stringify({error:"Not found"}));
    } catch(e) { response.setStatus(500); response.setBody(JSON.stringify({error:e.message})); }
    
    function runDiagnostic(req, res) {
        var scanner = new x_snc_ard.ProcessDebtScanner(); var result = scanner.fullScan();
        var cmdb = new x_snc_ard.CMDBHealthAnalyzer(scanner.diagRunId); cmdb.analyze("cmdb_ci");
        var kb = new x_snc_ard.KBAnalyzer(scanner.diagRunId); kb.analyze();
        var sim = new x_snc_ard.AISimulator(scanner.diagRunId); sim.simulateAll();
        var roadmap = new x_snc_ard.RoadmapGenerator(scanner.diagRunId); roadmap.generate();
        res.setStatus(200); res.setBody(JSON.stringify({diag_run_id:scanner.diagRunId,status:"COMPLETED",workflows_scanned:result.workflows_scanned,broken_count:result.broken_count}));
    }
    function getDiagnostic(req, res, id) {
        var gr = new GlideRecord("x_snc_ard_diag_run");
        if (!gr.get(id)) { res.setStatus(404); res.setBody(JSON.stringify({error:"Not found"})); return; }
        res.setStatus(200); res.setBody(JSON.stringify({status:gr.getValue("status"),workflows_scanned:gr.getValue("workflows_scanned"),workflows_broken:gr.getValue("workflows_broken"),completed_at:gr.getValue("completed_at")}));
    }
    function runSimulation(req, res) {
        var gr = new GlideRecord("x_snc_ard_diag_run"); gr.addQuery("status","COMPLETED"); gr.orderByDesc("completed_at"); gr.setLimit(1); gr.query();
        if (!gr.next()) { res.setStatus(404); res.setBody(JSON.stringify({error:"No completed diagnostic"})); return; }
        var simGr = new GlideRecord("x_snc_ard_simulation_result"); simGr.addQuery("diag_run",gr.getUniqueValue()); simGr.query();
        var results = []; while(simGr.next()) results.push({result:simGr.getValue("result"),gap:simGr.getValue("failure_gap")});
        var pass = results.filter(function(r){return r.result==="PASS"}).length;
        var warn = results.filter(function(r){return r.result==="WARNING"}).length;
        var fail = results.filter(function(r){return r.result==="FAIL"}).length;
        res.setStatus(200); res.setBody(JSON.stringify({pass:pass,warning:warn,fail:fail,total:results.length,results:results}));
    }
    function getDashboard(req, res) {
        var gr = new GlideRecord("x_snc_ard_diag_run"); gr.addQuery("status","COMPLETED"); gr.orderByDesc("completed_at"); gr.setLimit(1); gr.query();
        if (!gr.next()) { res.setStatus(200); res.setBody(JSON.stringify({readiness_score:0,message:"No diagnostic yet"})); return; }
        var whGa = new GlideAggregate("x_snc_ard_workflow_health"); whGa.addAggregate("AVG","health_score"); whGa.addQuery("diag_run",gr.getUniqueValue()); whGa.query();
        var whScore = whGa.next() ? Math.round(parseFloat(whGa.getAggregate("AVG","health_score"))) : 0;
        var cmdbGr = new GlideRecord("x_snc_ard_cmdb_health"); cmdbGr.addQuery("diag_run",gr.getUniqueValue()); cmdbGr.query();
        var cmdbScore = cmdbGr.next() ? parseInt(cmdbGr.getValue("completeness_pct")) : 0;
        var kbGr = new GlideRecord("x_snc_ard_kb_health"); kbGr.addQuery("diag_run",gr.getUniqueValue()); kbGr.query();
        var kbScore = kbGr.next() ? parseInt(kbGr.getValue("knowledge_readiness")) : 0;
        var readiness = Math.round(whScore * 0.4 + cmdbScore * 0.35 + kbScore * 0.25);
        res.setStatus(200); res.setBody(JSON.stringify({readiness_score:readiness,workflow_health:whScore,cmdb_health:cmdbScore,kb_health:kbScore,last_scan:gr.getValue("completed_at")}));
    }
})(request, response);
