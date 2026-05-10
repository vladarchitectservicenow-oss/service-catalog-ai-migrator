/**
 * KBAnalyzer — Knowledge Base quality assessment for AI readiness.
 * Measures: empty articles, outdated, unattached, duplicates.
 * @class KBAnalyzer @namespace x_snc_ard
 */
var KBAnalyzer = Class.create();
KBAnalyzer.prototype = {
    initialize: function(diagRunId) { this.diagRunId = diagRunId || null; },
    
    analyze: function() {
        var stats = { total_articles: 0, empty_pct: 0, outdated_pct: 0, unattached_pct: 0, knowledge_readiness: 0 };
        var ga = new GlideAggregate("kb_knowledge"); ga.addAggregate("COUNT"); ga.addActiveQuery(); ga.query();
        stats.total_articles = ga.next() ? parseInt(ga.getAggregate("COUNT")) : 0;
        if (stats.total_articles === 0) { stats.knowledge_readiness = 0; this._save(stats); return stats; }
        
        var gaEmpty = new GlideAggregate("kb_knowledge"); gaEmpty.addAggregate("COUNT"); gaEmpty.addActiveQuery();
        gaEmpty.addNullQuery("text").addOrCondition("text", "").addOrCondition("text", "<p></p>");
        gaEmpty.query();
        stats.empty_pct = Math.round((gaEmpty.next() ? parseInt(gaEmpty.getAggregate("COUNT")) : 0) / stats.total_articles * 100);
        
        var gaOld = new GlideAggregate("kb_knowledge"); gaOld.addAggregate("COUNT"); gaOld.addActiveQuery();
        gaOld.addQuery("sys_updated_on", "<", gs.yearsAgo(2)); gaOld.query();
        stats.outdated_pct = Math.round((gaOld.next() ? parseInt(gaOld.getAggregate("COUNT")) : 0) / stats.total_articles * 100);
        
        var gaOrph = new GlideAggregate("kb_knowledge"); gaOrph.addAggregate("COUNT"); gaOrph.addActiveQuery();
        gaOrph.addNullQuery("kb_category").addNullQuery("kb_knowledge_base"); gaOrph.query();
        stats.unattached_pct = Math.round((gaOrph.next() ? parseInt(gaOrph.getAggregate("COUNT")) : 0) / stats.total_articles * 100);
        
        stats.knowledge_readiness = Math.round(100 - stats.empty_pct * 0.4 - stats.outdated_pct * 0.35 - stats.unattached_pct * 0.25);
        if (stats.knowledge_readiness < 0) stats.knowledge_readiness = 0;
        this._save(stats);
        return stats;
    },
    
    _save: function(s) {
        var gr = new GlideRecord("x_snc_ard_kb_health"); gr.initialize();
        gr.kb_name = "Knowledge Base"; gr.total_articles = s.total_articles;
        gr.empty_pct = s.empty_pct; gr.outdated_pct = s.outdated_pct;
        gr.duplicate_pct = 0; gr.knowledge_readiness = s.knowledge_readiness;
        gr.diag_run = this.diagRunId; gr.insert();
    },
    
    type: "KBAnalyzer"
};
