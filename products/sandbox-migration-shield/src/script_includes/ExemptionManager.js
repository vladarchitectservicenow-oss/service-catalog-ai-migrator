/**
 * ExemptionManager — Manages the KB2944435 exemption lifecycle.
 * 
 * Handles creation, approval, and expiry tracking of script exemptions
 * for compliance audit purposes.
 * 
 * @class ExemptionManager
 * @namespace x_snc_sms
 */
var ExemptionManager = Class.create();
ExemptionManager.prototype = {
    
    /**
     * Create a new exemption request.
     * @returns {Object} { success, exemption_id }
     */
    createExemption: function(scanResultId, justification, approverId, expiryDate) {
        if (!justification || justification.length < 50) 
            return { error: "Justification must be at least 50 characters" };
        if (!approverId) return { error: "Approver is required" };
        if (!expiryDate) return { error: "Expiration date is required" };
        
        var expiryDT = new GlideDateTime(expiryDate);
        if (expiryDT.before(new GlideDateTime()))
            return { error: "Expiration date must be in the future" };
        
        var gr = new GlideRecord("x_snc_sms_exemption");
        gr.initialize();
        gr.scan_result = scanResultId;
        gr.business_justification = justification;
        gr.approver = approverId;
        gr.expires_at = expiryDate;
        gr.status = "PENDING";
        var exemptionId = gr.insert();
        
        if (!exemptionId) return { error: "Failed to create exemption" };
        
        var srGr = new GlideRecord("x_snc_sms_scan_result");
        if (srGr.get(scanResultId)) {
            srGr.status = "EXEMPT";
            srGr.update();
        }
        
        this._auditLog("EXEMPTION_CREATE", "x_snc_sms_exemption", exemptionId, {
            scan_result: scanResultId,
            justification_preview: justification.substring(0, 100),
            approver: approverId,
            expires: expiryDate
        });
        
        this._notifyApprover(approverId, exemptionId);
        
        return { success: true, exemption_id: exemptionId, status: "PENDING" };
    },
    
    /**
     * Approve an exemption.
     */
    approveExemption: function(exemptionId) {
        var gr = new GlideRecord("x_snc_sms_exemption");
        if (!gr.get(exemptionId)) return { error: "Exemption not found" };
        if (gr.status != "PENDING") return { error: "Exemption is not in PENDING state" };
        
        gr.status = "APPROVED";
        gr.approved_at = new GlideDateTime();
        gr.update();
        
        this._auditLog("EXEMPTION_APPROVE", "x_snc_sms_exemption", exemptionId, {});
        
        return { success: true, status: "APPROVED" };
    },
    
    /**
     * Revoke an exemption — script goes back to blocking.
     */
    revokeExemption: function(exemptionId) {
        var gr = new GlideRecord("x_snc_sms_exemption");
        if (!gr.get(exemptionId)) return { error: "Exemption not found" };
        
        gr.status = "REVOKED";
        gr.update();
        
        var srGr = new GlideRecord("x_snc_sms_scan_result");
        if (srGr.get(gr.scan_result)) {
            srGr.status = "NEW";
            srGr.update();
        }
        
        this._auditLog("EXEMPTION_REVOKE", "x_snc_sms_exemption", exemptionId, {});
        
        return { success: true, status: "REVOKED" };
    },
    
    /**
     * Get exemptions expiring within N days.
     * Used by scheduled job for renewal reminders.
     */
    getExpiringExemptions: function(daysThreshold) {
        var threshold = daysThreshold || 30;
        var cutoff = new GlideDateTime();
        cutoff.addDaysUTC(threshold);
        
        var gr = new GlideRecord("x_snc_sms_exemption");
        gr.addQuery("status", "APPROVED");
        gr.addQuery("expires_at", "<=", cutoff);
        gr.addQuery("expires_at", ">=", new GlideDateTime());
        gr.query();
        
        var expiring = [];
        while (gr.next()) {
            expiring.push({
                exemption_id: gr.getUniqueValue(),
                scan_result: gr.scan_result.getDisplayValue(),
                approver: gr.approver.getDisplayValue(),
                expires_at: gr.getValue("expires_at"),
                justification: gr.getValue("business_justification").substring(0, 100)
            });
        }
        return expiring;
    },
    
    /**
     * Calculate readiness score excluding exempted scripts.
     */
    calculateReadinessScore: function() {
        var ga = new GlideAggregate("x_snc_sms_scan_result");
        ga.addAggregate("COUNT");
        ga.groupBy("severity");
        ga.addQuery("status", "!=", "EXEMPT");
        ga.query();
        
        var blocking = 0, warning = 0, compatible = 0;
        while (ga.next()) {
            var sev = ga.getValue("severity");
            var cnt = parseInt(ga.getAggregate("COUNT"));
            if (sev === "BLOCKING") blocking = cnt;
            else if (sev === "WARNING") warning = cnt;
            else compatible = cnt;
        }
        
        var total = blocking + warning + compatible;
        if (total === 0) return 100;
        
        var migrated = this._countByStatus("MIGRATED");
        return Math.round(((compatible + migrated) / total) * 100);
    },
    
    /** @private */
    _countByStatus: function(status) {
        var ga = new GlideAggregate("x_snc_sms_scan_result");
        ga.addAggregate("COUNT");
        ga.addQuery("status", status);
        ga.query();
        return ga.next() ? parseInt(ga.getAggregate("COUNT")) : 0;
    },
    
    /** @private */
    _notifyApprover: function(approverId, exemptionId) {
        gs.eventQueue("x_snc_sms.exemption.pending", 
            new GlideRecord("x_snc_sms_exemption"), exemptionId, approverId);
    },
    
    /** @private */
    _auditLog: function(action, table, sysId, details) {
        var gr = new GlideRecord("x_snc_sms_audit_log");
        gr.initialize();
        gr.action = action;
        gr.target_table = table;
        gr.target_sys_id = sysId;
        gr.details = JSON.stringify(details);
        gr.user = gs.getUserID();
        gr.timestamp = new GlideDateTime();
        gr.insert();
    },
    
    type: "ExemptionManager"
};
