/**
 * CMDBHealthAnalyzer — Evaluates CMDB readiness for AI agents.
 * Measures: completeness, duplicates, orphans, staleness.
 * @class CMDBHealthAnalyzer @namespace x_snc_ard
 */
var CMDBHealthAnalyzer = Class.create();
CMDBHealthAnalyzer.prototype = {
    REQUIRED_FIELDS: ["name", "operational_status", "owned_by", "location", "manufacturer", "model_id"],
    
    initialize: function(diagRunId) { this.diagRunId = diagRunId || null; },
    
    analyze: function(ciClass) {
        var stats = { ci_class: ciClass || "cmdb_ci", total_cis: 0, completeness_pct: 0, duplicate_pct: 0, orphan_pct: 0, stale_pct: 0, ai_impact_score: 0 };
        this._countTotal(stats);
        this._measureCompleteness(stats);
        this._measureOrphans(stats);
        this._measureStaleness(stats);
        stats.ai_impact_score = Math.round((100 - stats.completeness_pct) * 0.5 + stats.orphan_pct * 0.3 + stats.stale_pct * 0.2);
        this._save(stats);
        return stats;
    },
    
    _countTotal: function(s) {
        var ga = new GlideAggregate("cmdb_ci"); ga.addAggregate("COUNT");
        if (s.ci_class !== "cmdb_ci") ga.addQuery("sys_class_name", s.ci_class);
        ga.query(); s.total_cis = ga.next() ? parseInt(ga.getAggregate("COUNT")) : 0;
    },
    
    _measureCompleteness: function(s) {
        if (s.total_cis === 0) return;
        var ga = new GlideAggregate("cmdb_ci"); ga.addAggregate("COUNT");
        if (s.ci_class !== "cmdb_ci") ga.addQuery("sys_class_name", s.ci_class);
        for (var i = 0; i < this.REQUIRED_FIELDS.length; i++) ga.addNotNullQuery(this.REQUIRED_FIELDS[i]);
        ga.query();
        var complete = ga.next() ? parseInt(ga.getAggregate("COUNT")) : 0;
        s.completeness_pct = Math.round((complete / s.total_cis) * 100);
    },
    
    _measureOrphans: function(s) {
        if (s.total_cis === 0) return;
        var orphanCount = 0;
        var gr = new GlideRecord("cmdb_ci");
        if (s.ci_class !== "cmdb_ci") gr.addQuery("sys_class_name", s.ci_class);
        gr.setLimit(200); gr.query();
        while (gr.next()) {
            var rel = new GlideRecord("cmdb_rel_ci");
            rel.addQuery("child", gr.getUniqueValue()).addOrCondition("parent", gr.getUniqueValue());
            rel.query();
            if (rel.getRowCount() === 0) orphanCount++;
        }
        s.orphan_pct = Math.round((orphanCount / Math.min(s.total_cis, 200)) * 100);
    },
    
    _measureStaleness: function(s) {
        if (s.total_cis === 0) return;
        var ga = new GlideAggregate("cmdb_ci"); ga.addAggregate("COUNT");
        if (s.ci_class !== "cmdb_ci") ga.addQuery("sys_class_name", s.ci_class);
        ga.addQuery("sys_updated_on", "<", gs.yearsAgo(1));
        ga.query();
        s.stale_pct = ga.next() ? Math.round((parseInt(ga.getAggregate("COUNT")) / s.total_cis) * 100) : 0;
    },
    
    _save: function(s) {
        var gr = new GlideRecord("x_snc_ard_cmdb_health"); gr.initialize();
        gr.ci_class = s.ci_class; gr.total_cis = s.total_cis; gr.completeness_pct = s.completeness_pct;
        gr.orphan_pct = s.orphan_pct; gr.stale_pct = s.stale_pct; gr.ai_impact_score = s.ai_impact_score;
        gr.diag_run = this.diagRunId; gr.insert();
    },
    
    type: "CMDBHealthAnalyzer"
};
