# WhereUsed Radar — Build Summary

**RUN_ID:** 20260828_050052_9652
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_wur` (design scope `sn_where_used_radar`)

---

## 1. Consolidation Decisions

The design specified 4 tables, 9 Script Includes, and 4 REST endpoints. These were consolidated to the enforced limits (max 2 tables, 2 SIs, 2 REST endpoints) before any code was written.

### Tables: 4 → 2

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_sn_wur_scan` | `x_sn_wur_scan` | Primary table (unchanged) |
| `x_sn_wur_reference` | `x_sn_wur_reference` | Primary table (unchanged) |
| `x_sn_wur_impact` | → `impact_json` on scan table | JSON column absorption |
| `x_sn_wur_dependency` | → reference table (each finding IS an edge) | Edge-as-record |

**Rationale:** The per-object risk score (`impact`) is always read alongside its scan run, so it fits naturally as a JSON column on the scan record. The dependency graph is a projection of the reference findings — each reference record already carries `source_type/source_name → target_type/target_name`, which is exactly a graph edge. No separate edge table is needed; `WurReport.buildDependencyGraph()` normalizes findings into `{nodes, edges}` for the D3 renderer.

### Script Includes: 9 → 2

| Design SI | Absorbed Into | Notes |
|-----------|---------------|-------|
| `WurAcquisition` | `WurScanner` | `ACQUISITION_SURFACE` map + read-only GlideRecord loop |
| `WurScriptScanner` | `WurScanner` | `_scanScript()`, `_stripStringLiterals()`, `_matchPattern()` |
| `WurClientScanner` | `WurScanner` | `g_form`/`g_user` patterns in `RISK_RULES` |
| `WurFlowJobScanner` | `WurScanner` | `sys_hub_flow` + `sysauto_script` in acquisition surface |
| `WurDeclarativeScanner` | `WurScanner` | `sys_dictionary`/`sys_security_acl`/`sys_transform_map` in surface |
| `WurImpactScorer` | `WurScanner` | `RISK_RULES` + `computeImpact()` |
| `WurScanRunner` | `WurScanner` | `runScan()` orchestration + scan-record lifecycle |
| `WurReportGenerator` | `WurReport` | `buildImpactReport()`, `exportMarkdown()` |
| `WurDependencyBuilder` | `WurReport` | `buildDependencyGraph()` |

**Rationale:** The first seven SIs all operate on the same data (the scripted surface + findings) and share the same lifecycle (all called during a scan). The last two operate on scan results (reporting + graph projection). Merging by responsibility yields two cohesive classes: `WurScanner` (acquisition + scanning + scoring + orchestration) and `WurReport` (reporting + remediation + batch/diff + graph).

### REST Endpoints: 4 → 2

| Design Endpoint | Consolidated Into | Dispatch |
|-----------------|-------------------|----------|
| `POST /wur/scan/run` | `POST /execute` | `action: "scan"` |
| `GET /wur/scan` | `GET /status` | `?report=<scan_id>` |
| `GET /wur/references` | `GET /status` | `?workbench=<scan_id>` |
| `GET /wur/impact` | `GET /status` | `?graph=<scan_id>` / `?markdown=<scan_id>` |

**Rationale:** All write operations dispatch on a single `action` body parameter (`scan`, `assess_batch`, `diff`); all read operations dispatch on query parameters. Both endpoints return HTTP 400 with a `valid_actions`/`valid_params` list for unrecognized input.

---

