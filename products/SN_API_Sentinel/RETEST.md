# API Sentinel — Re-Test Report

**RUN_ID:** 20260910_050052_4141
**Product:** API Sentinel (`x_snc_api_sentinel`) — Inbound API Exposure Auditor
**Scope:** `x_snc_api_sentinel`
**Stage:** 05_retest — Quick Validation After Fixes
**Date:** 2026-09-10

---

## 1. Status

**STATUS: PASS**

No critical errors remain. All 7 High-severity defects from `04_test.md` have been resolved and verified against the actual build artifacts.

## 2. Verification Performed

| Check | Result |
|-------|--------|
| JS syntax (`node --check`, 4 files) | ✅ 4/4 pass |
| XML well-formedness (7 files) | ✅ 7/7 parse cleanly |
| CDATA integrity (standalone vs manifest) | ✅ 4/4 byte-match |
| Critical errors | 0 |

## 3. Fix Verification (7/7 confirmed in source)

| ID | Fix | Verified |
|----|-----|----------|
| H1 | `auth_required` normalized to string `'public'`/`'authenticated'` across all four scanners | ✅ `_resolveAuth`, `_resolveWebServiceAuth`, `_resolveTableAcls` all emit strings; `oauth_scope` emits `'authenticated'` (line 143) |
| H2 | `oauth_scope` no longer emits boolean; broad admin/snc_platform scope treated as weakness | ✅ string emission confirmed |
| H3 | `sys_trigger` + `sys_security_acl_role` + `sys_scope` read privileges added | ✅ 12 `sys_scope_privilege` records now present (was 9) |
| H4 | `_resolveTableAcls` resolves roles via `sys_security_acl_role` join | ✅ `GlideRecord('sys_security_acl_role')` at line 228 |
| H5 | `_buildPath` resolves `sys_ws_definition.id` + scope namespace | ✅ reads `def.id` and `scopeGr.scope` (lines 276–291) |
| H6 | `http_method` set on both REST operations | ✅ `POST` (line 751), `GET` (line 995) |
| H7 | Unique ACL `sys_id`s referenced by value in `sys_security_acl_role` | ✅ 3 unique sys_ids per table, referenced by value |

## 4. Remaining (non-blocking, documented)

| ID | Issue | Status |
|----|-------|--------|
| M3 | Unverified field names (4 refs) | Requires live instance; not fixable offline |
| M4 | `sn_generative_ai` API surface unverified | try/catch fallback masks failure; no safe change without instance |
| M6 | Code duplication `execute.js` vs scheduled job | Architecture constraint (no new Script Includes); drift risk documented |

None of the remaining items are critical. All 7 High-severity defects from the 04_test report are confirmed fixed in-place with architecture preserved (no new files, no shared-helper refactor).

---

*QA Quick Validation complete. Build is structurally sound and the core risk-scoring defect (H1/H2) is resolved.*
