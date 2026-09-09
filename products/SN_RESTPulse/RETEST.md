# RESTPulse — Re-Test Report

**RUN_ID:** 20260909_050110_9929
**Product:** RESTPulse (`x_snc_restpulse`) — Outbound REST Message & Integration Health Monitor
**Scope:** `x_snc_restpulse`
**Stage:** 05_retest — Quick Validation After Fixes
**Date:** 2026-09-09

---

## 1. Status

**STATUS: PASS**

No critical errors remain. All 11 findings (2 HIGH, 3 MEDIUM, 6 LOW) from `04_test.md` have been resolved and verified against the actual build artifacts.

## 2. Verification Performed

| Check | Result |
|-------|--------|
| JS syntax (`node --check`) — 4/4 files | ✅ PASS |
| XML well-formedness — 8/8 files | ✅ PASS |
| `.js` ↔ CDATA byte-match (engine, alert, get_status, post_execute) | ✅ PASS |
| Copyright headers (AGPL-3.0, "Vladimir Kapustin") | ✅ PASS |
| SPDX identifier on own line | ✅ PASS |

## 3. Fix Verification (11/11 confirmed in source)

| ID | Fix | Verified |
|----|-----|-----------|
| H1 | ACL `name` → full endpoint paths `/api/now/x_snc_restpulse/restpulse/{execute,status}` | ✅ `rest_endpoint_acls.xml` lines 9, 49 |
| H2 | `duration` → `response_time` in `computeTelemetry` | ✅ `RESTPulseEngine.js` line 245 |
| M1 | `password_expires_on` → `last_password_update` + `_daysSince()` | ✅ lines 340, 350, 437 |
| M2 | `evaluateCredentialRisk` reads `cfg` thresholds; `expiring_critical` flag | ✅ lines 294, 309–310, 332 |
| M3 | `base_uri` → `/api/now/x_snc_restpulse` | ✅ `rest_endpoints.xml` line 5 |
| L1 | `findUnusedCredentials(cfg)` implemented | ✅ lines 365–416 |
| L2 | `retry_count` removed from telemetry metrics | ✅ `computeTelemetry` metrics object |
| L3 | `msgName` removed from `_findInvocationSites` | ✅ line 149 (single param) |
| L4 | `relative_path` removed from `sys_ws_operation` | ✅ `rest_endpoints.xml` (kept on definition only) |
| L5 | 404 for missing `view=detail` record | ✅ `get_status.js` lines 30–34 |
| L6 | `gs.eventQueue` left as-is (valid API) | ✅ no change required |

## 4. Notes

- All 11 issues from the QA report (`04_test.md`) are resolved in the build artifacts.
- No CRITICAL errors remain. The two HIGH issues (H1 ACL path mismatch, H2 latency field name) are both fixed and verified in source.
- **Instance verification still pending** — `dev362840.service-now.com` was unreachable during the fix run. Field-name fixes (H2 `response_time`, M1 `last_password_update`) were applied against standard ServiceNow schema. Recommend a final live-instance spot-check before release, but this does not block the retest verdict.
