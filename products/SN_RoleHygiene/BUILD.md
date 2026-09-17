# RoleHygiene — Build Summary (Phase 3)

**RUN_ID:** `20260917_050035_4458` · **Date:** 2026-09-17 · **Author:** Vladimir Kapustin
**Scope:** `x_snc_role_hygiene` · **License:** AGPL-3.0

---

## 1. Consolidation Decisions

The design specified **5 scoped tables** (`u_rh_snapshot`, `u_rh_finding`, `u_rh_sod_rule`, `u_rh_remediation_task`, `u_rh_setting`) and **6 features**. Enforced limits: **max 2 Script Includes, 2 tables, 2 REST endpoints**. Consolidation applied:

### Table Consolidation (5 → 2)

| Design table | Purpose | Strategy |
|--------------|---------|----------|
| `u_rh_snapshot` | time-series entitlement capture | **absorbed** — snapshot JSON stored as a `type=snapshot` row in `finding` table |
| `u_rh_finding` | flagged account + rule + evidence | **kept** — primary output table (`x_snc_role_hygiene_finding`) |
| `u_rh_sod_rule` | conflict-pair config | **absorbed** — `type=sod_rule` rows in `config` table (role_a/role_b reference fields) |
| `u_rh_remediation_task` | approval-gated tasks | **absorbed** — `type=remediation` rows in `finding` table (with `finding_ref` self-reference) |
| `u_rh_setting` | thresholds/schedule/prefs | **absorbed** — `type=setting` rows in `config` table (name/value fields) |

**Result:** 2 tables.

- `x_snc_role_hygiene_finding` — polymorphic type field (`dormant`/`creep`/`sod`/`run`/`snapshot`/`remediation`). Each record type uses a distinct subset of columns; `evidence` is a JSON column (4000-char) carrying the timestamped proof payload.
- `x_snc_role_hygiene_config` — polymorphic type field (`setting`/`sod_rule`). Settings use `name`+`value`; SoD rules use `role_a`+`role_b` references to `sys_user_role`.

### Script Include Consolidation (→ 2)

| Responsibility | Location |
|----------------|----------|
| Detection: dormancy, creep, SoD, scoring | `RoleHygieneEngine` (pure, read-only, deterministic) |
| Orchestration + persistence: audit runs, findings, snapshots, remediation, report | `RoleHygieneManager` |

### REST Endpoint Consolidation (→ 2 operations on 1 definition)

Single Scripted REST definition `x_snc_role_hygiene/audit` with two operations:

| Operation | Method | Path | Purpose |
|-----------|--------|------|---------|
| `execute` | POST | `/execute` | action-dispatch: `run` (full audit), `remediate` (create approval-gated task). Unknown action → HTTP 400. |
| `report` | GET | `/report` | compliance-ready report export (`run`, `limit` query params). |

---

## 2. Artifact Inventory

| Type | Count | Files |
|------|-------|-------|
| Script Includes | 2 | `scripts/RoleHygieneEngine.js`, `scripts/RoleHygieneManager.js` |
| Tables | 2 | `tables/x_snc_role_hygiene_finding.xml`, `tables/x_snc_role_hygiene_config.xml` |
| REST operations | 2 | `rest/role_hygiene_api.js` (IIFE, both ops share script) |
| Scheduled job | 1 | `br/scheduled_audit.xml` (weekly, periodically) |
| ACLs | 9 | `acl/acl_definitions.xml` (8 record + 1 rest_endpoint) |
| Manifest | 1 | `sys_app.xml` (963 lines, combined authoritative import) |
| Roles | 2 | `role_hygiene_admin`, `role_hygiene_auditor` |

### Cross-Scope Privileges (8)

Read access on OOTB tables: `sys_user`, `sys_user_has_role`, `sys_user_grmember`,
`sys_user_role`, `incident`, `sc_request`, `change_request`, `sysapproval_approver`.

---

## 3. Feature Coverage Matrix

| Design feature | Status | Notes |
|----------------|--------|-------|
| Dormant Account Detector | ✅ implemented | `detectDormantAccounts()` — last_login threshold + NULL handling + open-ticket cross-ref suppression |
| Privilege Creep Analyzer | ✅ implemented | `analyzeCreep()` — snapshot delta + per-department median outlier |
| Segregation-of-Duties Engine | ✅ implemented | `findSodConflicts()` — configurable pairs + blast-radius ranking |
| Access Review Report Generator | ✅ implemented | `generateReport()` — JSON output, timestamped evidence + rule fired + drift score |
| Remediation Proposal Workflow | ✅ implemented | `createRemediationTask()` — approval-gated, no silent auto-fix |
| Drift Dashboard | ⚠️ partial | drift score computed + stored per finding; UI dashboard deferred (data layer complete) |
| AI layer (Copilot / Agent Studio / GenAI Controller) | ⚠️ deferred | design marks as optional; deterministic core intentionally AI-free |

---

## 4. Quality Notes

- **Deterministic, AI-free core.** Detection is pure GlideRecord + business logic.
  Every finding is reproducible and defensible under audit. AI surfaces from the
  design (Now Assist copilot, Agent Studio skills, GenAI Controller) are optional
  layers that call these scripted endpoints — not required for the audit engine
  to function.
- **Read-only detection, human-in-the-loop remediation.** The engine never mutates
  security state. The only mutating REST action (`remediate`) creates an
  approval-gated task record; a human approves/rejects via the workflow.
- **Guarded writes.** All `insert()` calls are wrapped in try/catch (5 in Manager,
  1 in REST). A single failed insert cannot abort an audit run.
- **REST error contract.** Unknown action → 400, non-JSON body → 400, non-POST/GET
  → 405, internal error → 500. `setBody` always receives `JSON.stringify(...)`.
- **CDATA byte-match verified.** The combined `sys_app.xml` was programmatically
  assembled from the standalone `.js` sources; all three code blocks byte-match
  their standalone counterparts (no two-codebase fracture possible).
- **XML well-formedness.** All 5 XML artifacts parse cleanly via `xml.dom.minidom`.
- **Copyright.** Full name "Vladimir Kapustin", `(C)` uppercase, AGPL-3.0 SPDX on
  its own line in every `.js` and XML script block.

---

## 5. File Tree

```
03_build/
├── sys_app.xml                           # combined authoritative manifest (963 lines)
├── tables/
│   ├── x_snc_role_hygiene_finding.xml    # polymorphic finding/snapshot/run/remediation
│   └── x_snc_role_hygiene_config.xml     # polymorphic setting/sod_rule
├── scripts/
│   ├── RoleHygieneEngine.js              # deterministic detection (read-only)
│   └── RoleHygieneManager.js             # orchestration + persistence
├── rest/
│   └── role_hygiene_api.js               # POST /execute + GET /report (IIFE)
├── acl/
│   └── acl_definitions.xml               # 8 record ACLs + 1 rest_endpoint ACL
└── br/
    └── scheduled_audit.xml               # weekly drift audit scheduled job
```
