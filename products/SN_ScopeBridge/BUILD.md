# ScopeBridge — Build Summary (03)

**RUN_ID:** 20260920_050101_9067
**Product:** ScopeBridge (`sn_scope_bridge`, scope `x_snb`)
**Stage:** 03 — Build
**Date:** 2026-09-20

---

## 1. What Was Built

ScopeBridge is a **scoped application** that statically maps every cross-scope call a scoped app makes, flags the references with no `sys_scope_privilege`, and generates the exact least-privilege privilege records — before promotion. It turns a runtime-only failure mode (`Cross scope privilege denied`) into a statically-verifiable, least-privilege-by-default deployment workflow.

---

## 2. Consolidation Decisions

The design specified **4 tables**, **3+ Script Includes**, and **7 features** — all above the enforced limits (max 2 tables, 2 Script Includes, 2 REST endpoints). Consolidation was applied before any code was written.

### 2.1 Tables — 4 → 2 (JSON column absorption)

| Design table | Purpose | Disposition |
|--------------|---------|-------------|
| `x_snb_scan` | Scan run header | **KEPT** — primary table |
| `x_snb_reference` | Detected cross-scope reference | **KEPT** — primary table |
| `x_snb_privilege` | Generated/derived privilege record | **ABSORBED** — generator returns records in-memory and writes directly to `sys_scope_privilege` (OOTB); no custom table needed |
| `x_snb_audit_log` | Append-only evidence trail | **ABSORBED** — serialized into `x_snb_scan.audit_log_json` (JSON array, capped at 50 entries) |

The `x_snb_scan` table carries two JSON columns — `summary_json` (coverage totals) and `audit_log_json` (append-only evidence trail) — eliminating the need for separate `privilege` and `audit_log` tables.

### 2.2 Script Includes — 3+ → 2 (merge by responsibility)

| Design component | Responsibility | Disposition |
|------------------|----------------|-------------|
| Reference Engine (Stage 1) | Tokenize scripts for cross-scope calls | **MERGED** into `ScopeBridgeScanner` |
| Coverage Cross-Reference | Compare refs vs `sys_scope_privilege` | **MERGED** into `ScopeBridgeScanner` |
| Over-Privilege Auditor | Flag wildcard/orphaned privileges | **MERGED** into `ScopeBridgeScanner` |
| Drift Detector | Diff privilege sets between scans | **MERGED** into `ScopeBridgeScanner` |
| Artifact Collector | Gather script bodies per scope | **MERGED** into `ScopeBridgeScanner` |
| Least-Privilege Generator | Generate minimal privilege records | **KEPT** as `ScopeBridgeGenerator` (the apply path) |
| GenAI Rationale | Per-record justification | **MERGED** into `ScopeBridgeGenerator` |

**Result:** 2 Script Includes — `ScopeBridgeScanner` (read/analysis: collect → parse → cross-reference → audit → drift) and `ScopeBridgeGenerator` (apply path: generate → dry-run → apply → rationale). The security-critical boundary is preserved: **no AI in the apply path**; the generator is fully deterministic.

### 2.3 REST Endpoints — consolidated (POST action-dispatch + GET query-param)

| Design need | Disposition |
|-------------|-------------|
| Run scan | `POST /execute` action=`scan` |
| Generate/apply privileges | `POST /execute` action=`generate` |
| Over-privilege audit | `POST /execute` action=`audit` |
| Drift detection | `POST /execute` action=`drift` |
| Scan header / refs / coverage matrix | `GET /status` view=`scan` \| `refs` \| `matrix` |

**Result:** 2 REST endpoints — one POST action-dispatch endpoint and one GET query-parameter dispatch endpoint. Both return HTTP 400 on unknown action/view and HTTP 404 on unknown scan id.

---

## 3. Artifact Inventory

| Artifact | Path | Count |
|----------|------|-------|
| Scoped app manifest (combined) | `sys_app.xml` | 1 (1,440 lines) |
| Script Includes (standalone) | `scripts/` | 2 |
| REST endpoint scripts (standalone) | `rest/` | 2 |
| Custom table XML (`sys_db_object` + `sys_dictionary` + `sys_choice`) | `tables/` | 2 |
| ACL definitions (record + rest_service) | `acl/acl_definitions.xml` | 1 (10 ACLs, 12 roles) |
| Scheduled job (nightly coverage scan) | `br/scheduled_job.xml` | 1 |

### 3.1 Tables

- **`x_snb_scan`** — scan header: `target_scope`, `mode` (full/incremental), `status` (running/completed/failed), `started_on`, `finished_on`, `artifact_count`, `reference_count`, `engine_version`, `ai_model`, `summary_json`, `audit_log_json`.
- **`x_snb_reference`** — one row per detected cross-scope reference: `scan` (ref→scan), `source_scope`, `source_artifact`, `artifact_kind`, `target_table`, `target_scope`, `operations` (JSON array), `kind`, `classification`, `confidence`, `status` (covered/uncovered/overprivileged).

