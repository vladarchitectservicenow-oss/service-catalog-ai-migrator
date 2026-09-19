# CatalogSweep — Build Summary (03_build)

**RUN_ID:** `20260919_050043_2203` · **Date:** 2026-09-19 · **Author:** Vladimir Kapustin
**Scope:** `x_catalog_sweep` · **Product:** CatalogSweep — dependency-aware catalog sprawl auditor + governed retirement workflow

---

## 1. Consolidation Decisions (Design → Build)

The design document (`02_design.md`) specified **5 tables, 6 Script Includes, and 4 REST endpoints** — exceeding the enforced build limits (max 2 tables, 2 Script Includes, 2 REST endpoints). These were consolidated *before* writing code, per the factory's limit-consolidation rule.

### Tables: 5 → 2

| Design table | Absorbed into | Strategy |
|--------------|---------------|----------|
| `x_catalog_sweep_scan_run` | → **kept** (Table 1) | — |
| `x_catalog_sweep_item_finding` | → **kept** (Table 2, primary) | — |
| `x_catalog_sweep_dependency` | → `item_finding.dependencies_json` | JSON column absorption |
| `x_catalog_sweep_retirement_task` | → `item_finding.state` + `change_request` + `requested_by` + `approved_by` | State folds onto finding |
| `x_catalog_sweep_retired_item` | → `item_finding.snapshot` + `archived_on` | JSON column absorption (archive snapshot) |

The finding record becomes the single source of truth: its `state` field drives the retirement lifecycle (`active → staged → pending_approval → approved → archived / blocked`), and its JSON columns hold dependency evidence and the reversible archive snapshot.

### Script Includes: 6 → 2

| Design SI | Absorbed into | Notes |
|-----------|---------------|-------|
| `CatalogScanner` | → **`CatalogSweepScanner`** (kept) | scan + classification + scoring |
| `DependencyTracer` | → `CatalogSweepScanner._traceDependencies()` | private method |
| `RetirementScorer` | → `CatalogSweepScanner.score()` | deterministic 0–100, public method |
| `DuplicateClusterer` | → `CatalogSweepScanner.clusterDuplicates()` | deterministic name clustering + BYOK hook |
| `RetirementOrchestrator` | → **`CatalogSweepOrchestrator`** (kept) | stage / approve / archive |
| `ReportGenerator` | → `CatalogSweepOrchestrator.exportFull()` + `.dashboardSummary()` | private methods |

### REST endpoints: 4 → 2

| Design endpoint | Consolidated into | Dispatch |
|-----------------|-------------------|----------|
| `POST /scan/run` | → `POST /execute` | `action: "scan"` |
| `POST /findings` (stage) | → `POST /execute` | `action: "stage"` |
| `POST /approve` | → `POST /execute` | `action: "approve"` |
| `GET /findings` + `/dependencies/{id}` + `/export/full` | → `GET /status` | `?category=&bucket=&state=&item_type=&item_sys_id=&export=full&summary=true` |

---

## 2. Artifact Inventory

| Type | Count | Artifacts |
|------|-------|-----------|
| Script Includes | 2 | `CatalogSweepScanner`, `CatalogSweepOrchestrator` |
| Custom tables | 2 | `x_catalog_sweep_scan_run`, `x_catalog_sweep_item_finding` |
| REST endpoints | 2 | `POST /execute`, `GET /status` (base `/api/x_catalog_sweep/v1`) |
| Scheduled jobs | 2 | Weekly full scan (Sun 02:00), nightly incremental scan (01:00) |
| Cross-scope privileges | 15 | read/write on `sc_cat_item`, `sc_cat_item_producer`, `sc_cat_item_guide`, `change_request`; read on `sc_req_item`, `sc_cat_item_guide_items`, `sc_cat_item_option_mtom`, `catalog_script_client`, `catalog_ui_policy`, `sys_hub_flow`, `wf_workflow` |
| ACLs | 6 | record read/write/create on both tables + `rest_service` execute on both endpoints |
| Roles | 1 | `x_catalog_sweep.admin` |

**File tree:**

