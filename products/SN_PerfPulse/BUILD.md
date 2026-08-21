# PerfPulse — Build Summary

**RUN_ID:** 20260821_050118_b00312ae
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_perf_pulse`

---

## 1. Consolidation Decisions

The design specified 7 Script Includes, 3 tables, and 4+ REST endpoints — all exceeding the enforced limits (max 2 SIs, 2 tables, 2 REST endpoints). Consolidated before writing any code.

### Script Includes (7 → 2)

| Design SI | Absorbed Into | Notes |
|-----------|---------------|-------|
| `PerfPulseBusinessRuleScanner` | → `PerfPulseEngine._detectBusinessRules()` | Detector 1 |
| `PerfPulseSlowQueryDetector` | → `PerfPulseEngine._detectSlowQueries()` | Detector 2 |
| `PerfPulseNPlusOneDetector` | → `PerfPulseEngine._detectNPlusOne()` | Detector 3 |
| `PerfPulseClientScriptScanner` | → `PerfPulseEngine._detectClientScripts()` | Detector 4 |
| `PerfPulseAclCostScorer` | → `PerfPulseEngine._scoreAclCost()` | Detector 5 |
| `PerfPulseTransactionCorrelator` | → `PerfPulseEngine._correlateTransactions()` | Detector 6 |
| `PerfPulseReport` | → `PerfPulseReport` (kept) | Reporting is a distinct responsibility |

**Result:** `PerfPulseEngine` (all 6 detectors + component scoring) and `PerfPulseReport` (Markdown/JSON/CSV + narratives).

### Tables (3 → 2)

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_sn_perf_pulse_finding` | (kept) | Primary findings table |
| `x_sn_perf_pulse_scan` | (kept) | Scan metadata + counts |
| `x_sn_perf_pulse_score` | → `x_sn_perf_pulse_scan.scores_json` | JSON column absorption |

Per-component performance scores are stored as a JSON map in `scores_json` on the scan record — no separate score table needed.

### REST Endpoints (4+ → 2)

| Design Endpoint | Consolidated Into | Dispatch |
|----------------|-------------------|----------|
| Scan trigger | → `POST /execute` | `action: "scan"` |
| Report generation | → `POST /execute` | `action: "report"` |
| Remediation narrative | → `POST /execute` | `action: "narrative"` |
| Status / findings / scores | → `GET /status` | `?scan_id=`, `?latest=true`, `?format=` |

---

## 2. Artifact Inventory

| Type | Name | File |
|------|------|------|
| Scoped app manifest | `x_sn_perf_pulse` | `sys_app.xml` (49,131 bytes) |
| Script Include | `PerfPulseEngine` | `scripts/PerfPulseEngine.js` (24,778 bytes) |
| Script Include | `PerfPulseReport` | `scripts/PerfPulseReport.js` (10,157 bytes) |
| Table | `x_sn_perf_pulse_finding` | `tables/x_sn_perf_pulse_finding.xml` |
| Table | `x_sn_perf_pulse_scan` | `tables/x_sn_perf_pulse_scan.xml` |
| REST endpoint | `POST /execute` | `rest/post_execute.js` |
| REST endpoint | `GET /status` | `rest/get_status.js` |
| Scheduled job | PerfPulse Daily Scan | `br/scheduled_job.xml` |
| ACLs | 6 table ACLs + 1 REST ACL | `acl/acl_definitions.xml` |
| Role | `x_sn_perf_pulse.admin` | in `sys_app.xml` |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Business-Rule Performance Scanner | ✅ Implemented | `_detectBusinessRules()` — full-table scan, missing setLimit, dot-walked query, getRowCount |
| 2. Slow-Query Detector | ✅ Implemented | `_detectSlowQueries()` — unindexed reference fields, leading-wildcard LIKE |
| 3. N+1 Pattern Detector | ✅ Implemented | `_detectNPlusOne()` — GlideRecord-in-loop static analysis |
| 4. Client-Script Performance Scanner | ✅ Implemented | `_detectClientScripts()` — heavy onLoad, sync GlideAjax, DOM-in-loop, getReference |
| 5. ACL Evaluation Cost Scorer | ✅ Implemented | `_scoreAclCost()` — ACL count + scripted-condition density per table |
| 6. Transaction-Log Hotspot Aggregator | ✅ Implemented | `_correlateTransactions()` — joins syslog_transaction slow entries against component inventory |
| 7. Remediation Workbench | ✅ Implemented | Findings table + `remediationNarrative()` + export-as-report (no auto-apply) |

