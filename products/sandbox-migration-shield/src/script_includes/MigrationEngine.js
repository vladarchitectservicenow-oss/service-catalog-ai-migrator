/**
 * MigrationEngine — One-click script migration for KB2944435.
 * 
 * Extracts inline JavaScript logic from script records and creates
 * secure Script Includes. Supports preview mode and rollback.
 * 
 * @class MigrationEngine
 * @namespace x_snc_sms
 */
var MigrationEngine = Class.create();
MigrationEngine.prototype = {
    
    initialize: function() {
        this.auditor = new x_snc_sms.SandboxScanner(); // reuse audit method
    },
    
    /**
     * Preview migration without executing.
     * Returns the generated Script Include code and replacement call.
     */
    preview: function(scanResultId) {
        var scanResult = this._getScanResult(scanResultId);
        if (!scanResult) return { error: "Scan result not found" };
        
        var sourceScript = this._getSourceScript(scanResult.script_table, scanResult.script_sys_id);
        if (!sourceScript) return { error: "Source script not found or already migrated" };
        
        var extracted = this._extractLogic(sourceScript.content, scanResult);
        var siName = this._generateName(scanResult.script_name, scanResult.script_field);
        
        return {
            script_include_name: siName,
            api_name: "x_snc_sms." + this._toCamelCase(siName),
            generated_script: this._buildScriptInclude(siName, extracted),
            replacement_call: this._buildReplacementCall(siName, scanResult),
            original_code: sourceScript.content.substring(0, 500)
        };
    },
    
    /**
     * Execute migration: create Script Include + update source.
     */
    execute: function(scanResultId) {
        var preview = this.preview(scanResultId);
        if (preview.error) return preview;
        
        // Store pre-migration state for rollback
        var scanResult = this._getScanResult(scanResultId);
        var sourceScript = this._getSourceScript(scanResult.script_table, scanResult.script_sys_id);
        var preState = {
            table: scanResult.script_table,
            sys_id: scanResult.script_sys_id,
            field: scanResult.script_field,
            original_content: sourceScript.content
        };
        
        // Create Script Include
        var siGr = new GlideRecord("sys_script_include");
        siGr.initialize();
        siGr.name = preview.script_include_name;
        siGr.api_name = preview.api_name;
        siGr.script = preview.generated_script;
        siGr.access = "public";
        siGr.description = "Auto-migrated from " + scanResult.script_table + "." + scanResult.script_name + 
                           " — KB2944435 compliance migration";
        var siId = siGr.insert();
        
        if (!siId) {
            this._logError("MigrationEngine: Failed to create Script Include for " + scanResult.script_name);
            return { error: "Failed to create Script Include" };
        }
        
        // Update source script with replacement call
        var srcGr = new GlideRecord(scanResult.script_table);
        if (srcGr.get(scanResult.script_sys_id)) {
            srcGr.setValue(scanResult.script_field, preview.replacement_call);
            srcGr.update();
        }
        
        // Update scan result
        var srGr = new GlideRecord("x_snc_sms_scan_result");
        if (srGr.get(scanResultId)) {
            srGr.status = "MIGRATED";
            srGr.setValue("migration_pre_state", JSON.stringify(preState));
            srGr.setValue("migrated_to_si", siId);
            srGr.update();
        }
        
        this._auditLog("MIGRATE", scanResult.script_table, scanResult.script_sys_id, {
            script_include_id: siId,
            script_include_name: preview.script_include_name,
            api_name: preview.api_name,
            original_field: scanResult.script_field
        });
        
        gs.info("MigrationEngine: Migrated " + scanResult.script_name + 
                " → " + preview.script_include_name + " (" + siId + ")");
        
        return {
            success: true,
            script_include_id: siId,
            script_include_name: preview.script_include_name,
            rollback_available: true
        };
    },
    
    /**
     * Rollback a migration: restore original script, delete Script Include.
     */
    rollback: function(scanResultId) {
        var srGr = new GlideRecord("x_snc_sms_scan_result");
        if (!srGr.get(scanResultId)) return { error: "Scan result not found" };
        if (srGr.status != "MIGRATED") return { error: "Script not in MIGRATED state" };
        
        var preState = JSON.parse(srGr.getValue("migration_pre_state") || "{}");
        var siId = srGr.getValue("migrated_to_si");
        
        // Restore original script
        var srcGr = new GlideRecord(preState.table);
        if (srcGr.get(preState.sys_id)) {
            srcGr.setValue(preState.field, preState.original_content);
            srcGr.update();
        }
        
        // Delete Script Include
        if (siId) {
            var siGr = new GlideRecord("sys_script_include");
            if (siGr.get(siId)) {
                siGr.deleteRecord();
            }
        }
        
        // Reset scan result
        srGr.status = "NEW";
        srGr.setValue("migration_pre_state", "");
        srGr.setValue("migrated_to_si", "");
        srGr.update();
        
        this._auditLog("ROLLBACK", preState.table, preState.sys_id, {
            script_include_id: siId,
            field: preState.field
        });
        
        return { success: true, message: "Rollback complete — original script restored" };
    },
    
    /** @private */
    _getScanResult: function(id) {
        var gr = new GlideRecord("x_snc_sms_scan_result");
        return gr.get(id) ? {
            script_table: gr.getValue("script_table"),
            script_sys_id: gr.getValue("script_sys_id"),
            script_name: gr.getValue("script_name"),
            script_field: gr.getValue("script_field"),
            severity: gr.getValue("severity"),
            status: gr.getValue("status")
        } : null;
    },
    
    /** @private */
    _getSourceScript: function(table, sysId) {
        var def = { table: table, fields: ["script", "condition", "script_true", "script_false", 
                   "default_value", "calculation", "execute_function"] };
        var gr = new GlideRecord(table);
        if (!gr.get(sysId)) return null;
        
        for (var f = 0; f < def.fields.length; f++) {
            var val = gr.getValue(def.fields[f]);
            if (val && val.length > 5) return { content: val, field: def.fields[f] };
        }
        return null;
    },
    
    /** @private Extract reusable logic from inline script. */
    _extractLogic: function(content, scanResult) {
        // Wrap inline logic as a function
        var functionBody = content;
        
        // If it's a simple expression (no semicolons), wrap as return
        if (functionBody.indexOf(";") < 0 && functionBody.length < 200) {
            return "return (" + functionBody + ");";
        }
        
        // For multi-line scripts, preserve as-is inside function body
        return functionBody;
    },
    
    /** @private */
    _generateName: function(scriptName, fieldName) {
        var base = scriptName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/__+/g, "_");
        if (!base || base.length < 3) base = "MigratedScript";
        return base + "_" + fieldName.replace(/[^a-zA-Z0-9_]/g, "_");
    },
    
    /** @private */
    _toCamelCase: function(str) {
        return str.replace(/[^a-zA-Z0-9]+(.)/g, function(m, chr) { return chr.toUpperCase(); });
    },
    
    /** @private */
    _buildScriptInclude: function(name, extractedLogic) {
        return "/**\n" +
               " * Auto-migrated Script Include — KB2944435 compliance.\n" +
               " * Generated by Sandbox Migration Shield.\n" +
               " * @class " + name + "\n" +
               " */\n" +
               "var " + name + " = Class.create();\n" +
               name + ".prototype = Object.extendsObject(AbstractAjaxProcessor, {\n" +
               "    \n" +
               "    execute: function(current, previous, g_scratchpad) {\n" +
               "        " + extractedLogic.replace(/\n/g, "\n        ") + "\n" +
               "    },\n" +
               "    \n" +
               "    type: \"" + name + "\"\n" +
               "});";
    },
    
    /** @private */
    _buildReplacementCall: function(name, scanResult) {
        var apiFunc = this._toCamelCase(name);
        return "new x_snc_sms." + apiFunc + "().execute(current, previous, g_scratchpad);";
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
    
    /** @private */
    _logError: function(msg) {
        gs.error(msg);
    },
    
    type: "MigrationEngine"
};
