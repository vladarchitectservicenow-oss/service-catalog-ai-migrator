/**
 * WorkflowProfiler — Profiles catalog items and incident categories
 * by channel affinity, volume, complexity, data sensitivity.
 * @class WorkflowProfiler @namespace x_snc_wco
 */
var WorkflowProfiler = Class.create();
WorkflowProfiler.prototype = {
    initialize: function(runId) { this.runId = runId || null; },
    
    profileAll: function() {
        this._profileCatalogItems();
        this._profileIncidentCategories();
        return { profiled: this.count };
    },
    
    _profileCatalogItems: function() {
        var gr = new GlideRecord("sc_cat_item"); gr.addActiveQuery(); gr.setLimit(200); gr.query();
        while (gr.next()) this._classifyAndSave("sc_cat_item", gr);
    },
    
    _profileIncidentCategories: function() {
        var gr = new GlideRecord("sys_choice");
        gr.addQuery("element", "category"); gr.addQuery("name", "incident"); gr.addQuery("inactive", false); gr.query();
        while (gr.next()) {
            var label = gr.getValue("label"), value = gr.getValue("value");
            var incGr = new GlideRecord("incident");
            incGr.addQuery("category", value);
            incGr.addQuery("sys_created_on", ">=", gs.monthsAgo(6));
            incGr.query();
            var volume = Math.round(incGr.getRowCount() / 6);
            if (volume > 0) {
                var profileGr = new GlideRecord("x_snc_wco_profile"); profileGr.initialize();
                profileGr.source_table = "incident"; profileGr.source_sys_id = value;
                profileGr.name = "Incident — " + label; profileGr.monthly_volume = volume;
                profileGr.channel_affinity = this._inferChannel("incident", value);
                profileGr.complexity = "MEDIUM"; profileGr.avg_resolution_min = 30;
                profileGr.data_sensitivity = "MEDIUM"; profileGr.insert();
            }
        }
    },
    
    _classifyAndSave: function(table, gr) {
        var itemId = gr.getUniqueValue();
        var reqGr = new GlideRecord("sc_req_item");
        reqGr.addQuery("cat_item", itemId); 
        reqGr.addQuery("sys_created_on", ">=", gs.monthsAgo(6)); reqGr.query();
        var total = reqGr.getRowCount();
        if (total === 0) return;
        
        var volume = Math.round(total / 6);
        var profileGr = new GlideRecord("x_snc_wco_profile"); profileGr.initialize();
        profileGr.source_table = table; profileGr.source_sys_id = itemId;
        profileGr.name = gr.getValue("name") || gr.getUniqueValue();
        profileGr.monthly_volume = volume;
        profileGr.channel_affinity = this._inferChannel(table, itemId);
        profileGr.complexity = this._inferComplexity(gr);
        profileGr.avg_resolution_min = 15;
        profileGr.data_sensitivity = this._inferSensitivity(gr);
        profileGr.insert();
    },
    
    _inferChannel: function(table, id) {
        var viaGr = new GlideAggregate("sc_req_item"); viaGr.addAggregate("COUNT"); viaGr.groupBy("request_source");
        viaGr.addQuery("cat_item", id); viaGr.addQuery("sys_created_on", ">=", gs.monthsAgo(6)); viaGr.query();
        var sources = {}; while(viaGr.next()) sources[viaGr.getValue("request_source")||"unknown"] = parseInt(viaGr.getAggregate("COUNT"));
        var max = "", maxCnt = 0;
        for (var k in sources) { if (sources[k] > maxCnt) { max = k; maxCnt = sources[k]; } }
        if (max.indexOf("portal") >= 0) return "PORTAL";
        if (max.indexOf("slack") >= 0 || max.indexOf("virtual") >= 0) return "SLACK";
        if (max.indexOf("email") >= 0) return "EMAIL";
        return "MIXED";
    },
    
    _inferComplexity: function(gr) { return (gr.getValue("approval") || gr.getValue("workflow")) ? "MEDIUM" : "SIMPLE"; },
    _inferSensitivity: function(gr) { return (gr.getValue("name")||"").toLowerCase().indexOf("security") >= 0 ? "HIGH" : "LOW"; },
    
    type: "WorkflowProfiler"
};
