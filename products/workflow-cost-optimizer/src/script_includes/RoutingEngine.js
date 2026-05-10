/**
 * RoutingEngine — Generates optimal AI platform routing map.
 * Uses constraint-satisfaction: compliance (hard), latency (soft), budget (hard).
 * @class RoutingEngine @namespace x_snc_wco
 */
var RoutingEngine = Class.create();
RoutingEngine.prototype = {
    initialize: function() { this.calculator = new x_snc_wco.CostCalculator(); },
    
    generateOptimalRouting: function(budgetConstraint) {
        var profiles = this._getAllProfiles();
        var platforms = this._getAllPlatforms();
        var routing = [];
        for (var i = 0; i < profiles.length; i++) {
            var profile = profiles[i];
            var candidates = [];
            for (var j = 0; j < platforms.length; j++) {
                var p = platforms[j];
                if (!this._passesCompliance(profile, p)) continue;
                var cost = this._calcCost(profile, p);
                var adjCost = cost.monthly_cost * this._latencyPenalty(profile, p);
                candidates.push({ platform: p.platform, cost: cost.monthly_cost, adjusted_cost: adjCost, cost_per_ticket: cost.cost_per_ticket });
            }
            candidates.sort(function(a, b) { return a.adjusted_cost - b.adjusted_cost; });
            if (candidates.length > 0) {
                routing.push({
                    workflow_name: profile.name,
                    workflow_id: profile.sys_id,
                    monthly_volume: profile.monthly_volume,
                    recommended_platform: candidates[0].platform,
                    monthly_cost: candidates[0].cost,
                    annual_cost: Math.round(candidates[0].cost * 12 * 100) / 100,
                    cost_per_ticket: candidates[0].cost_per_ticket,
                    alternatives: candidates.slice(1, 3).map(function(c) { return c.platform; })
                });
            }
        }
        var totalCost = routing.reduce(function(s, r) { return s + r.monthly_cost; }, 0);
        if (budgetConstraint && totalCost > budgetConstraint) {
            routing.sort(function(a, b) { return (b.monthly_cost / Math.max(b.monthly_volume, 1)) - (a.monthly_cost / Math.max(a.monthly_volume, 1)); });
            while (totalCost > budgetConstraint && routing.length > 0) {
                var removed = routing.pop();
                totalCost -= removed.monthly_cost;
            }
        }
        this._saveRouting(routing);
        return { routing_map: routing, total_monthly_cost: Math.round(totalCost * 100) / 100, total_annual_cost: Math.round(totalCost * 12 * 100) / 100, coverage_pct: Math.round((routing.length / Math.max(profiles.length, 1)) * 100) };
    },
    
    roiProjection: function() {
        var nowAssistCost = 0, optimizedCost = 0;
        var profiles = this._getAllProfiles();
        var platforms = this._getAllPlatforms();
        var naPlatform = platforms.find(function(p) { return p.platform === "NOW_ASSIST"; });
        for (var i = 0; i < profiles.length; i++) {
            if (naPlatform) nowAssistCost += this._calcCost(profiles[i], naPlatform).monthly_cost;
            var routing = new GlideRecord("x_snc_wco_routing");
            routing.addQuery("workflow_profile", profiles[i].sys_id); routing.query();
            if (routing.next()) optimizedCost += parseFloat(routing.getValue("estimated_monthly_cost"));
        }
        var savings = nowAssistCost - optimizedCost;
        return {
            baseline_annual: Math.round(nowAssistCost * 12 * 100) / 100,
            optimized_annual: Math.round(optimizedCost * 12 * 100) / 100,
            annual_savings: Math.round(savings * 12 * 100) / 100,
            savings_pct: nowAssistCost > 0 ? Math.round((savings / nowAssistCost) * 100) : 0
        };
    },
    
    _passesCompliance: function(profile, platform) {
        if (profile.data_sensitivity === "HIGH") {
            var certs = JSON.parse(platform.compliance_certs || "[]");
            if (certs.indexOf("GDPR") < 0 && certs.indexOf("HIPAA") < 0 && certs.indexOf("IL5") < 0) return false;
        }
        return true;
    },
    
    _latencyPenalty: function(profile, platform) { return platform.typical_latency_ms > 1000 ? 1.2 : 1.0; },
    
    _calcCost: function(profile, platform) {
        var transactionCost = profile.monthly_volume * platform.cost_per_transaction;
        var totalVol = this._getTotalVolume();
        var fixedAlloc = platform.fixed_monthly_cost * (profile.monthly_volume / Math.max(totalVol, 1));
        var monthly = transactionCost + fixedAlloc;
        return { monthly_cost: monthly, cost_per_ticket: Math.round((monthly / Math.max(profile.monthly_volume, 1)) * 100) / 100 };
    },
    
    _getAllProfiles: function() {
        var gr = new GlideRecord("x_snc_wco_profile"), profiles = []; gr.query();
        while (gr.next()) profiles.push({ sys_id: gr.getUniqueValue(), name: gr.getValue("name"), monthly_volume: parseInt(gr.getValue("monthly_volume")), channel_affinity: gr.getValue("channel_affinity"), complexity: gr.getValue("complexity"), data_sensitivity: gr.getValue("data_sensitivity") });
        return profiles;
    },
    
    _getAllPlatforms: function() {
        var gr = new GlideRecord("x_snc_wco_pricing"), platforms = []; gr.query();
        while (gr.next()) platforms.push({ platform: gr.getValue("platform"), fixed_monthly_cost: parseFloat(gr.getValue("fixed_monthly_cost") || 0), cost_per_transaction: parseFloat(gr.getValue("cost_per_transaction") || 0), compliance_certs: gr.getValue("compliance_certs") || "[]", typical_latency_ms: parseInt(gr.getValue("typical_latency_ms") || 500) });
        return platforms;
    },
    
    _getTotalVolume: function() {
        var ga = new GlideAggregate("x_snc_wco_profile"); ga.addAggregate("SUM", "monthly_volume"); ga.query();
        return ga.next() ? parseInt(ga.getAggregate("SUM", "monthly_volume")) : 1;
    },
    
    _saveRouting: function(routing) { for (var i = 0; i < routing.length; i++) {
        var gr = new GlideRecord("x_snc_wco_routing"); gr.initialize();
        gr.workflow_profile = routing[i].workflow_id; gr.recommended_platform = routing[i].recommended_platform;
        gr.estimated_monthly_cost = routing[i].monthly_cost; gr.confidence_score = routing[i].alternatives.length > 0 ? 80 : 95;
        gr.insert();
    }},
    
    type: "RoutingEngine"
};
