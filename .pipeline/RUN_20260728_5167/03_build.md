# SN Assignment Rule Auditor — Build Summary

**RUN_ID:** RUN_20260728_5167
**Date:** 2026-07-28
**Scope:** `sn_assignment_rule_auditor`
**Version:** 1.0.0

---

## Consolidation Decisions

The design document specified 8 Script Includes, 6 tables, and 7 REST endpoints — all exceeding the enforced limits (max 2 SIs, 2 tables, 2 REST endpoints). The following consolidations were applied before code generation:

### Script Includes (8 → 2)

| Design SI | Absorbed Into | Strategy |
|-----------|---------------|----------|
| `AssignmentRuleScanner` | → `AssignmentRuleEngine` | Core scanner merged into engine |
| `ConflictDetector` | → `AssignmentRuleEngine` | Private method `detectConflicts()` |
| `DeadRuleDetector` | → `AssignmentRuleEngine` | Private method `detectDeadRules()` |
| `ConditionValidator` | → `AssignmentRuleEngine` | Private method `validateConditions()` |
| `HealthScoreEngine` | → `AssignmentRuleEngine` | Private method `computeHealthScore()` |
| `SimulationEngine` | → `AssignmentRuleEngine` | Public method `simulate()` |
| `GenAIExplainability` | → `AssignmentRuleHelper` | Public method `explainConflict()` |
| `BaselineManager` | → `AssignmentRuleHelper` | Public methods `createBaseline()`, `compareBaseline()` |

**Rationale:** All detection/scanning logic operates on the same data (assignment rules) and shares the same lifecycle (scan → detect → score → persist). Helper absorbs cross-cutting concerns (AI, baselines, simulation history, cleanup) that are called independently of the core scan.

### Tables (6 → 2)

| Design Table | Absorbed Into | Strategy |
|-------------|---------------|----------|
| `x_sn_ara_health_snapshot` | → `x_sn_ara_scan_result` (type=health_snapshot) | Polymorphic type |
| `x_sn_ara_conflict` | → `x_sn_ara_scan_result` (type=conflict) | Polymorphic type |
| `x_sn_ara_dead_rule` | → `x_sn_ara_scan_result` (type=dead_rule) | Polymorphic type |
| `x_sn_ara_stale_condition` | → `x_sn_ara_scan_result` (type=stale_condition) | Polymorphic type |
| `x_sn_ara_simulation_history` | → `x_sn_ara_session` (type=simulation) | Polymorphic type |
| `x_sn_ara_baseline` | → `x_sn_ara_session` (type=baseline) | Polymorphic type |

**Rationale:** All scan outputs share the same core schema (table_name, rule reference, severity, detail, timestamp). Sessions share the same core schema (type, name, status, data_json, created_by, created_at). Polymorphic type fields cleanly partition both tables.

### REST Endpoints (7 → 2)

| Design Endpoint | Consolidated Into | Dispatch |
|----------------|-------------------|----------|
| `GET /health/{table}` | → `GET /status?type=health&table=X` | Query param |
| `GET /health` | → `GET /status?type=health` | Query param |
| `GET /conflicts/{table}` | → `GET /status?type=conflicts&table=X` | Query param |
| `GET /dead_rules/{table}` | → `GET /status?type=dead_rules&table=X` | Query param |
| `GET /stale_conditions/{table}` | → `GET /status?type=stale_conditions&table=X` | Query param |
| `POST /simulate` | → `POST /execute` (action=simulate) | Action dispatch |
| `POST /explain/{id}` | → `POST /execute` (action=explain) | Action dispatch |

**Additional actions on POST /execute:** `scan`, `create_baseline`, `compare_baseline`.

---

## Artifact Inventory

| Category | Count | Files |
|----------|-------|-------|
| Scoped App Manifest | 1 | `sys_app.xml` |
| Custom Tables | 2 | `tables/x_sn_ara_scan_result.xml`, `tables/x_sn_ara_session.xml` |
| Script Includes | 2 | `scripts/AssignmentRuleEngine.js` (20KB, 400+ lines), `scripts/AssignmentRuleHelper.js` (14.5KB, 300+ lines) |
| REST Endpoints | 2 | `rest/post_execute.js`, `rest/get_status.js` |
| REST API XML | 1 | `rest/sn_ara_api.xml` |
| ACL Definitions | 1 | `acl/acl_definitions.xml` (10 ACLs: 8 table + 2 REST) |
| Scheduled Jobs | 3 | `br/scheduled_jobs_and_br.xml` (Nightly Scan, Weekly Baseline, Cleanup) |
| Business Rules | 2 | `br/scheduled_jobs_and_br.xml` (auto-set timestamps on insert) |