```
03_build/
├── sys_app.xml                     # combined scoped-app manifest: scope + role + privileges + SIs + REST (tables/ACL/jobs ship separately below)
├── tables/
│   ├── scan_run.xml                # x_catalog_sweep_scan_run (mode/status/started_on/finished_on/item_count/finding_count)
│   └── item_finding.xml            # x_catalog_sweep_item_finding (item_sys_id/name/type/category/score/bucket/state + JSON cols)
├── scripts/
│   ├── CatalogSweepScanner.js      # core engine (scan, trace, score, cluster)
│   └── CatalogSweepOrchestrator.js # retirement workflow + export + dashboard
├── rest/
│   ├── post_execute.js             # POST action-dispatch
│   └── get_status.js               # GET read-only
├── acl/
│   └── acl_definitions.xml
└── br/
    └── scheduled_jobs.xml
```

---

## 3. Feature Coverage Matrix

| # | Design feature | Status | Implementation |
|---|----------------|--------|----------------|
| 1 | Sprawl Inventory Scan | ✅ Implemented | `CatalogSweepScanner.run(mode)` + `_scanEstate()` over 3 estate tables; classification into duplicate/abandoned_draft/zero_request/orphaned/healthy |
| 2 | Dependency Graph Tracer | ✅ Implemented | `_traceDependencies()` — order-guide membership, variable-set links, client scripts, UI policies, request references, flow/workflow text scan |
| 3 | Retirement-Readiness Score | ✅ Implemented | `score()` — deterministic 0–100 with penalty weights, buckets safe/needs_review/blocked |
| 4 | Governed Retirement Workflow | ✅ Implemented | `Orchestrator.stage()/approve()/archive()` — change_request approval, archive-not-delete |
| 5 | Catalog Health Dashboard | ✅ Implemented (API) | `dashboardSummary()` aggregation exposed via `GET /status?summary=true`; UI page deferred to P2 |
| 6 | Machine-Readable Export | ✅ Implemented | `exportFull()` — versioned JSON schema (`schema_version: 1.0`) via `GET /status?export=full` |
| 7 | Retirement Approval Flow (Flow Designer) | ⚠️ Partial | Approval gate + TOCTOU re-check implemented in `approve()`; the `sys_hub_flow` visual flow is the design-time equivalent, documented in §5 |

---

## 4. Quality Notes

- **Read-only policy honored:** the scanner is read-mostly; archiving is the only write to target tables (`active=false`), performed only by the orchestrator through the approval-gated path. No hard delete anywhere.
- **TOCTOU guard:** `approve()` re-runs the full dependency trace at approval time; any live dependency added after staging blocks the archive and transitions the finding to `blocked`.
- **Deterministic scoring:** retirement readiness is pure code — no LLM — so results are reproducible and defensible in an audit. AI (BYOK duplicate clustering, narrative generation, AI Agent Studio "Catalog Governor") is deferred to Phase 4 and documented as additive, never authoritative.
- **Cross-scope safety:** 15 explicit cross-scope privileges declared in `sys_app.xml`; absent privileges would otherwise cause silent empty GlideRecord reads on target tables.
- **Guarded writes:** every `insert()` / `update()` wrapped in try/catch; `setWorkflow(false)` used on all updates to avoid stale business-rule side effects.
- **REST hygiene:** `response.setBody(JSON.stringify(...))` everywhere (no raw object → `[object Object]`); unknown `action` returns HTTP 400 with a valid-actions list; all errors return structured `{ok:false, error, message}`.
- **Aggregate avoidance:** usage counts via `GlideAggregate` (not `getRowCount()`); scans paginated with `setLimit`.

---

## 5. Known Deferrals (Phase 2–4)

- **P2 — UI:** Catalog Health Dashboard page + UI Actions (Scan Now / Stage / View Dependencies) not yet built; dashboard is API-only.
- **P4 — AI:** BYOK embedding clustering (`clusterDuplicates()` currently deterministic name normalization), retirement-narrative generation, and the AI Agent Studio "Catalog Governor" agent are stubbed by design, not implemented.

These are additive to v1 and do not affect the core scanning/scoring/retirement value.

---

## 6. Verification

- ✅ JS syntax valid (`node --check`) on all 4 `.js` files
- ✅ XML well-formed on all 5 `.xml` files
- ✅ AGPL-3.0 copyright header (`Vladimir Kapustin`) on all source files
- ✅ `sys_app.xml` CDATA byte-matches standalone sources (Scanner, Orchestrator, Execute, Status — all verified)
- ✅ Combined manifest (`sys_app.xml`) carries scope + role + 15 cross-scope privileges + 2 SIs + 2 REST ops. The 2 tables (`tables/*.xml`), ACLs (`acl/*.xml`), and scheduled jobs (`br/*.xml`) ship as **separate update-set files**, not embedded in `sys_app.xml`.
