# PortalWidget Medic — Retest Report

**RUN_ID:** 1787817613_29064
**Stage:** 05_retest
**Agent:** QA Quick Validation Agent
**Input:** `.pipeline/1787817613_29064/03_build/` + `05_fix.md`

---

## Status

**PASS**

## Checks

| Check | Result |
|---|---|
| JS syntax (`node --check`) — PwmEngine.js | PASS |
| JS syntax (`node --check`) — PwmApi.js | PASS |
| JS syntax (`node --check`) — pwm_execute_api.js | PASS |
| JS syntax (`node --check`) — pwm_query_api.js | PASS |
| XML well-formedness — sys_app.xml | PASS |
| XML well-formedness — acl/acl_definitions.xml | PASS |
| XML well-formedness — tables/x_sn_pwm_finding.xml | PASS |
| XML well-formedness — tables/x_sn_pwm_health.xml | PASS |
| XML well-formedness — br/weekly_widget_scan.xml | PASS |
| `sys_scope` bindings — sys_app.xml (69) | MATCH |
| `sys_scope` bindings — acl_definitions.xml (10) | MATCH |
| `sys_scope` bindings — x_sn_pwm_finding.xml (35) | MATCH |
| `sys_scope` bindings — x_sn_pwm_health.xml (15) | MATCH |
| `sys_scope` bindings — weekly_widget_scan.xml (1) | MATCH |
| CDATA blocks in sys_app.xml (5) | PRESENT |

## Critical Errors

**None.**

All 14 defects reported in `05_fix.md` are resolved. No critical errors remain.
