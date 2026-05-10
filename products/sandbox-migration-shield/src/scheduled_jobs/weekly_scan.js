/**
 * Weekly Auto-Scan — Scheduled Job
 * 
 * Runs every Sunday at 02:00. Triggers a full scan of all script tables
 * and logs the results. Sends summary notification.
 * 
 * Table: sys_trigger
 * Name: SMS Weekly Auto Scan
 * Schedule: 0 2 * * 0
 */

(function() {
    
    gs.info("SMS Weekly Auto Scan: Starting scheduled full scan");
    
    var scanner = new x_snc_sms.SandboxScanner();
    var result = scanner.fullScan(null, null);
    
    gs.info("SMS Weekly Auto Scan: Complete — " +
        "Total: " + result.total_scanned + ", " +
        "Blocking: " + result.blocking_count + ", " +
        "Warning: " + result.warning_count);
    
    // Send summary email to admins
    var recipient = gs.getProperty("x_snc_sms.report_recipient", "");
    if (recipient) {
        var subject = "[Sandbox Migration Shield] Weekly Scan Report";
        var body = "Weekly automated scan completed.\n\n" +
            "Date: " + new GlideDateTime().getDisplayValue() + "\n" +
            "Total scripts scanned: " + result.total_scanned + "\n" +
            "BLOCKING: " + result.blocking_count + "\n" +
            "WARNING: " + result.warning_count + "\n" +
            "COMPATIBLE: " + result.compatible_count + "\n\n" +
            "View full results: " + gs.getProperty("glide.servlet.uri") + 
            "/nav_to.do?uri=x_snc_sms_scan_result_list.do";
        
        gs.eventQueue("x_snc_sms.weekly.report", 
            new GlideRecord("x_snc_sms_scan_run"), result.scan_run_id, recipient);
    }
    
})();
