# RetentionGuard — Build Summary

**RUN_ID:** 20260826_050040_1788
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_snc_retention_guard`

---

## 1. Consolidation Decisions

The design specified 4 tables, 8 Script Includes, and 4 REST endpoints. These were consolidated to the enforced limits (max 2 tables, 2 SIs, 2 REST endpoints) before any code was written.

### Tables: 4 → 2

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `sn_retention_policy` | `x_snc_retention_guard_policy` | Primary table (unchanged) |
| `sn_retention_run` | `x_snc_retention_guard_run` | Primary table (unchanged) |
| `sn_retention_hold` | → `holds_json` on policy table | JSON column absorption |
| `sn_retention_growth` | → `x_snc_retention_guard_run` (type=growth) | Polymorphic type field |

**Rationale:** Legal holds are always accessed alongside their policy (a hold is a property of a table's retention config), so they fit naturally as a JSON array on the policy record. Growth snapshots share the run table's core schema (timestamp + row count + status), so a `type` choice field cleanly partitions `run` (execution log) from `growth` (snapshot) records.

### Script Includes: 8 → 2

| Design SI | Absorbed Into | Notes |
|-----------|---------------|-------|
| `RetentionGuardInventory` | `RetentionGuardEngine` | `inventoryTables()`, `_countRows()` |
| `RetentionGuardPolicyEngine` | `RetentionGuardEngine` | `getPolicyForTable()`, `computeCutoff()`, `seedDefaultPolicies()` |
| `RetentionGuardExecutor` | `RetentionGuardEngine` | `executeTable()`, `_fetchBatch()`, `_deleteRecord()` |
| `RetentionGuardReferentialCheck` | `RetentionGuardEngine` | `hasInboundReferences()`, `_findReferenceFields()` |
| `RetentionGuardRunRunner` | `RetentionGuardEngine` | `runCycle()`, `_createRunRecord()`, `_finalizeRunRecord()` |
| `RetentionGuardReportGenerator` | `RetentionGuardReport` | `buildAuditReport()`, `buildComplianceStatement()` |
| `RetentionGuardHoldManager` | `RetentionGuardReport` | `addHold()`, `removeHold()`, `listHolds()` |
| `RetentionGuardForecast` | `RetentionGuardReport` | `forecastGrowth()`, `_growthRate()`, `detectDrift()` |

**Rationale:** The first five SIs all operate on the same data (policies, run records, target tables) and share the same lifecycle (all called during a retention cycle). The last three all operate on reporting/hold/forecast data. Merging by responsibility yields two cohesive classes: `RetentionGuardEngine` (orchestration + execution) and `RetentionGuardReport` (reporting + holds + forecasting).

### REST Endpoints: 4 → 2

| Design Endpoint | Consolidated Into | Dispatch |
|-----------------|-------------------|----------|
| `POST /retention/run` | `POST /execute` | `action: "run_cycle"` |
| `POST /retention/policy` | `POST /execute` | `action: "seed_policies"` / `"add_hold"` / `"remove_hold"` |
| `GET /retention/inventory` | `GET /status` | `?inventory=true` |
| `GET /retention/report` | `GET /status` | `?report=<run_id>` |

**Rationale:** All write operations dispatch on a single `action` body parameter; all read operations dispatch on query parameters. Both endpoints return HTTP 400 with a `valid_actions`/`valid_params` list for unrecognized input.

---

## 2. Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Scoped app manifest | 1 | `sys_app.xml` (scope, 2 roles, 7 cross-scope privileges, 2 SIs, 2 REST ops) |
| Custom tables | 2 | `x_snc_retention_guard_policy`, `x_snc_retention_guard_run` |
| Script Includes | 2 | `RetentionGuardEngine` (14.8 KB), `RetentionGuardReport` (11.6 KB) |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| ACLs | 10 | 4 per table (read/write/create/delete) + 2 REST execute |
| Scheduled job | 1 | `RetentionGuard Daily Dry-Run` (daily, dry-run mode) |
| Roles | 2 | `x_snc_retention_guard.admin`, `x_snc_retention_guard.user` |
| Cross-scope privileges | 7 | read on `sys_db_object`, `sys_dictionary`, `sys_audit`, `syslog`, `sys_email`, `sys_attachment`, `sys_journal_field` |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Table Growth Inventory | ✅ Implemented | `inventoryTables()` — GlideAggregate row counts, protected-table exclusion, sorted by size |
| 2. Declarative Retention Policy Engine | ✅ Implemented | `getPolicyForTable()`, `seedDefaultPolicies()` — 5 curated defaults mapped to GDPR/HIPAA/SOX |
| 3. Safe Archive/Purge Executor | ✅ Implemented | `executeTable()` — dry-run, chunked delete, referential-integrity checks, before/after counts |
| 4. Compliance Audit Report | ✅ Implemented | `buildAuditReport()` + `buildComplianceStatement()` — policy-to-action traceability |
| 5. Legal-Hold & Exception Management | ✅ Implemented | `addHold()`/`removeHold()`/`listHolds()` — hard block enforced by executor |
| 6. Growth Forecasting & Cost Projection | ✅ Implemented | `forecastGrowth()` — 12/24/36-month cost projection |
| 7. Policy Drift Detection | ✅ Implemented | `detectDrift()` — flags tables growing faster than retention can absorb |
| AI policy recommendation (Phase 4) | ⏸ Deferred | Deterministic core is complete; AI is optional and layered on top per design |

**All 7 core features are fully implemented.** The AI layer (Now Assist policy recommendation, compliance mapping, conversational agent) is explicitly optional per the design — RetentionGuard delivers 100% of its retention value without a GenAI Controller.

---

## 4. Quality Notes

- **Read-only discovery, scoped writes:** Inventory only reads schema metadata and row counts; the executor writes only to its own scoped tables plus explicitly-configured target records.
- **Legal hold is a hard block:** `isTableHeld()` is checked before any purge/archive; blocked tables are logged with `status: "blocked"` and `reason: "legal_hold"`.
- **Referential integrity by construction:** `hasInboundReferences()` checks `sys_dictionary` for reference fields before every delete; referenced records are skipped, never orphaned.
- **Chunked deletes:** `_fetchBatch()` + `_deleteRecord()` with `setWorkflow(false)` avoid transaction blowout; batch size configurable via `_batchSize`.
- **Dry-run before write:** `runCycle(true)` is the default scheduled-job mode; live execution requires explicit `dry_run: false`.
- **Guarded inserts/updates:** All `insert()`/`update()`/`deleteRecord()` calls are wrapped in try/catch or return-value checks.
- **Cross-scope access:** 7 read privileges declared for OOTB tables; inventory reports zero-result tables as warnings, not silent passes.
- **Security:** 10 ACLs gate all table and REST access; admin role for write, user role for read-only reporting.

---

## 5. Verification

- **XML well-formedness:** All 5 XML files parse cleanly (`xml.dom.minidom`).
- **CDATA byte-match:** All 4 CDATA blocks in `sys_app.xml` match their standalone `.js` sources (assembled programmatically — zero drift).
- **Copyright headers:** All 4 `.js` files carry `Copyright (C) 2026 Vladimir Kapustin` + `SPDX-License-Identifier: AGPL-3.0`.
- **REST correctness:** Both endpoints use `JSON.stringify` on `setBody` and return HTTP 400 for unrecognized input.
- **Node.js mock smoke test:** 10/10 tests pass — inventory exclusion, idempotent policy seeding, policy lookup, dry-run preview, legal-hold block, hold removal, referential-integrity check, live execution with integrity skip, full cycle + audit report, growth forecast.

---

## 6. File Tree

```
03_build/
├── sys_app.xml                          # Combined scoped app manifest (34 KB)
├── tables/
│   ├── policy.xml                       # x_snc_retention_guard_policy
│   └── run.xml                          # x_snc_retention_guard_run (polymorphic)
├── scripts/
│   ├── RetentionGuardEngine.js           # Core engine (inventory/policy/executor/orchestration)
│   └── RetentionGuardReport.js           # Reporting/forecast/holds
├── rest/
│   ├── post_execute.js                  # POST /execute (action dispatch)
│   └── get_status.js                    # GET /status (query-param dispatch)
├── acl/
│   └── acls.xml                         # 10 ACLs (tables + REST)
└── br/
    └── scheduled_job.xml                # Daily dry-run scheduled job
```
