/**
 * Scripted REST API — Sandbox Migration Shield Scanner
 * 
 * Endpoints for triggering scans, retrieving results, and running migrations.
 * 
 * Base path: /api/x_snc_sms/v1/
 * Authentication: Basic Auth or OAuth token with x_snc_sms.admin role
 */

(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    
    var path = request.pathInfo;
    var method = request.method;
    
    try {
        switch (true) {
            case (method === "POST" && path === "scan"):
                return triggerScan(request, response);
            case (method === "GET" && path.startsWith("scan/")):
                return getScanResults(request, response, path.substring(5));
            case (method === "POST" && path === "migrate"):
                return executeMigration(request, response);
            case (method === "POST" && path === "preview-migration"):
                return previewMigration(request, response);
            case (method === "POST" && path === "exemption"):
                return createExemption(request, response);
            case (method === "GET" && path === "dashboard"):
                return getDashboard(request, response);
            default:
                response.setStatus(404);
                response.setBody(JSON.stringify({ error: "Endpoint not found" }));
        }
    } catch (e) {
        response.setStatus(500);
        response.setBody(JSON.stringify({ error: "Internal error", message: e.message }));
        gs.error("SMS API Error: " + e.message);
    }
    
    /**
     * POST /scan — Trigger a new scan.
     * Body: { scope: "global", table: "sys_script" }
     */
    function triggerScan(request, response) {
        var body = request.body ? request.body.data : {};
        var scanner = new x_snc_sms.SandboxScanner();
        var result = scanner.fullScan(body.scope, body.table);
        
        response.setStatus(200);
        response.setBody(JSON.stringify({
            success: true,
            scan_run_id: result.scan_run_id,
            summary: {
                total_scanned: result.total_scanned,
                blocking: result.blocking_count,
                warning: result.warning_count,
                compatible: result.compatible_count
            }
        }));
    }
    
    /**
     * GET /scan/{scanRunId} — Get results for a scan run.
     */
    function getScanResults(request, response, scanRunId) {
        var results = [];
        var gr = new GlideRecord("x_snc_sms_scan_result");
        gr.addQuery("scan_run", scanRunId);
        gr.orderBy("severity");
        gr.query();
        
        while (gr.next()) {
            results.push({
                id: gr.getUniqueValue(),
                table: gr.getValue("script_table"),
                name: gr.getValue("script_name"),
                field: gr.getValue("script_field"),
                severity: gr.getValue("severity"),
                issue_code: gr.getValue("issue_code"),
                status: gr.getValue("status"),
                detected_at: gr.getValue("detected_at")
            });
        }
        
        response.setStatus(200);
        response.setBody(JSON.stringify({ results: results, count: results.length }));
    }
    
    /**
     * POST /migrate — Execute migration for a scan result.
     * Body: { scan_result_id: "..." }
     */
    function executeMigration(request, response) {
        var body = request.body ? request.body.data : {};
        var engine = new x_snc_sms.MigrationEngine();
        var result = engine.execute(body.scan_result_id);
        
        if (result.error) {
            response.setStatus(400);
            response.setBody(JSON.stringify(result));
            return;
        }
        
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    }
    
    /**
     * POST /preview-migration — Preview without executing.
     */
    function previewMigration(request, response) {
        var body = request.body ? request.body.data : {};
        var engine = new x_snc_sms.MigrationEngine();
        var result = engine.preview(body.scan_result_id);
        
        response.setStatus(200);
        response.setBody(JSON.stringify(result));
    }
    
    /**
     * POST /exemption — Create exemption request.
     */
    function createExemption(request, response) {
        var body = request.body ? request.body.data : {};
        var mgr = new x_snc_sms.ExemptionManager();
        var result = mgr.createExemption(
            body.scan_result_id,
            body.justification,
            body.approver_id,
            body.expiry_date
        );
        
        response.setStatus(result.error ? 400 : 200);
        response.setBody(JSON.stringify(result));
    }
    
    /**
     * GET /dashboard — Dashboard aggregate data.
     */
    function getDashboard(request, response) {
        var ga = new GlideAggregate("x_snc_sms_scan_result");
        ga.addAggregate("COUNT");
        ga.groupBy("severity");
        ga.query();
        
        var data = { BLOCKING: 0, WARNING: 0, COMPATIBLE: 0 };
        while (ga.next()) {
            data[ga.getValue("severity")] = parseInt(ga.getAggregate("COUNT"));
        }
        
        var total = data.BLOCKING + data.WARNING + data.COMPATIBLE;
        var mgr = new x_snc_sms.ExemptionManager();
        data.readiness_score = mgr.calculateReadinessScore();
        data.total_scripts = total;
        data.migrated = mgr._countByStatus("MIGRATED");
        data.exempt = mgr._countByStatus("EXEMPT");
        
        var lastRun = new GlideRecord("x_snc_sms_scan_run");
        lastRun.addQuery("status", "COMPLETED");
        lastRun.orderByDesc("completed_at");
        lastRun.setLimit(1);
        lastRun.query();
        if (lastRun.next()) {
            data.last_scan = lastRun.getValue("completed_at");
            data.last_scan_id = lastRun.getUniqueValue();
        }
        
        response.setStatus(200);
        response.setBody(JSON.stringify(data));
    }
    
})(request, response);
