# DemoForge — QA Retest Report

**RUN_ID:** 20260823_050056_3672
**Product:** DemoForge (`x_demo_forge`) — Realistic Demo & Test Data Generator
**Phase:** 05_retest
**Date:** 2026-08-23
**Status:** PASS

---

## Summary

Quick validation after fixes. All 16 issues from `04_test.md` (1 CRITICAL, 5 HIGH, 6 MEDIUM, 4 LOW) were addressed in `05_fix.md`. Re-verified the CRITICAL and HIGH fixes directly against the build artifacts.

---

## Critical Errors

**None.**

The single CRITICAL issue (C1) is resolved and verified:

- **C1 — `u_demo_forge_run` tag field undefined on OOTB tables** → FIXED.
  - `sys_app.xml` now ships 8 `sys_dictionary` entries (`INSERT_OR_UPDATE`) defining `u_demo_forge_run` (string, max_length 32) on: `incident`, `sys_user`, `sys_user_group`, `cmn_location`, `cmdb_ci_server`, `cmdb_ci_computer`, `cmdb_ci_netgear`, `kb_knowledge` (lines 1107–1186).
  - Matches the 8 OOTB write targets used by the engine's `TAG_FIELD` tagging/querying.

---

## Verification Results

| Check | Result |
|-------|--------|
| JS syntax (`node --check`, 5/5 files) | ✅ PASS |
| XML well-formed (`sys_app.xml`, `acl_definitions.xml`, both table XMLs, BR XML) | ✅ PASS |
| C1 — 8 `u_demo_forge_run` dictionary entries present | ✅ PASS (8/8) |
| H1 — `ensureScenarios()` + `_SCENARIOS` registry wired into `loadScenario`/`listScenarios` | ✅ PASS |
| H2 — `_getOrCreate*` reference resolvers return sys_ids (location/department/company/model) | ✅ PASS |
| H3 — weekend check corrected to `day === 1 || day === 7` (Java Calendar convention) | ✅ PASS |
| H4 — `create` + `delete` ACLs added for both tables; `create_access`/`delete_access` = true | ✅ PASS |
| H5 — REST ACL names `Execute`/`Status` match `sys_ws_operation` names | ✅ PASS |
| M3 — `get_status.js` calls public `engine.preview()` (no private `_dryRun` access) | ✅ PASS |
| M4 — `addQuery('active', 'true')` string form | ✅ PASS |
| M6 — `_upsert()` implemented and applied to users/groups/locations/CIs/knowledge | ✅ PASS |
| M1 — `_throttle()` (gs.sleep per batch) wired into `_safeInsert`/`_upsert` | ✅ PASS |
| M2 — `completeRun()` writes `seed_log` | ✅ PASS |
| M5 — `getCountry()` maps US state codes → `US`, international preserved | ✅ PASS |
| L1 — `_stats.updated` incremented in `_upsert()` | ✅ PASS |
| L2 — `setSeed()` + `initialize(seed)`; `post_execute.js` passes `body.seed` | ✅ PASS |
| L3 — `ensureScenarios()` sets `order`; `listScenarios()` orders by it | ✅ PASS |
| L4 — `_dryRun()` splits `cmdb_ci` into 3 subclasses | ✅ PASS |

---

## Verdict

**PASS** — no critical errors remain. The CRITICAL (C1) and all 5 HIGH issues are fixed and verified against the actual build artifacts. Syntax and XML well-formedness are clean. The build is ready to proceed to the next phase.
