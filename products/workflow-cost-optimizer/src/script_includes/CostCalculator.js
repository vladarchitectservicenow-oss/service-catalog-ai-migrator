/**
 * CostCalculator — Computes per-workflow cost across AI platforms.
 * Pricing models are configurable via x_snc_wco_pricing table.
 * @class CostCalculator @namespace x_snc_wco
 */
var CostCalculator = Class.create();
CostCalculator.prototype = {
    calculateForWorkflow: function(profileId) {
        var profile = this._getProfile(profileId);
        if (!profile) return { error: "Profile not found" };
        var platforms = this._getAllPlatforms();
        var results = [];
        for (var i = 0; i < platforms.length; i++) {
            var p = platforms[i];
            var transactionCost = profile.monthly_volume * p.cost_per_transaction;
            var fixedAllocation = p.fixed_monthly_cost * (profile.monthly_volume / Math.max(this._getTotalVolume(), 1));
            var monthly = transactionCost + fixedAllocation;
            results.push({
                platform: p.platform,
                monthly_cost: Math.round(monthly * 100) / 100,
                annual_cost: Math.round(monthly * 12 * 100) / 100,
                cost_per_ticket: Math.round((monthly / Math.max(profile.monthly_volume, 1)) * 100) / 100
            });
        }
        results.sort(function(a, b) { return a.monthly_cost - b.monthly_cost; });
        return { workflow_name: profile.name, volume: profile.monthly_volume, channel: profile.channel_affinity, platforms: results, recommended: results[0] };
    },
    
    _getProfile: function(id) {
        var gr = new GlideRecord("x_snc_wco_profile");
        if (!gr.get(id)) return null;
        return { name: gr.getValue("name"), monthly_volume: parseInt(gr.getValue("monthly_volume")), channel_affinity: gr.getValue("channel_affinity"), complexity: gr.getValue("complexity"), data_sensitivity: gr.getValue("data_sensitivity") };
    },
    
    _getAllPlatforms: function() {
        var gr = new GlideRecord("x_snc_wco_pricing"); gr.query();
        var platforms = [];
        while (gr.next()) platforms.push({
            platform: gr.getValue("platform"),
            fixed_monthly_cost: parseFloat(gr.getValue("fixed_monthly_cost") || 0),
            cost_per_transaction: parseFloat(gr.getValue("cost_per_transaction") || 0),
            compliance_certs: gr.getValue("compliance_certs") || "[]",
            typical_latency_ms: parseInt(gr.getValue("typical_latency_ms") || 500)
        });
        return platforms;
    },
    
    _getTotalVolume: function() {
        var ga = new GlideAggregate("x_snc_wco_profile"); ga.addAggregate("SUM", "monthly_volume"); ga.query();
        return ga.next() ? parseInt(ga.getAggregate("SUM", "monthly_volume")) : 1;
    },
    
    type: "CostCalculator"
};
