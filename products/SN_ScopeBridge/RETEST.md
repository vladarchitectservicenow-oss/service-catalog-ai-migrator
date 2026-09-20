# ScopeBridge — Re-Test Report (05)

**RUN_ID:** 20260920_050101_9067
**Product:** ScopeBridge (`sn_scope_bridge`, scope `x_snb`)
**Stage:** 05 — Re-Test (Quick Validation after Fix)
**Role:** QA Quick Validation Agent
**Date:** 2026-09-20

---

## Status: PASS

No critical errors remain. All 5 blocking errors (E1–E5) are confirmed resolved in the built artifacts.

---

## Validation Checks

| # | Check | Result |
|---|-------|--------|
| 1 | JS syntax — `scripts/ScopeBridgeScanner.js` | PASS (`node --check`) |
| 2 | JS syntax — `scripts/ScopeBridgeGenerator.js` | PASS (`node --check`) |
| 3 | JS syntax — `rest/post_execute.js` | PASS (`node --check`) |
| 4 | JS syntax — `rest/get_status.js` | PASS (`node --check`) |
| 5 | XML well-formed — `sys_app.xml` | PASS |
| 6 | XML well-formed — `tables/x_snb_scan.xml` | PASS |
| 7 | XML well-formed — `tables/x_snb_reference.xml` | PASS |
| 8 | XML well-formed — `acl/acl_definitions.xml` | PASS |
| 9 | XML well-formed — `br/scheduled_job.xml` | PASS |

---

## Fix Verification (E1–E5)

| ID | Fix claimed | Verified in artifact |
|----|-------------|----------------------|
| E1 | REST execute ACL `name`/`sys_name` → `ScopeBridge`; role refs updated | ✅ `acl_definitions.xml` — `<name>ScopeBridge</name>`, `<sys_name>ScopeBridge</sys_name>`, `sys_security_acl display_value="ScopeBridge"` |
| E2 | `_coverageStatus` gains `source_scope`; `_finalizeScan` reads it and filters via `addQuery('source_scope', …)` | ✅ `ScopeBridgeScanner.js:329,373` — `sourceScope` read from reference, `gr.addQuery('source_scope', sourceScope)` |
| E3 | Serialized-length truncation (`_truncateAuditJson`) applied to `_appendAudit`/`_appendApplyAudit` | ✅ `ScopeBridgeScanner.js:535,558,570`; generator apply-audit path present |
| E4 | `run()` wrapped in try/catch; `_markFailed` transitions `running`→`failed`, stamps `finished_on`, appends `scan_failed` | ✅ `ScopeBridgeScanner.js:122-124` catch + `_markFailed` helper at line 547 |
| E5 | Apply path guarded by `gs.hasRole('x_snb.admin')` | ✅ `ScopeBridgeGenerator.js:93` |

---

## Critical Errors

None (0).