**AI layer (Now Assist / GenAI Controller):** Deferred by design — the design explicitly states AI is "optional, not load-bearing." The deterministic core delivers 100% of detection value without any LLM dependency. Remediation narratives use deterministic templates (`PerfPulseReport.remediationNarrative()`), not GenAI calls. This keeps the product sellable to performance teams wary of LLMs touching production code.

---

## 4. Quality Notes

- **Read-only policy:** The engine only reads `sys_script`, `sys_script_client`, `sys_script_include`, `sys_security_acl*`, `sys_dictionary`, `sys_db_object`, and `syslog_transaction`. It writes only to its own scoped tables (`finding`, `scan`). No production component is ever modified — remediation is human-in-the-loop by design.
- **Deterministic core:** All six detectors are pure GlideRecord / regex static-analysis logic. No LLM in the critical path; results are reproducible and auditable.
- **Guarded writes:** Every `insert()`/`update()` is wrapped in try/catch (`_createScan`, `_failScan`, `_finalizeScan`, `_createFinding`).
- **Cross-scope access:** 8 read-only `sys_scope_privilege` records for `sys_script`, `sys_script_client`, `sys_script_include`, `sys_security_acl`, `sys_security_acl_role`, `sys_dictionary`, `sys_db_object`, `syslog_transaction`.
- **REST safety:** `POST /execute` returns HTTP 400 with valid-action list for unknown actions. `GET /status` is read-only.
- **ACL completeness:** read/write/create ACLs on both tables (role-gated to `x_sn_perf_pulse.admin`), execute ACL on the REST endpoint.
- **Copyright:** All `.js` files carry the AGPL-3.0 header with full name "Vladimir Kapustin".
- **CDATA integrity:** `sys_app.xml` assembled programmatically from standalone sources; all 5 CDATA blocks byte-match their standalone files (verified).

---

## 5. File Tree

```
03_build/
├── sys_app.xml                          # Combined manifest (scope, role, SIs, REST, scheduled job, cross-scope)
├── tables/
│   ├── x_sn_perf_pulse_finding.xml      # Findings table (category, component, severity, status, reason, suggestion, detail_json)
│   └── x_sn_perf_pulse_scan.xml         # Scan table (type, source_env, status, 6 counts, scores_json)
├── scripts/
│   ├── PerfPulseEngine.js               # 6 detectors + component scoring
│   └── PerfPulseReport.js               # Markdown/JSON/CSV reports + narratives
├── rest/
│   ├── post_execute.js                  # POST action-dispatch (scan/report/narrative)
│   └── get_status.js                    # GET read-only status/reporting
├── acl/
│   └── acl_definitions.xml              # 6 table ACLs + 1 REST execute ACL
└── br/
    └── scheduled_job.xml                # Daily delta scan (02:00 GMT)
```

---

## 6. Verification

- ✅ All 4 `.js` files pass `node --check` (syntax valid)
- ✅ `sys_app.xml` is well-formed XML (parsed via `xml.dom.minidom`)
- ✅ All 5 CDATA blocks byte-match standalone sources (no drift)
- ✅ Both table XML files well-formed
- ✅ `acl_definitions.xml` well-formed
- ✅ `scheduled_job.xml` well-formed
- ✅ Copyright headers present on all `.js` files
- ✅ `JSON.stringify` on all `setBody` calls
- ✅ try/catch around all `insert()`/`update()` calls
- ✅ `POST /execute` has `default:` case returning 400
