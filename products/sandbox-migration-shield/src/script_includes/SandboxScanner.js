/**
 * SandboxScanner — Core scanning engine for KB2944435 migration.
 * 
 * Scans all script-containing tables for incompatible JavaScript patterns
 * that will be blocked by Phase 3 of ServiceNow KB2944435 sandbox replacement.
 * 
 * @class SandboxScanner
 * @namespace x_snc_sms
 * @author VladArchitect ServiceNow OSS
 * @version 1.0.0
 */
var SandboxScanner = Class.create();
SandboxScanner.prototype = {
    
    /**
     * Pattern registry: KB2944435 incompatibility detection rules.
     * Each rule has a regex, severity, issue code, and message.
     */
    PATTERNS: [
        {
            code: "KB2944435-001",
            regex: /\bPackages\.(java|javax)\b/,
            severity: "BLOCKING",
            message: "Java package access blocked in new sandbox (Phase 3)"
        },
        {
            code: "KB2944435-002",
            regex: /\beval\s*\(/,
            severity: "BLOCKING",
            message: "eval() calls blocked in new sandbox (Phase 3)"
        },
        {
            code: "KB2944435-003",
            regex: /\bgs\.(sleep|print|log)\s*\(/,
            severity: "WARNING",
            message: "Deprecated gs methods — use GlideSystem equivalents"
        },
        {
            code: "KB2944435-004",
            regex: /\bnew\s+Packages\b/,
            severity: "BLOCKING",
            message: "Package instantiation blocked in new sandbox"
        },
        {
            code: "KB2944435-005",
            regex: /\bGlideStringUtil\b/,
            severity: "WARNING",
            message: "GlideStringUtil — verify compatibility; some methods deprecated"
        },
        {
            code: "KB2944435-006",
            regex: /\bgs\.(setUser|setPassword)\s*\(/,
            severity: "BLOCKING",
            message: "Credential-setting methods blocked — use credential resolver"
        },
        {
            code: "KB2944435-007",
            regex: /\bClass\.(forName|getClass|getProtectionDomain)\b/,
            severity: "BLOCKING",
            message: "Java reflection APIs blocked in new sandbox"
        }
    ],
    
    /**
     * Tables to scan for script content.
     */
    SCRIPT_TABLES: [
        { table: "sys_script", fields: ["script", "condition"], nameField: "name" },
        { table: "sys_script_include", fields: ["script"], nameField: "name" },
        { table: "sys_script_client", fields: ["script"], nameField: "name" },
        { table: "sys_ui_policy", fields: ["script_true", "script_false", "condition"], nameField: "short_description" },
        { table: "sys_ui_action", fields: ["script", "condition"], nameField: "name" },
        { table: "sys_dictionary", fields: ["default_value", "calculation"], nameField: "element" }
    ],
    
    /**
     * Initialize the scanner.
     * @param {string} diagRunId - Optional: existing diagnostic run sys_id for incremental scans.
     */
    initialize: function(diagRunId) {
        this.diagRunId = diagRunId;
        this.scanRunId = null;
        this.totalScanned = 0;
        this.blockingCount = 0;
        this.warningCount = 0;
        this.compatibleCount = 0;
    },
    
    /**
     * Execute a full scan of all script tables.
     * 
     * @param {string} scope - Optional application scope filter.
     * @param {string} targetTable - Optional specific table to scan.
     * @returns {Object} Scan summary with counts and scan_run sys_id.
     */
    fullScan: function(scope, targetTable) {
        this._createScanRun("FULL", scope);
        
        var tablesToProcess = this.SCRIPT_TABLES;
        if (targetTable) {
            tablesToProcess = this.SCRIPT_TABLES.filter(function(t) {
                return t.table === targetTable;
            });
        }
        
        for (var i = 0; i < tablesToProcess.length; i++) {
            var tableDef = tablesToProcess[i];
            gs.info("SandboxScanner: Scanning table " + tableDef.table);
            this._scanTable(tableDef, scope);
        }
        
        this._finalizeScanRun();
        
        return {
            scan_run_id: this.scanRunId,
            total_scanned: this.totalScanned,
            blocking_count: this.blockingCount,
            warning_count: this.warningCount,
            compatible_count: this.compatibleCount
        };
    },
    
    /**
     * Create the scan_run master record.
     * @private
     */
    _createScanRun: function(scanType, scope) {
        var gr = new GlideRecord("x_snc_sms_scan_run");
        gr.initialize();
        gr.scan_type = scanType;
        gr.scope = scope || "";
        gr.started_at = new GlideDateTime();
        gr.status = "RUNNING";
        this.scanRunId = gr.insert();
    },
    
    /**
     * Scan a single table for script content.
     * @private
     */
    _scanTable: function(tableDef, scope) {
        var gr = new GlideRecord(tableDef.table);
        gr.addActiveQuery();
        if (scope) {
            gr.addQuery("sys_scope", scope);
        }
        gr.setLimit(500);
        gr.query();
        
        while (gr.next()) {
            for (var f = 0; f < tableDef.fields.length; f++) {
                var fieldName = tableDef.fields[f];
                var scriptContent = gr.getValue(fieldName);
                
                if (!scriptContent || scriptContent.length < 3) continue;
                
                this._analyzeScript(
                    tableDef.table,
                    gr.getUniqueValue(),
                    gr.getValue(tableDef.nameField) || gr.getUniqueValue(),
                    fieldName,
                    scriptContent
                );
            }
        }
    },
    
    /**
     * Analyze a single script field against the pattern registry.
     * @private
     */
    _analyzeScript: function(table, sysId, name, field, content) {
        var severity = "COMPATIBLE";
        var matchedPatterns = [];
        
        for (var p = 0; p < this.PATTERNS.length; p++) {
            var pattern = this.PATTERNS[p];
            if (pattern.regex.test(content)) {
                if (pattern.severity === "BLOCKING") {
                    severity = "BLOCKING";
                } else if (pattern.severity === "WARNING" && severity !== "BLOCKING") {
                    severity = "WARNING";
                }
                matchedPatterns.push({
                    code: pattern.code,
                    severity: pattern.severity,
                    message: pattern.message
                });
            }
        }
        
        this._saveResult(table, sysId, name, field, severity, matchedPatterns, content);
        
        this.totalScanned++;
        if (severity === "BLOCKING") this.blockingCount++;
        else if (severity === "WARNING") this.warningCount++;
        else this.compatibleCount++;
    },
    
    /**
     * Save a scan result record.
     * @private
     */
    _saveResult: function(table, sysId, name, field, severity, patterns, content) {
        // Avoid duplicate: check if already exists from a previous scan
        var existingGr = new GlideRecord("x_snc_sms_scan_result");
        existingGr.addQuery("script_table", table);
        existingGr.addQuery("script_sys_id", sysId);
        existingGr.addQuery("script_field", field);
        existingGr.addQuery("status", "NEW");
        existingGr.query();
        
        if (existingGr.next()) {
            existingGr.severity = severity;
            existingGr.issue_description = JSON.stringify(patterns);
            existingGr.scan_run = this.scanRunId;
            existingGr.detected_at = new GlideDateTime();
            existingGr.update();
            return;
        }
        
        var gr = new GlideRecord("x_snc_sms_scan_result");
        gr.initialize();
        gr.script_table = table;
        gr.script_sys_id = sysId;
        gr.script_name = name;
        gr.script_field = field;
        gr.severity = severity;
        gr.issue_code = patterns.length > 0 ? patterns[0].code : "";
        gr.issue_description = JSON.stringify(patterns);
        gr.source_code_snippet = content.length > 3900 
            ? content.substring(0, 3900) + "..." 
            : content;
        gr.status = "NEW";
        gr.scan_run = this.scanRunId;
        gr.detected_at = new GlideDateTime();
        gr.insert();
    },
    
    /**
     * Finalize the scan_run record with aggregate counts.
     * @private
     */
    _finalizeScanRun: function() {
        var gr = new GlideRecord("x_snc_sms_scan_run");
        if (!gr.get(this.scanRunId)) return;
        
        gr.completed_at = new GlideDateTime();
        gr.total_scripts = this.totalScanned;
        gr.blocking_count = this.blockingCount;
        gr.warning_count = this.warningCount;
        gr.compatible_count = this.compatibleCount;
        gr.status = "COMPLETED";
        gr.update();
        
        gs.info("SandboxScanner: Scan complete. " +
            "Total: " + this.totalScanned + ", " +
            "Blocking: " + this.blockingCount + ", " +
            "Warning: " + this.warningCount + ", " +
            "Compatible: " + this.compatibleCount);
        
        this._auditLog("SCAN", "x_snc_sms_scan_run", this.scanRunId, {
            total: this.totalScanned,
            blocking: this.blockingCount,
            warning: this.warningCount,
            compatible: this.compatibleCount
        });
    },
    
    /**
     * Write an audit log entry.
     * @private
     */
    _auditLog: function(action, targetTable, targetSysId, details) {
        var gr = new GlideRecord("x_snc_sms_audit_log");
        gr.initialize();
        gr.action = action;
        gr.target_table = targetTable;
        gr.target_sys_id = targetSysId;
        gr.details = JSON.stringify(details);
        gr.user = gs.getUserID();
        gr.timestamp = new GlideDateTime();
        gr.insert();
    },
    
    type: "SandboxScanner"
};
