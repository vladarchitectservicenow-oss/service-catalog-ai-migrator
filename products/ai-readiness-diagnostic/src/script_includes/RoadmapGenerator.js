/**
 * RoadmapGenerator — Generates prioritized remediation plan for AI readiness.
 * Scores: AI_impact * 0.4 + frequency * 0.3 + blocking_count * 0.2 + fix_ease * 0.1
 * @class RoadmapGenerator @namespace x_snc_ard
 */
var RoadmapGenerator = Class.create();
RoadmapGenerator.prototype = {
    initialize: function(diagRunId) { this.diagRunId = diagRunId || null; },
    
    generate: function() {
        var items = [];
        var whGr = new GlideRecord("x_snc_ard_workflow_health");
        whGr.addQuery("diag_run", this.diagRunId); whGr.addQuery("status", "NEW"); whGr.query();
        while (whGr.next()) {
            var issues = JSON.parse(whGr.getValue("issues_json") || "[]");
            var score = parseInt(whGr.getValue("health_score") || "100");
            var aiImpact = (100 - score) * 0.4;
            var blockingCount = parseInt(whGr.getValue("critical_issues") || "0");
            var fixEase = issues.length <= 2 ? 10 : issues.length <= 5 ? 5 : 2;
            var priority = Math.round(aiImpact + blockingCount * 3 + fixEase);
            items.push({
                workflow_id: whGr.getUniqueValue(), workflow_name: whGr.getValue("workflow_name"),
                health_score: score, issue_count: issues.length, critical_issues: blockingCount,
                priority: priority, fix_ease: fixEase,
                phase: priority >= 30 ? "phase_1_30d" : priority >= 15 ? "phase_2_90d" : "phase_3_180d",
                estimated_hours: issues.length * 2
            });
        }
        items.sort(function(a, b) { return b.priority - a.priority; });
        return {
            quick_wins: items.filter(function(i) { return i.fix_ease >= 10 && i.issue_count >= 3; }),
            phase_1_30d: items.filter(function(i) { return i.phase === "phase_1_30d"; }),
            phase_2_90d: items.filter(function(i) { return i.phase === "phase_2_90d"; }),
            phase_3_180d: items.filter(function(i) { return i.phase === "phase_3_180d"; }),
            total_items: items.length, total_estimated_hours: items.reduce(function(s, i) { return s + i.estimated_hours; }, 0)
        };
    },
    type: "RoadmapGenerator"
};