## 2. Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Scoped app manifest | 1 | `sys_app.xml` (scope, 2 roles, 9 cross-scope read privileges, 2 SIs, 2 REST ops) |
| Custom tables | 2 | `x_sn_wur_scan`, `x_sn_wur_reference` |
| Script Includes | 2 | `WurScanner` (16.7 KB), `WurReport` (13.1 KB) |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| Scheduled job | 1 | `WhereUsed Radar Weekly Impact Scan` (weekly, delta via high-water mark) |
| ACLs | 10 | 4 per table (read/write/create/delete) + 2 REST endpoint execute |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Code-Aware Reference Scanner | ✅ Implemented | `WurScanner.scanTarget()` + `_scanScript()` over 9-table acquisition surface, string-literal stripping, dynamic-reference detection |
| 2. Impact Scoring Engine | ✅ Implemented | `RISK_RULES` (SAFE/WARN/BREAK) + `computeImpact()` (0–100) |
| 3. Batch & Update-Set Mode | ✅ Implemented | `WurReport.assessBatch()` (ranked multi-object assessment) |
| 4. Cross-Instance Diff | ✅ Implemented | `WurReport.diffImpact()` (baseline vs candidate, risk-delta ranking) |
| 5. Ranked Impact Report | ✅ Implemented | `WurReport.buildImpactReport()` + `exportMarkdown()` (PDF/CSV deferred to Phase 3) |
| 6. Dependency Graph | ✅ Implemented | `WurReport.buildDependencyGraph()` → `{nodes, edges}` for D3.js |
| 7. Remediation Workbench | ✅ Implemented | `WurReport.buildRemediationWorkbench()` + curated `FIX_CATALOG` |

**AI layer (Phase 4) is intentionally not load-bearing:** fix-suggestion generation, refactor sequencing, the "assess my change" agent, and report narrative are all optional Now Assist / AI Agent Studio integrations. The deterministic core delivers 100% of the audit value without any GenAI Controller — the `FIX_CATALOG` provides curated remediation hints as the graceful fallback.

---

## 4. Quality Notes

- **Read-only acquisition, scoped writes:** the scanner only *reads* the scripted surface (`sys_script`, `sys_script_include`, `sys_script_client`, `sys_ui_policy`, `sys_hub_flow`, `sysauto_script`, `sys_dictionary`, `sys_security_acl`, `sys_transform_map`); it writes only to its own scoped result tables. Zero risk to the configuration estate.
- **Cross-scope access:** 9 read privileges declared in `sys_app.xml` for the acquisition surface (all `target_type=table`).
- **String-literal vs. code distinction:** `_stripStringLiterals()` removes quoted literals before matching, cutting false positives; dynamic/indirect references (runtime-built names) are flagged `confidence=unverifiable` rather than `BREAK`.
- **Delta scanning:** each scan records a `high_water_mark`; `_getHighWaterMark()` reads the last completed scan's mark for incremental re-scans.
- **Guarded writes:** every `insert()`/`update()` is wrapped in try/catch; REST endpoints return structured HTTP 500 (no raw stack traces).
- **Human-in-the-loop:** findings are never auto-fixed; the workbench suggests a fix and the developer reviews/promotes manually.
- **Copyright:** full "Vladimir Kapustin" headers with `SPDX-License-Identifier: AGPL-3.0` on every `.js` and `.xml` file.

---

## 5. File Tree

```
03_build/
├── sys_app.xml                 # Combined manifest (866 lines, 4 CDATA blocks byte-matched)
├── tables/
│   ├── scan.xml                # x_sn_wur_scan (run log + impact_json)
│   └── reference.xml           # x_sn_wur_reference (findings = graph edges)
├── scripts/
│   ├── WurScanner.js           # Acquisition + scanning + scoring + orchestration
│   └── WurReport.js            # Reporting + remediation + batch/diff + graph
├── rest/
│   ├── post_execute.js         # POST /execute (action dispatch)
│   └── get_status.js           # GET /status (query-param dispatch)
├── acl/
│   └── acls.xml                # 10 ACLs (2 tables × 4 ops + 2 REST endpoints)
└── br/
    └── scheduled_job.xml       # Weekly impact scan (delta via high-water mark)
```

---

## 6. Verification

| Check | Result |
|-------|--------|
| XML well-formedness (5 files) | ✅ PASS |
| JS syntax (`node --check`, 4 files) | ✅ PASS |
| CDATA byte-match (4 blocks) | ✅ PASS |
| Copyright headers (4 `.js` + 5 `.xml`) | ✅ PASS |
| `JSON.stringify` on all `setBody` | ✅ PASS |
| try/catch around all `insert()` | ✅ PASS |
| HTTP 400 default case in both REST endpoints | ✅ PASS |
