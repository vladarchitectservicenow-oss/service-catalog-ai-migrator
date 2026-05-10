# Detailed Technical Specification — Workflow Cost Optimizer

## Implementation Plan by User Story

---

### US-01: Workflow Profiler

**Implementation:** `WorkflowProfiler` Script Include

**Files:** `src/script_includes/WorkflowProfiler.js`, `src/scheduled_jobs/monthly_cost_scan.js`

**Algorithm:**
```javascript
var WorkflowProfiler = Class.create();
WorkflowProfiler.prototype = {
  
  profileAll: function() {
    this._profileCatalogItems();
    this._profileIncidentCategories();
    this._profileRequestTypes();
    return this._summary();
  },
  
  _profileCatalogItems: function() {
    var gr = new GlideRecord('sc_cat_item');
    gr.addActiveQuery();
    gr.query();
    while (gr.next()) {
      var profile = this._classifyItem(gr);
      this._saveProfile('sc_cat_item', gr.sys_id.toString(), profile);
    }
  },
  
  _classifyItem: function(gr) {
    var profile = {};
    
    // Channel affinity from sc_req_item + interaction records
    var reqGr = new GlideRecord('sc_req_item');
    reqGr.addQuery('cat_item', gr.sys_id);
    reqGr.addQuery('sys_created_on', '>=', gs.monthsAgo(6));
    reqGr.query();
    
    var total = reqGr.getRowCount();
    var portalCount = 0, slackCount = 0, emailCount = 0, apiCount = 0;
    
    while (reqGr.next()) {
      var channel = reqGr.getValue('channel'); // or derived from request source
      if (channel == 'service_portal') portalCount++;
      else if (channel == 'virtual_agent') slackCount++;
      else if (channel == 'email') emailCount++;
      else if (channel == 'api') apiCount++;
    }
    
    // Classify by majority
    if (portalCount/total > 0.8) profile.channel_affinity = 'PORTAL';
    else if (slackCount/total > 0.5) profile.channel_affinity = 'SLACK';
    else if (emailCount/total > 0.5) profile.channel_affinity = 'EMAIL';
    else if (apiCount/total > 0.5) profile.channel_affinity = 'API';
    else profile.channel_affinity = 'MIXED';
    
    // Complexity
    profile.complexity = this._calcComplexity(gr);
    profile.monthly_volume = Math.round(total / 6);
    profile.avg_resolution_min = this._avgResolution(gr.sys_id.toString());
    profile.data_sensitivity = this._calcSensitivity(gr);
    
    return profile;
  }
};
```

---

### US-02: Cost Calculator

**Implementation:** `CostCalculator` Script Include

**Files:** `src/script_includes/CostCalculator.js`

**Pricing Model Loading:**
```javascript
_calculateForWorkflow: function(profileId, platformId) {
  var profile = this._getProfile(profileId);
  var pricing = this._getPricing(platformId);
  
  // Per-transaction cost
  var transactionCost = profile.monthly_volume * pricing.cost_per_transaction;
  
  // Fixed cost allocation (weighted by volume %)
  var totalVolume = this._getTotalVolume();
  var volumeShare = profile.monthly_volume / totalVolume;
  var fixedAllocation = pricing.fixed_monthly_cost * volumeShare;
  
  return {
    platform: pricing.platform,
    monthly_cost: transactionCost + fixedAllocation,
    cost_per_resolution: (transactionCost + fixedAllocation) / profile.monthly_volume,
    annual_cost: (transactionCost + fixedAllocation) * 12
  };
}
```

---

### US-04: Optimal Routing Engine

**Implementation:** `RoutingEngine` Script Include

**Files:** `src/script_includes/RoutingEngine.js`

**Constraint-Satisfaction Approach:**
```javascript
generateOptimalRouting: function(budgetConstraint) {
  var profiles = this._getAllProfiles();
  var platforms = this._getAllPlatforms();
  var routing = [];
  
  for (var i = 0; i < profiles.length; i++) {
    var profile = profiles[i];
    var candidates = [];
    
    for (var j = 0; j < platforms.length; j++) {
      var platform = platforms[j];
      
      // Hard constraints
      if (!this._passesCompliance(profile, platform)) continue;
      if (!this._passesLatency(profile, platform)) continue;
      
      // Soft constraints — cost
      var cost = this._calculator._calculateForWorkflow(
        profile.sys_id.toString(), platform.sys_id.toString()
      );
      
      candidates.push({
        platform: platform.platform,
        cost: cost.monthly_cost,
        adjusted_cost: cost.monthly_cost * this._latencyPenalty(profile, platform)
      });
    }
    
    // Select minimum adjusted cost
    candidates.sort(function(a, b) { return a.adjusted_cost - b.adjusted_cost; });
    
    if (candidates.length > 0) {
      routing.push({
        workflow: profile.name,
        platform: candidates[0].platform,
        cost: candidates[0].cost
      });
    }
  }
  
  // Budget check
  var totalCost = routing.reduce(function(sum, r) { return sum + r.cost; }, 0);
  if (budgetConstraint && totalCost > budgetConstraint) {
    // Greedy removal of highest cost-per-volume workflows until under budget
    routing.sort(function(a, b) { 
      return (b.cost / b.volume) - (a.cost / a.volume); 
    });
    while (totalCost > budgetConstraint && routing.length > 0) {
      var removed = routing.pop();
      totalCost -= removed.cost;
    }
  }
  
  return routing;
}
```

---

## REST API Contracts

### GET `/api/x_snc_wco/v1/profiles`
```json
{"profiles": [{"id": "...", "name": "Password Reset", "volume": 450, "affinity": "PORTAL"}]}
```

### GET `/api/x_snc_wco/v1/compare?platforms=now_assist,moveworks`
```json
{"comparisons": [{"workflow": "Password Reset", "now_assist_monthly": 2340.00, "moveworks_monthly": 1520.00}]}
```

### POST `/api/x_snc_wco/v1/optimize`
```json
// Request {"budget": 80000}
// Response {"routing_map": [...], "total_monthly_cost": 6200, "annual_cost": 74400, "coverage_pct": 92}
```

## Error Handling

| Error | Code | Response |
|-------|------|----------|
| Unknown platform | 400 | `{"error": "UNKNOWN_PLATFORM"}` |
| Budget too low for any coverage | 422 | `{"error": "BUDGET_INSUFFICIENT", "min_required": 50000}` |
| No pricing data configured | 503 | `{"error": "PRICING_NOT_CONFIGURED"}` |

## Scheduled Jobs
- **Monthly Cost Scan:** 1st of month 02:00 — profiles all workflows, recalculates costs, regenerates routing
- **Pricing Freshness Alert:** Weekly — flags pricing models not updated in >90 days

## Testing Strategy

### ATF Tests
1. Profile 3 catalog items with mixed channel patterns → verify classification accuracy
2. Calculate cost on fixed pricing model → verify arithmetic
3. Route with compliance constraint (GDPR-only platforms) → verify constraint satisfaction
4. Budget optimization at $X → verify total ≤ $X
5. ROI projection → verify savings >0 when routing away from pure Now Assist
