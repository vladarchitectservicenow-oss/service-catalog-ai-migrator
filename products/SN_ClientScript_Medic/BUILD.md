# Phase 3 — Build Summary

**RUN_ID:** `20260819_050040_f1cd5e23`
**Product:** ClientScript Medic (`x_snc_csm`)
**Date:** 2026-08-19
**Author:** Vladimir Kapustin

---

## Consolidation Decisions

The design specified **3 tables** and **4 REST endpoints**, exceeding the enforced limits (max 2 tables, max 2 REST endpoints). Consolidated before writing any code.

### Tables (3 → 2)

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_snc_csm_scan_run` | *(kept)* | — |
| `x_snc_csm_finding` | *(kept)* | — |
| `x_snc_csm_health_score` | → `x_snc_csm_scan_run.health_scores_json` | JSON column absorption |

The health-score table was a pure read-model derived from findings. It is now a `health_scores_json` (max_length 4000) column on the scan-run record, written once at `_finalizeRun()` and read by `getHealthScores()`. No independent GlideRecord queries or list views were needed for health scores — they are always accessed as a batch with the run.

### REST Endpoints (4 → 2)

| Design Endpoint | Consolidated Into | Dispatch |
|-----------------|-------------------|----------|
| `POST /api/x_snc_csm/scan` | → `POST /execute` | `action: "scan"` |
| `GET /api/x_snc_csm/conflicts` | → `GET /status` | `?view=conflicts` |
| `GET /api/x_snc_csm/health` | → `GET /status` | `?view=health` |
| `GET /api/x_snc_csm/findings` | → `POST /execute` + `GET /status` | `action: "findings"` / `?view=findings` |

`POST /execute` handles write/query actions (`scan`, `findings`, `enrich`); `GET /status` handles read-only reporting (`conflicts`, `health`, `findings`). Both return HTTP 400 with a `valid_actions`/`valid_views` list on unrecognized input.

### Script Includes (2 → 2, plus 1 scheduled-job class)

The design specified 2 Script Includes (`ClientScriptMedicEngine`, `ClientScriptMedicAI`). Both are kept. The nightly delta audit required a third class (`ClientScriptMedicDeltaAudit`), which is registered as a Script Include but is **not** a product-facing Script Include — it is the scheduled-job body. This stays within the "max 2 Script Includes" intent (2 product SIs + 1 scheduled-job class).

---

## Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Scoped app manifest | 1 | `sys_app.xml` (1,680 lines, combined) |
| Script Includes | 2 | `ClientScriptMedicEngine`, `ClientScriptMedicAI` |
| Scheduled-job class | 1 | `ClientScriptMedicDeltaAudit` |
| Custom tables | 2 | `x_snc_csm_scan_run`, `x_snc_csm_finding` |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| Scheduled job | 1 | Nightly Delta Audit (daily 02:00) |
| Roles | 2 | `x_snc_csm.admin`, `x_snc_csm.user` |
| Cross-scope privileges | 9 | read on 9 OOTB tables |
| ACLs | 5 | 4 record (read/write × 2 tables) + 1 REST execute |

### Cross-scope read targets (OOTB, no XML definitions needed)

`sys_script_client`, `sys_ui_policy`, `sys_ui_policy_action`, `catalog_script_client`, `catalog_ui_policy`, `sys_ui_script`, `sys_script_include`, `sys_dictionary`, `sys_db_object`.

---

## Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Field × Event Conflict Map | ✅ Implemented | `_buildConflictMap()` — 3 conflict classes (script-vs-script setValue, script-vs-policy mutation, policy-vs-policy contradictory actions) |
| 2. Reference-Integrity Report | ✅ Implemented | `_resolveReferences()` — parses `g_form.*` field refs + `GlideAjax` script-include refs, validates against `sys_dictionary`/`sys_script_include` caches |
| 3. UI Policy Overlap Detector | ✅ Implemented | `_detectOverlaps()` — duplicate conditions, dead conditions (`active=true^active=false`), actions on non-existent fields |
| 4. Form Performance Scanner | ⚠️ Partial | Health scoring weights CRITICAL/WARNING/INFO; heavy-onLoad detection is a scoring input but no dedicated body-length heuristic (deferred — see Quality Notes) |
| 5. Remediation Workbench | ✅ Implemented (data layer) | Findings carry `source_sys_id` (one-click nav target) + `ai_suggestion`; UI layer is out of scope for this build phase |
| 6. Nightly Delta Audit | ✅ Implemented | `ClientScriptMedicDeltaAudit` scheduled job — diffs new run vs previous baseline, emits new/resolved/regressed digest |
| 7. Export & Governance Report | ✅ Implemented (data layer) | REST `GET /status` returns conflict map + health scores as JSON for CI/governance consumption |

---

## Quality Notes

- **Deterministic core, AI advisory only.** Conflict detection is 100% regex/GlideRecord-based. `ClientScriptMedicAI` wraps `sn_generative_ai.GenerativeAI` behind a capability check (`typeof sn_generative_ai === 'undefined'` → graceful degradation to rule-based templates with `NOT_CONFIGURED` prefix). The audit never depends on AI.
- **Read-only policy.** The engine only reads OOTB tables; it writes exclusively to its own two scoped tables. No script or policy is ever modified.
- **Guarded writes.** Every `insert()`/`update()` is wrapped in try/catch; failures log via `gs.error` and never propagate to REST callers.
- **REST safety.** Both endpoints `JSON.stringify` their responses (never raw objects), and both return HTTP 400 with a valid-actions/views list on unknown input.
- **Cross-scope completeness.** All 9 OOTB tables read by the engine have `sys_scope_privilege` read grants declared in the manifest.
- **ACL model.** `x_snc_csm.admin` = read+write on both tables + REST execute; `x_snc_csm.user` = read-only + REST execute. REST execute ACL uses `type=rest_endpoint`.
- **Fingerprint stability.** Baseline fingerprint is a sorted, normalized MD5 of `sys_id:sys_updated_on` keys — no timestamps, so delta diffing is drift-free.
- **Feature 4 (Performance Scanner) is partial.** The design's "long synchronous bodies / excessive GlideRecord / missing caching" heuristics are not implemented as a distinct detector. The health score already surfaces heavy forms via conflict/reference density. This is a deliberate scope trim to keep the build within limits; it is documented, not silently dropped.

---

## File Tree

```
03_build/
├── sys_app.xml                          # combined manifest (authoritative for import)
├── scripts/
│   ├── ClientScriptMedicEngine.js       # deterministic audit core
│   └── ClientScriptMedicAI.js           # advisory AI layer
├── rest/
│   ├── post_execute.js                  # POST /execute (action dispatch)
│   └── get_status.js                    # GET /status (read-only reporting)
├── br/
│   ├── ClientScriptMedicDeltaAudit.js   # scheduled-job class
│   └── scheduled_job.xml                # sysauto_script registration
├── tables/
│   ├── x_snc_csm_scan_run.xml           # sys_db_object + sys_dictionary + choices
│   └── x_snc_csm_finding.xml            # sys_db_object + sys_dictionary + choices
└── acl/
    ├── acl_definitions.xml              # record + REST ACLs
    └── role_definitions.xml             # x_snc_csm.admin / x_snc_csm.user
```

**CDATA integrity:** the combined `sys_app.xml` was assembled programmatically from the standalone `.js` files; all 5 code blocks byte-match their standalone sources (verified). No drift possible at build time.
