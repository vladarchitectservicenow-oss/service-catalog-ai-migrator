/**
 * Weekly Report — Scheduled Job
 * Runs Monday 07:00. Emails summary of latest scan to configured recipients.
 */
(function() {
    var lastRun = new GlideRecord("x_snc_sms_scan_run");
    lastRun.addQuery("status", "COMPLETED");
    lastRun.orderByDesc("completed_at");
    lastRun.setLimit(1);
    lastRun.query();
    if (!lastRun.next()) return;
    
    var mgr = new x_snc_sms.ExemptionManager();
    var score = mgr.calculateReadinessScore();
    
    var subject = "[SMS] Weekly Report — Readiness: " + score + "%";
    var body = "Sandbox Migration Shield — Weekly Report\n" +
        "Readiness Score: " + score + "%\n" +
        "Blocking: " + lastRun.getValue("blocking_count") + "\n" +
        "Warning: " + lastRun.getValue("warning_count") + "\n" +
        "Compatible: " + lastRun.getValue("compatible_count") + "\n" +
        "Last scan: " + lastRun.getValue("completed_at");
    
    gs.eventQueue("x_snc_sms.weekly.report", lastRun, lastRun.getUniqueValue(),
        gs.getProperty("x_snc_sms.report_recipient", gs.getUserID()));
})();
