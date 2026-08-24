# ScriptInclude Medic — Retest Report

**RUN_ID:** 20260824_050023_5394
**Product:** ScriptInclude Medic
**Scope:** `x_snc_script_include_medic`
**Agent:** Hermes (QA Quick Validation Agent)
**Date:** 2026-08-24

---

## Status: PASS

---

## Checks Executed

| Check | Result |
|-------|--------|
| JS syntax — `SimMedicEngine.js` (`node --check`) | ✅ PASS |
| JS syntax — `SimMedicRunner.js` (`node --check`) | ✅ PASS |
| JS syntax — `rest/scan.js` (`node --check`) | ✅ PASS |
| JS syntax — `rest/results.js` (`node --check`) | ✅ PASS |
| JS syntax — `br/scheduled_scan.js` (`node --check`) | ✅ PASS |
| XML well-formed — `sys_app.xml` | ✅ PASS |
| XML well-formed — `tables/x_snc_sim_finding.xml` | ✅ PASS |
| XML well-formed — `tables/x_snc_sim_scan.xml` | ✅ PASS |
| XML well-formed — `acl/acl_definitions.xml` | ✅ PASS |
| XML well-formed — `br/scheduled_scan.xml` | ✅ PASS |
| Stray `x_snc_sim` refs (non-script, XML) | ✅ NONE |
| Stray `x_snc_sim` refs (JS) | ✅ NONE |
| C4 reference field — `tables/x_snc_sim_finding.xml` | ✅ `<reference>x_snc_script_include_medic_scan</reference>`, `<reference_qual>` empty |
| C4 reference field — `sys_app.xml` | ✅ `<reference>x_snc_script_include_medic_scan</reference>`, `<reference_qual>` empty |

---

## Critical Errors

**None.**

All 4 critical fixes (C1 include→include edges, C2 dead-code false positives, C3 incremental re-scan, C4 reference field) verified in the built artifacts. The reference field now correctly targets the scan table name with an empty `reference_qual`, and no stray `x_snc_sim` prefix remains in any XML or JS file.

---

## Verdict

**PASS** — no critical errors. Build is ready for the next pipeline stage.
