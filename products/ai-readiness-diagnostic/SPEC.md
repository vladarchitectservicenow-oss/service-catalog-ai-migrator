# Detailed Technical Specification — AI Readiness Diagnostic

## Implementation Plan by User Story

---

### US-02 | US-03: Workflow Scanner + Health Score

**Implementation:** `ProcessDebtScanner` Script Include

**Files:** `src/script_includes/ProcessDebtScanner.js`, `src/scheduled_jobs/weekly_health_scan.js`

**Scan Algorithm:**

```
1. Create diag_run record (status: RUNNING)
2. FOR EACH workflow source:
   a. wf_workflow: GlideRecord('wf_workflow').query()
   b. sys_flow: GlideRecord('sys_flow').query()
   c. sys_hub_flow: GlideRecord('sys_hub_flow').query()
3. For each workflow:
   a. Extract all steps/activities
   b. Build adjacency graph: steps → transitions
   c. Run detection patterns (see below)
   d. Calculate health_score = 100 - sum(issue_severity_weights)
   e. Write to x_snc_ard_workflow_health
4. Update diag_run: completed_at, aggregate scores
```

**Detection Patterns:**
```javascript
var DETECTORS = [
  { name: "MISSING_OWNER", weight: 15, fn: checkMissingOwner },
  { name: "INACTIVE_APPROVER", weight: 20, fn: checkInactiveApprover },
  { name: "UNREACHABLE_STEP", weight: 25, fn: detectUnreachableSteps },
  { name: "CIRCULAR_REF", weight: 30, fn: detectCycles },
  { name: "SILENT_FAILURE", weight: 20, fn: detectSilentFailures },
  { name: "DUPLICATE_TRIGGER", weight: 10, fn: detectDuplicateTriggers },
  { name: "NO_ERROR_HANDLER", weight: 10, fn: detectMissingErrorBranch },
  { name: "MISSING_AUDIT", weight: 15, fn: detectMissingAuditSteps }
];
```

---

### US-04: CMDB Health Analyzer

**Implementation:** `CMDBHealthAnalyzer` Script Include

**Files:** `src/script_includes/CMDBHealthAnalyzer.js`

**Key Queries:**
```javascript
// Completeness
var ga = new GlideAggregate('cmdb_ci');
ga.addAggregate('COUNT');
ga.addNotNullQuery('name');
ga.addNotNullQuery('operational_status');
ga.addNotNullQuery('owned_by');
// ... configurable required fields per class
ga.query();

// Duplicates (per class, >90% name similarity)
var gr = new GlideRecord('cmdb_ci');
gr.addQuery('sys_class_name', className);
gr.orderBy('name');
gr.query();
// Compare adjacent records by name similarity

// Orphans
var ciGr = new GlideRecord('cmdb_ci');
var relGr = new GlideRecord('cmdb_rel_ci');
ciGr.query();
while (ciGr.next()) {
  relGr.addQuery('child', ciGr.sys_id)
    .addOrCondition('parent', ciGr.sys_id);
  relGr.query();
  if (relGr.getRowCount() == 0) { /* orphan */ }
}
```

---

### US-05: Knowledge Base Analyzer

**Implementation:** `KBAnalyzer` Script Include

**Files:** `src/script_includes/KBAnalyzer.js`

**Detection:**
```javascript
// Empty articles
var gr = new GlideRecord('kb_knowledge');
gr.addNullQuery('text').addOrCondition('text', '').addOrCondition('text', '<p></p>');
gr.query();

// Outdated (>2 years)
gr.addQuery('sys_updated_on', '<', gs.yearsAgo(2));

// Unattached (no category + no views)
gr.addNullQuery('kb_category');
gr.addQuery('sys_view_count', 0);

// Duplicates (title Levenshtein)
function levenshteinSimilarity(a, b) { /* standard algorithm */ }
```

---

### US-06: AI Agent Simulator

**Implementation:** `AISimulator` Script Include

**Files:** `src/script_includes/AISimulator.js`

**Simulation Logic:**
```
For each workflow:
  1. Identify entry trigger (catalog submit, incident create, etc.)
  2. List all data dependencies:
     - GlideRecord references to cmdb_ci tables
     - KB article lookups
     - User/role queries
  3. For each dependency:
     - Check if data exists (CMDB completeness)
     - Check if data is current (updated <365 days)
     - Check if KB has relevant article
  4. Simulate decision branches:
     - If CI missing → AI will ASK USER (breaks automation)
     - If KB empty → AI will HALLUCINATE
     - If approval assigned to inactive → PROCESS STALLS
  5. Output: simulation_result (PASS/WARNING/FAIL)
```

---

### US-07: Roadmap Generator

**Implementation:** `RoadmapGenerator` Script Include

**Files:** `src/script_includes/RoadmapGenerator.js`

**Scoring Formula:**
```
priority = (ai_impact × 0.4) + (frequency × 0.3) + (blocking_count × 0.2) + (fix_ease × 0.1)
```

**Output Structure:**
```javascript
{
  quick_wins: [/* fixes <2hrs, unblocks 3+ AI flows */],
  phase_1_30d: [/* critical blockers, high AI impact */],
  phase_2_90d: [/* important, moderate effort */],
  phase_3_180d: [/* nice-to-have, high effort */]
}
```

---

## REST API Contracts

### POST `/api/x_snc_ard/v1/diagnose`
```json
// Request
{ "type": "FULL", "scope": "all" }

// Response 200
{
  "diag_run_id": "...",
  "status": "RUNNING",
  "estimated_completion_seconds": 180
}
```

### GET `/api/x_snc_ard/v1/diagnose/{id}`
```json
// Response 200
{
  "status": "COMPLETED",
  "readiness_score": 62,
  "breakdown": {
    "workflow_health": 71,
    "cmdb_health": 48,
    "kb_health": 65
  },
  "critical_issues": 23,
  "workflows_scanned": 340,
  "workflows_broken": 87
}
```

### GET `/api/x_snc_ard/v1/simulate`
```json
// Response 200
{
  "simulations": [
    { "workflow": "Password Reset", "result": "WARNING", "gap": "KB_ARTICLE_MISSING" },
    { "workflow": "VPN Access", "result": "FAIL", "gap": "CI_NOT_FOUND" }
  ]
}
```

## Error Handling

| Error | Code | Response |
|-------|------|----------|
| Diagnostic still running | 409 | `{"error": "DIAGNOSTIC_IN_PROGRESS"}` |
| Unknown scope | 400 | `{"error": "INVALID_SCOPE"}` |
| CMDB class not found | 404 | `{"error": "CI_CLASS_NOT_FOUND"}` |
| Auth failure | 401 | Standard OAuth error |

## Scheduled Jobs

- **Weekly Health Scan:** Every Sunday 03:00, `ProcessDebtScanner.fullScan()`
- **CMDB Delta Check:** Daily 06:00, `CMDBHealthAnalyzer.incrementalScan()`
- **KB Freshness Check:** Every Monday 05:00, `KBAnalyzer.freshnessCheck()`

## Testing Strategy

### ATF Tests
1. Create workflow with broken pattern → scan → verify detection
2. CMDB with 50% completeness → analyze → verify score <60
3. KB with empty articles → analyze → verify empty_pct >0
4. Simulate workflow against dirty CMDB → verify FAIL result
5. Roadmap generation produces prioritized, non-empty output