### 3.2 Script Includes

- **`ScopeBridgeScanner`** — deterministic engine. Artifact collector (7 OOTB script tables + flows), Stage-1 regex/tokenizer reference parser (GlideRecord + CRUD inference, `sn_ws.RESTMessageV2`/`GlideAjax`, `gs.getProperty`), coverage cross-reference vs `sys_scope_privilege`, over-privilege auditor, drift detector, audit-trail appender.
- **`ScopeBridgeGenerator`** — least-privilege generator. Derives minimal `(scope, table, operation)` records, refuses `*` on `*` (flags for review), dry-run default, guarded apply with audit. GenAI rationale is optional BYOK and degrades to a deterministic rationale.

### 3.3 REST Endpoints

- **`POST /x_snb/scope_bridge/execute`** — `scan`, `generate`, `audit`, `drift` actions.
- **`GET /x_snb/scope_bridge/status`** — `scan`, `refs`, `matrix` views (+ default health).

### 3.4 Business Rule / Scheduled Job

- **`ScopeBridge Nightly Coverage Scan`** — `sysauto_script` (periodically, 02:00, run-as system). Incrementally re-scans each scope in `x_snb.tracked.scopes` (comma-separated property). Safe no-op when unset.

---

## 4. Feature Coverage Matrix

| # | Design feature | Implementation | Status |
|---|----------------|----------------|--------|
| 1 | Cross-Scope Reference Scanner | `ScopeBridgeScanner._parseReferences` + `_collectArtifacts` | ✅ Implemented (deterministic Stage-1) |
| 2 | Coverage Gap Report | `_coverageStatus` + `getCoverageMatrix` + `listReferences` | ✅ Implemented |
| 3 | Least-Privilege Generator | `ScopeBridgeGenerator.generate` (dry-run/apply, refuses wildcard) | ✅ Implemented |
| 4 | Privilege Drift Detection | `ScopeBridgeScanner.driftBetween` | ✅ Implemented |
| 5 | Over-Privilege Auditor | `ScopeBridgeScanner.auditOverPrivilege` | ✅ Implemented |
| 6 | Promotion Gate (CI/CD lint) | Exposed via `GET /status?view=matrix` + `POST /execute?action=audit` | ⚠️ Partial (API-level; `sn_cd` lint wiring is deployment-phase) |
| 7 | Audit Export & Evidence Pack | `audit_log_json` append-only trail + `summary_json` | ⚠️ Partial (JSON evidence; CSV/PDF export is v1.2) |

**AI layer (Now Assist Stage-2 classification + GenAI rationale + AI Agent Studio "Privilege Reviewer"):** intentionally **stubbed/optional** — the design marks these as v1.2. The deterministic engine marks every reference `confirmed` / `confidence:100` when no provider is configured, and the generator falls back to a deterministic rationale. This keeps the apply path fully auditable and reproducible (explicit design requirement).

---

## 5. Quality Notes

- **Read-only policy:** `ScopeBridgeScanner` only writes to its own scoped tables (`x_snb_scan`, `x_snb_reference`) and reads `sys_scope_privilege`. It never mutates foreign data.
- **Deterministic apply path:** `ScopeBridgeGenerator` is the sole component that writes `sys_scope_privilege`; no AI decides which privilege is applied.
- **Least-privilege-by-default:** generator refuses wildcard (`*`) targets/operations and flags them for manual review.
- **Guarded writes:** every `insert()` / `update()` wrapped in try/catch with `gs.error` logging; `setWorkflow(false)` on updates.
- **`setBody` stringification:** all REST responses use `JSON.stringify(...)` — no raw-object `[object Object]`.
- **400-on-unknown:** both endpoints return HTTP 400 with a structured error body for unknown action/view; 404 for missing scan ids.
- **Copyright:** all 5 code files carry `// Copyright (C) 2026 Vladimir Kapustin` + `SPDX-License-Identifier: AGPL-3.0`.
- **Cross-scope grants:** 12 `sys_scope_privilege` records declared in the manifest covering read access to the OOTB artifact/config tables and read+write on `sys_scope_privilege` for the generator.
- **ACL completeness:** 10 ACLs (read/write per table × admin/developer/auditor + rest_service execute) with role assignments.
- **Verification:** JS `node --check` clean on all 4 scripts; XML well-formed on all 5 XML files; CDATA byte-match verified at assembly time (all 4 blocks PASS).

---

## 6. File Tree

```
03_build/
├── sys_app.xml                        # combined authoritative manifest (1,440 lines)
├── tables/
│   ├── x_snb_scan.xml
│   └── x_snb_reference.xml
├── scripts/
│   ├── ScopeBridgeScanner.js
│   └── ScopeBridgeGenerator.js
├── rest/
│   ├── post_execute.js
│   └── get_status.js
├── acl/
│   └── acl_definitions.xml
└── br/
    └── scheduled_job.xml
```
