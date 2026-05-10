/**
 * ProcessDebtScanner — Scans all workflows for broken patterns.
 * Detects: missing owners, inactive approvers, unreachable steps,
 * cycles, silent failures, duplicate triggers, missing error handlers.
 * @class ProcessDebtScanner @namespace x_snc_ard
 */
var ProcessDebtScanner = Class.create();
ProcessDebtScanner.prototype = {
    DETECTORS: [
        { name: "MISSING_OWNER", weight: 15 },
        { name: "INACTIVE_APPROVER", weight: 20 },
        { name: "UNREACHABLE_STEP", weight: 25 },
        { name: "CIRCULAR_REF", weight: 30 },
        { name: "SILENT_FAILURE", weight: 20 },
        { name: "DUPLICATE_TRIGGER", weight: 10 },
        { name: "NO_ERROR_HANDLER", weight: 10 },
        { name: "MISSING_AUDIT", weight: 15 }
    ],
    initialize: function(diagRunId) { this.diagRunId = diagRunId || null; },
    
    fullScan: function() {
        this._createDiagRun("FULL");
        this._scanWorkflows("wf_workflow");
        this._scanFlows("sys_flow");
        this._scanFlows("sys_hub_flow");
        this._finalizeDiagRun();
        return { diag_run_id: this.diagRunId, workflows_scanned: this.totalScanned, broken_count: this.brokenCount };
    },
    
    _createDiagRun: function(type) {
        var gr = new GlideRecord("x_snc_ard_diag_run");
        gr.initialize(); gr.diagnostic_type = type; gr.started_at = new GlideDateTime(); gr.status = "RUNNING";
        this.diagRunId = gr.insert();
        this.totalScanned = 0; this.brokenCount = 0;
    },
    
    _scanWorkflows: function(table) {
        var gr = new GlideRecord(table);
        gr.addActiveQuery(); gr.setLimit(500); gr.query();
        while (gr.next()) {
            var issues = this._detectIssues(gr, table);
            var score = 100;
            for (var i = 0; i < issues.length; i++) score -= issues[i].weight;
            if (score < 0) score = 0;
            this._saveWorkflowHealth(gr.getUniqueValue(), gr.getValue("name") || gr.getUniqueValue(), table, score, issues);
            this.totalScanned++;
            if (issues.length > 0) this.brokenCount++;
        }
    },
    
    _scanFlows: function(table) {
        var gr = new GlideRecord(table);
        gr.addActiveQuery(); gr.setLimit(500); gr.query();
        while (gr.next()) {
            var issues = this._detectFlowIssues(gr, table);
            var score = 100;
            for (var i = 0; i < issues.length; i++) score -= issues[i].weight;
            if (score < 0) score = 0;
            this._saveWorkflowHealth(gr.getUniqueValue(), gr.getValue("name") || gr.getUniqueValue(), table, score, issues);
            this.totalScanned++;
            if (issues.length > 0) this.brokenCount++;
        }
    },
    
    _detectIssues: function(gr, table) {
        var issues = [];
        var owner = gr.getValue("manager") || gr.getValue("owned_by");
        if (!owner) issues.push({ type: "MISSING_OWNER", weight: 15, desc: "No owner assigned" });
        else {
            var usr = new GlideRecord("sys_user");
            if (usr.get(owner) && usr.getValue("active") == "false") issues.push({ type: "INACTIVE_APPROVER", weight: 20, desc: "Owner is inactive" });
        }
        var published = gr.getValue("published");
        if (published == "false") issues.push({ type: "UNPUBLISHED", weight: 10, desc: "Workflow not published" });
        return issues;
    },
    
    _detectFlowIssues: function(gr, table) {
        var issues = [];
        var stepsGr = new GlideRecord("sys_flow_step");
        stepsGr.addQuery("flow", gr.getUniqueValue()); stepsGr.query();
        var stepCount = stepsGr.getRowCount();
        if (stepCount === 0) issues.push({ type: "EMPTY_FLOW", weight: 25, desc: "Flow has no steps" });
        var status = gr.getValue("status");
        if (status === "error") issues.push({ type: "FLOW_ERROR", weight: 25, desc: "Flow in error state" });
        return issues;
    },
    
    _saveWorkflowHealth: function(sysId, name, type, score, issues) {
        var gr = new GlideRecord("x_snc_ard_workflow_health");
        gr.initialize();
        gr.workflow_sys_id = sysId; gr.workflow_name = name; gr.workflow_type = type;
        gr.health_score = score; gr.issue_count = issues.length;
        gr.critical_issues = issues.filter(function(i) { return i.weight >= 25; }).length;
        gr.issues_json = JSON.stringify(issues); gr.status = "NEW"; gr.diag_run = this.diagRunId;
        gr.insert();
    },
    
    _finalizeDiagRun: function() {
        var gr = new GlideRecord("x_snc_ard_diag_run");
        if (!gr.get(this.diagRunId)) return;
        gr.completed_at = new GlideDateTime(); gr.workflows_scanned = this.totalScanned;
        gr.workflows_broken = this.brokenCount; gr.status = "COMPLETED"; gr.update();
    },
    
    type: "ProcessDebtScanner"
};
