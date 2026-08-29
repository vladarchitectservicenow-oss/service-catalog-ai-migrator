# BR Medic — Build Summary

**RUN_ID:** 20260829_050024_6055
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_brmedic`

---

## 1. Consolidation Decisions

The design specified 3 tables, 9 Script Includes, and 4 REST endpoints. These were consolidated to the enforced limits (max 2 tables, 2 Script Includes, 2 REST endpoints) before any code was written.

### Tables: 3 → 2

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_brmedic_finding` | *(kept)* | Primary finding store |
| `x_brmedic_scan` | *(kept)* | Scan run log |
| `x_brmedic_script_health` | → `health_json` column on `x_brmedic_scan` | JSON column absorption |

The per-script aggregate score (script health dashboard) is stored as a JSON array in the `health_json` column of the scan record. It is always read/written as a batch with its parent scan, never queried independently, and fits within the 4000-char string limit for typical estates (top-N offenders are what the dashboard surfaces).

### Script Includes: 9 → 2

| Design SI | Absorbed Into | Notes |
|-----------|---------------|-------|
| `BrmAcquisition` | → `BrmScanner` | Acquisition is a private method (`_scanBusinessRules`, `_scanScriptIncludes`) |
| `BrmNPlusOneDetector` | → `BrmScanner` | `_detectNPlusOne` |
| `BrmUnindexedWhereDetector` | → `BrmScanner` | `_detectUnindexedWhere` |
| `BrmSyncHeavyOpDetector` | → `BrmScanner` | `_detectSyncHeavyOp` |
| `BrmRecursionDetector` | → `BrmScanner` | `_detectRecursion` |
| `BrmConditionGatingAuditor` | → `BrmScanner` | `_detectMissingGating` |
| `BrmImpactScorer` | → `BrmScanner` | `_scoreFinding`, `_severityFor` |
| `BrmScanRunner` | → `BrmScanner` | `runScan`, `runDeltaScan` |
| `BrmReportGenerator` | → `BrmReport` | `buildReport`, `exportMarkdown`, `exportCsv` |

**Merge rationale:** All five detectors + acquisition + scoring operate on the same data (script bodies + table metadata) and share the same lifecycle (all run during a scan). Reporting/export/workbench operate on the persisted findings and are the read-side of the same data. Two SIs — `BrmScanner` (analysis) and `BrmReport` (reporting) — cleanly partition write vs read.

### REST Endpoints: 4 → 2

| Design Endpoint | Consolidated Into | Dispatch |
|----------------|-------------------|----------|
| `POST /brm/scan/run` | → `POST /execute` | `action: "scan"` |
| *(delta scan)* | → `POST /execute` | `action: "delta_scan"` |
| *(finding status)* | → `POST /execute` | `action: "set_status"` |
| `GET /brm/scan` | → `GET /status` | `?report=<scan_id>` |
| `GET /brm/findings` | → `GET /status` | `?workbench=<scan_id>` |
| `GET /brm/script-health` | → `GET /status` | `?health=<scan_id>` |
| *(report export)* | → `GET /status` | `?markdown=<scan_id>` / `?csv=<scan_id>` |

---

## 2. Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Scoped app manifest | 1 | `sys_app.xml` (1083 lines, combined manifest) |
| Custom tables | 2 | `x_brmedic_scan`, `x_brmedic_finding` |
| Script Includes | 2 | `BrmScanner`, `BrmReport` |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| Scheduled job | 1 | Weekly delta scan (Sunday 03:00) |
| ACLs | 10 | 4 per table (read/write/create/delete) + 2 REST execute |
| Roles | 2 | `x_brmedic.admin`, `x_brmedic.user` |
| Cross-scope privileges | 5 | read on `sys_script`, `sys_script_include`, `sys_index`, `sys_dictionary`, `sys_db_object` |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. N+1 Query Detector | ✅ Implemented | `_detectNPlusOne` — loop-stack tracking + query regex |
| 2. Unindexed `where` Detector | ✅ Implemented | `_detectUnindexedWhere` — `sys_index` cross-reference, distinguishes "none" vs "not leading" |
| 3. Synchronous Heavy-Op Detector | ✅ Implemented | `_detectSyncHeavyOp` — high-volume table + sync rule + heavy op |
| 4. Recursion / Double-Write Detector | ✅ Implemented | `_detectRecursion` — `current.update/insert/setWorkflow/setValue` |
| 5. Condition-Gating Auditor | ✅ Implemented | `_detectMissingGating` — empty condition + missing `gs.hasRole` |
| 6. Prioritized Remediation Report | ✅ Implemented | `_scoreFinding` (volume × op cost × freq × concurrency) + `buildReport` |
| 7. Remediation Workbench + Scheduled Scan | ✅ Implemented | `buildWorkbench` + `setFindingStatus` + weekly delta job |
| AI fix-suggestion (Now Assist) | ⏳ Deferred (Phase 4) | Curated `FIX_CATALOG` is the deterministic fallback; AI layers on top |

**AI usage is optional by design** (per the design doc §4): the five detectors and scorer are pure logic; the curated fix catalog ships with the app so 100% of audit value is delivered with no GenAI Controller configured.

---

## 4. Quality Notes

- **Read-only acquisition, scoped writes:** the analyzer only reads `sys_script`, `sys_script_include`, `sys_index`, `sys_dictionary`, `sys_db_object`; it writes only to its own scoped result tables. Zero risk to the script estate.
- **Delta scanning via high-water mark:** `runDeltaScan` only re-analyzes scripts with `sys_updated_on` after the last completed scan's `high_water_mark`.
- **String-literal vs code distinction:** `_stripStringLiterals` removes quoted literals before matching, cutting false positives.
- **Index cross-reference as first-class data:** `_checkIndex` reads `sys_index` at scan time (with a per-scan cache), reflecting current index state.
- **Human-in-the-loop remediation:** findings are never auto-fixed; `setFindingStatus` records acknowledge/dismiss/fix with user + timestamp.
- **Security:** all `insert()`/`update()` calls wrapped in try/catch; REST endpoints return structured 400/500 (no raw stack traces); ACLs role-gated (admin/user split).
- **Copyright:** full "Vladimir Kapustin" headers on every file, AGPL-3.0 SPDX identifier.

---

## 5. File Tree

```
03_build/
├── sys_app.xml              # Combined manifest (scope, roles, SIs, REST, job, privileges)
├── tables/
│   ├── scan.xml             # x_brmedic_scan (absorbs script_health via health_json)
│   └── finding.xml          # x_brmedic_finding
├── scripts/
│   ├── BrmScanner.js        # Analysis engine (5 detectors + scorer + acquisition)
│   └── BrmReport.js         # Reporting + workbench + export
├── rest/
│   ├── post_execute.js      # POST /execute (action-dispatch)
│   └── get_status.js        # GET /status (query-param dispatch)
├── acl/
│   └── acls.xml             # 10 ACLs (tables + REST)
└── br/
    └── scheduled_job.xml    # Weekly delta scan
```

---

## 6. Verification

- ✅ All 4 JS files pass `node --check` (syntax valid)
- ✅ All 5 XML files well-formed (`xml.dom.minidom.parse`)
- ✅ `sys_app.xml` 1083 lines (not skeletal)
- ✅ All 5 CDATA blocks byte-match their standalone sources (assembler verified)
- ✅ Copyright headers on all `.js` files
- ✅ `JSON.stringify` on all `setBody` calls
- ✅ try/catch around all `insert()`/`update()` calls
- ✅ REST endpoints return 400 for unrecognized input
