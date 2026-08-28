# WhereUsed Radar — Retest Report

**RUN_ID:** 20260828_050052_9652
**Stage:** 05_retest (QA Quick Validation Agent)
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_wur`

---

## Status: PASS

No critical errors remain. All 6 blocking defects (E1–E6) from the 04_test report are resolved and verified against the actual build artifacts.

---

## Verification Results

| Check | Result |
|-------|--------|
| JS syntax (`node --check`, 4 files) | ✅ PASS |
| XML well-formedness (5 files) | ✅ PASS |
| CDATA byte-match vs standalone `.js` (WurScanner, WurReport) | ✅ PASS |
| E1 — REST ACL `type=rest_service` | ✅ PASS |
| E1 — ACL `name` = operation name (`execute` / `status`) | ✅ PASS |
| E2 — `scan` field `internal_type=reference` + `reference=x_sn_wur_scan` | ✅ PASS |
| E3 — `sys_ws_definition` has `sys_id`; 2 operations carry `web_service_definition` back-ref | ✅ PASS |
| E4 — `x_sn_wur.scan_targets` `sys_properties` record present | ✅ PASS |
| E5 — `run_dayofweek=monday` (valid weekly value) | ✅ PASS |
| E6 — both tables `access=private`, `ws_access=false` | ✅ PASS |
| W8 — `sys_user_role_contains` (admin contains user) present | ✅ PASS |
| W9 — footer scope `x_sn_wur`; no `sn_where_used_radar` residue | ✅ PASS |

---

## Critical Errors

None.

---

## Notes

- 3 non-blocking warnings remain (W2, W4, W6/W7 per 05_fix deferral rationale): cosmetic dead-parameter, UI-policy `script_true` coverage gap, dead `detail_json` field, and `sys_hub_flow` field assumption. None prevent install or release.
- REST ACL `operation` field is `execute` on both records (correct for `rest_service` type); the `name` field correctly binds to the operation name.

---

## Recommendation

Proceed to release (06_push).
