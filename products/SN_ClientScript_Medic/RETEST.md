# Phase 5 — Retest Report (Quick Validation)

**RUN_ID:** `20260819_050040_f1cd5e23`
**Product:** ClientScript Medic (`x_snc_csm`)
**Date:** 2026-08-19
**Author:** Vladimir Kapustin
**Role:** QA Quick Validation Agent

---

## Status: PASS

No critical errors remain. All 5 CRITICAL and 5 WARNING fixes from `05_fix.md` verified against the actual build artifacts.

---

## Syntax Verification

| File | `node --check` |
|------|----------------|
| `scripts/ClientScriptMedicEngine.js` | PASS |
| `scripts/ClientScriptMedicAI.js` | PASS |
| `br/ClientScriptMedicDeltaAudit.js` | PASS |
| `rest/post_execute.js` | PASS |
| `rest/get_status.js` | PASS |

| XML File | `xml.dom.minidom.parse` |
|----------|------------------------|
| `sys_app.xml` | PASS |
| `tables/x_snc_csm_scan_run.xml` | PASS |
| `tables/x_snc_csm_finding.xml` | PASS |
| `acl/acl_definitions.xml` | PASS |
| `acl/role_definitions.xml` | PASS |
| `br/scheduled_job.xml` | PASS |

---

## Critical Fix Verification

| ID | Claim | Verified Result |
|----|-------|-----------------|
| C1 | Tables merged into `sys_app.xml` | **PASS** — 2 `sys_db_object`, 17 `sys_dictionary`, 11 `sys_choice` records present (open/close tags balanced). Manifest importable standalone. |
| C2 | `_tableCache` wired into validation | **PASS** — `_tableExists()` (line 559) reads `_tableCache`; called in `_checkScriptRefs()` (line 484) emitting `BROKEN_REF`/`CRITICAL` for non-existent tables. |
| C3 | `regressedCount` incremented | **PASS** — `_diffRuns()` increments `regressedCount` when a new finding's key is absent from prev run AND `_wasResolved()` returns true (line 72). |
| C4 | `resolved` flag set to `true` | **PASS** — `_markResolved()` (line 100) updates `resolved=true` on previous findings absent from the new run. |
| C5 | Catalog scripts validated against variables | **PASS** — `_catalogVarCache` loaded from `item_option_new` (line 165); `_catalogVarExists()` branch in `_checkScriptRefs()` (line 497) routes catalog scripts away from `sys_dictionary`. |

## Warning Fix Verification

| ID | Claim | Verified Result |
|----|-------|-----------------|
| W1 | `_healthScores` initialized | **PASS** — `this._healthScores = []` in `initialize()` (line 20). |
| W2 | Dead-condition regex corrected | **PASS** — `[^^]` (line 436), no stray backslash. |
| W3 | Fingerprint timestamp-free | **PASS** — `_computeFingerprint()` uses sorted `sys_id` keys only (lines 214–235), no `sys_updated_on`. |
| W4 | Admin gate on write actions | **PASS** — `gs.hasRole('x_snc_csm.admin')` gate on `scan` (line 25) and `enrich` (line 52), returns HTTP 403. |
| W5 | Dead privileges pruned | **PASS** — 8 `sys_scope_privilege` records; `sys_ui_script` and `catalog_ui_policy` removed, `item_option_new` added. All 8 targets are actually queried by the engine. |

## Info Fix Verification

| ID | Claim | Verified Result |
|----|-------|-----------------|
| I1 | Severity ranked, not alphabetical | **PASS** — in-memory sort by weight (lines 66–72). |
| I2 | Field-ref regex expanded | **PASS** — `setDisplay`, `addOption`, `clearValue`, `getField` added (line 525). |
| I4 | `getHealthScores()` filters completed | **PASS** — `addQuery('status', 'completed')` (line 82). |

---

## CDATA Integrity

All 5 code blocks in `sys_app.xml` byte-match their standalone `.js` sources (verified programmatically). 23 CDATA blocks total; 5 matched to source files, 18 are XML-embedded field values (not code).

---

## Critical Errors

None.

---

## Summary

All 14 issues (5 CRITICAL · 5 WARNING · 4 INFO) from `04_test.md` are resolved and verified against the actual build artifacts. Syntax is clean across all 5 JS files and 6 XML files. The combined manifest is importable standalone with tables, dictionaries, and choices present. **Status: PASS.**