---

## Feature Coverage

| Feature | Status | Implementation |
|---------|--------|---------------|
| F1 — Conflict Detection Engine | ✅ Implemented | `AssignmentRuleEngine.detectConflicts()` — pairwise comparison, overlap calculation, severity scoring |
| F2 — Dead Rule Finder | ✅ Implemented | `AssignmentRuleEngine.detectDeadRules()` — priority chain trace, coverage subtraction, fully/partially dead classification |
| F3 — Condition Validator | ✅ Implemented | `AssignmentRuleEngine.validateConditions()` — field existence, choice values, script includes, group existence, 4-tier severity |
| F4 — Routing Health Dashboard | ⚠️ Partial | Health scores computed and persisted. UI pages not included (requires UI Builder/Page — out of scope for script-only build). REST API exposes all data for external dashboard consumption. |
| F5 — Simulation Mode | ✅ Implemented | `AssignmentRuleEngine.simulate()` — form-based input, rule matching, what-if support. History saved via `AssignmentRuleHelper.saveSimulation()`. |
| F6 — AI-Powered Explanation | ✅ Implemented | `AssignmentRuleHelper.explainConflict()` — GenAI Controller integration with deterministic template fallback |
| F7 — Proactive Monitoring | ✅ Implemented | Scheduled jobs: Nightly Health Scan (daily 02:00), Weekly Baseline (Monday 03:00), Cleanup (Sunday 04:00). Baseline comparison via `compareBaseline()`. |

---

## Quality Notes

### Read-Only Policy
All OOTB table access is read-only via `sys_scope_privilege` records in `sys_app.xml`:
- `sys_rule_assignment` — read
- `sys_user_group` — read
- `sys_choice` — read
- `sys_dictionary` — read
- `sys_script_include` — read
- `sys_user` — read

### Security
- Two roles: `sn_ara_admin` (full access) and `sn_ara_viewer` (read-only)
- ACLs on both custom tables: read (admin+viewer), create/write/delete (admin only)
- REST endpoints require `sn_ara_admin` or `sn_ara_viewer`
- All `insert()` calls wrapped in try/catch
- All `response.setBody()` calls use `JSON.stringify()`

### Dependencies
- ServiceNow Zurich+ (GenAI Controller for AI explanations — graceful fallback to templates)
- Cross-scope access to OOTB tables (declared in `sys_app.xml`)
- No external plugins required

### Quality Checks Passed
- ✅ Copyright headers on all 4 `.js` files
- ✅ `JSON.stringify()` on all `setBody()` calls (5 in GET, 6 in POST)
- ✅ `try/catch` blocks in both Script Includes (2 in Engine, 5 in Helper)
- ✅ `default:` case returning 400 in both REST endpoints
- ✅ All 4 `.js` files pass Node.js syntax check
- ✅ No placeholders — all code is production-ready

---

## File Tree

```
03_build/
├── sys_app.xml                          # Scoped app manifest + cross-scope privileges + roles
├── tables/
│   ├── x_sn_ara_scan_result.xml         # Polymorphic: health_snapshot, conflict, dead_rule, stale_condition
│   └── x_sn_ara_session.xml             # Polymorphic: simulation, baseline
├── scripts/
│   ├── AssignmentRuleEngine.js          # Core: scan, detect conflicts, dead rules, validate, score, simulate
│   └── AssignmentRuleHelper.js          # Helper: AI explain, baselines, simulation history, cleanup
├── rest/
│   ├── post_execute.js                  # POST /api/x_sn_ara/execute (action dispatch)
│   ├── get_status.js                    # GET /api/x_sn_ara/status (query-param dispatch)
│   └── sn_ara_api.xml                   # REST API definition + CDATA-wrapped scripts
├── acl/
│   └── acl_definitions.xml              # 10 ACLs: 8 table (CRUD) + 2 REST (execute)
└── br/
    └── scheduled_jobs_and_br.xml        # 3 scheduled jobs + 2 business rules
```
