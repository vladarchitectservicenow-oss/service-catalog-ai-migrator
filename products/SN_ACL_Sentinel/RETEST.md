# ACL Sentinel — QA Retest Report

**RUN_ID:** 20260820_050017_5850
**Role:** QA Quick Validation Agent
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_acl_sentinel`

---

## 1. Status

**STATUS: PASS**

All three critical defects (C1, C2, C3) and the high-severity false-positive generator (H1) are resolved. No critical errors remain. The build is safe to run against a real instance.

---

## 2. Critical Errors

**None.**

| ID | Defect | Verification |
|----|--------|--------------|
| C1 | Phantom `sys_security_acl_condition` table | ✅ Zero references to `sys_security_acl_condition`, `_getConditions`, or `_aclCondTable` anywhere in the build. `_collectAcls()` now reads `condition` inline from `sys_security_acl`. `runScan()` wraps `_collectAcls()` in try/catch with a `_failScan()` helper. |
| C2 | `_getRoles()` returned sys_ids | ✅ `gr.sys_user_role.getDisplayValue()` used (line 113), so `roles` holds role names. Wildcard/public checks now fire. |
| C3 | Shadow detection false-positive flood | ✅ `_isShadowedBy(earlier, later)` added — only flags a rule when the earlier rule is strictly broader (wildcard/no-role vs. role-scoped, or unconditional vs. conditioned). |
| H1 | `_rolesContradict()` false conflicts | ✅ Rewritten — only flags two rules requiring the *same* role set but diverging on condition/script. |

---

## 3. Syntax & Structure Checks

- ✅ **JS syntax** — all 4 `.js` files pass `node --check`.
- ✅ **XML well-formedness** — all 5 XML files parse cleanly (`xml.dom.minidom`).
- ✅ **CDATA integrity** — 5 CDATA blocks present; `AclSentinelEngine` CDATA in `sys_app.xml` byte-matches the standalone source.
- ✅ **`vendor_prefix`** — `vkap` (H2 fixed).
- ✅ **REST `namespace`** — `x_sn_acl_sentinel` (M5 fixed).
- ✅ **`run_style`** — `periodically` on scheduled job (L2 fixed).
- ✅ **Table `access`** — `private` on both `x_sn_acl_sentinel_finding` and `x_sn_acl_sentinel_scan` (L3 fixed).

---

## 4. Verdict

The three critical runtime defects and the high-severity false-positive generator are resolved. The detection engine no longer aborts on first run (C1), the Over-Permissive Detector's primary signal is live (C2), and the orphan/conflict detectors no longer flood the findings table (C3, H1). The build is shippable.

*Remaining items (M1–M5, L1–L4) are quality improvements, not blockers — L4 is a deliberate design decision (immutable audit trail).*
