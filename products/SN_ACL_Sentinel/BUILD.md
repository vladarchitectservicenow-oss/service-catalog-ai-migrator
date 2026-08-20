# ACL Sentinel — Build Summary

**RUN_ID:** 20260820_050017_5850
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_acl_sentinel`

---

## 1. Consolidation Decisions

The design specified 7 Script Includes, 3 tables, and 4+ REST endpoints — all exceeding the enforced limits (max 2 SIs, 2 tables, 2 REST endpoints). Consolidated before writing any code.

### Script Includes (7 → 2)

| Design SI | Absorbed Into | Notes |
|-----------|---------------|-------|
| `AclSentinelScorer` | → `AclSentinelEngine._scoreTables()` | Least-privilege scoring is a private method |
| `AclSentinelOverPermissive` | → `AclSentinelEngine._detectOverPermissive()` | Detector 1 |
| `AclSentinelOrphan` | → `AclSentinelEngine._detectOrphans()` | Detector 2 |
| `AclSentinelConflict` | → `AclSentinelEngine._detectConflicts()` | Detector 3 |
| `AclSentinelDrift` | → `AclSentinelEngine.diffEnvironments()` | Public method (called by REST) |
| `AclSentinelCorrelator` | → `AclSentinelEngine._correlateAccessDenied()` | Detector 4 |
| `AclSentinelReport` | → `AclSentinelReport` (kept) | Reporting is a distinct responsibility |

**Result:** `AclSentinelEngine` (all 5 detectors + correlation + drift) and `AclSentinelReport` (Markdown/JSON/CSV + narratives).

### Tables (3 → 2)

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_sn_acl_sentinel_finding` | (kept) | Primary findings table |
| `x_sn_acl_sentinel_scan` | (kept) | Scan metadata + counts |
| `x_sn_acl_sentinel_score` | → `x_sn_acl_sentinel_scan.scores_json` | JSON column absorption |

Per-table least-privilege scores are stored as a JSON map in `scores_json` on the scan record — no separate score table needed.

### REST Endpoints (4+ → 2)

| Design Endpoint | Consolidated Into | Dispatch |
|----------------|-------------------|----------|
| Scan trigger | → `POST /execute` | `action: "scan"` |
| Drift diff | → `POST /execute` | `action: "drift"` |
| Report generation | → `POST /execute` | `action: "report"` |
| Remediation narrative | → `POST /execute` | `action: "narrative"` |
| Status / findings / scores | → `GET /status` | `?scan_id=`, `?latest=true`, `?format=` |

---

## 2. Artifact Inventory

| Type | Name | File |
|------|------|------|
| Scoped app manifest | `x_sn_acl_sentinel` | `sys_app.xml` (1,146 lines) |
| Script Include | `AclSentinelEngine` | `scripts/AclSentinelEngine.js` (20,230 bytes) |
| Script Include | `AclSentinelReport` | `scripts/AclSentinelReport.js` (9,179 bytes) |
| Table | `x_sn_acl_sentinel_finding` | `tables/x_sn_acl_sentinel_finding.xml` |
| Table | `x_sn_acl_sentinel_scan` | `tables/x_sn_acl_sentinel_scan.xml` |
| REST endpoint | `POST /execute` | `rest/post_execute.js` |
| REST endpoint | `GET /status` | `rest/get_status.js` |
| Scheduled job | ACL Sentinel Daily Scan | `br/scheduled_job.xml` |
| ACLs | 7 table ACLs + 1 REST ACL | `acl/acl_definitions.xml` |
| Role | `x_sn_acl_sentinel.admin` | in `sys_app.xml` |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Least-Privilege Scoring Engine | ✅ Implemented | `_scoreTables()` — 0–100 per table, penalties for wildcard roles, empty conditions, admin-only |
| 2. Over-Permissive Detector | ✅ Implemented | `_detectOverPermissive()` — wildcard role, empty condition, admin-only flags |
| 3. Orphan & Dead-Rule Detector | ✅ Implemented | `_detectOrphans()` — non-existent tables + shadowed rules |
| 4. Conflict Detector | ✅ Implemented | `_detectConflicts()` — contradictory role requirements on same table+operation |
| 5. Cross-Environment Drift Diff | ✅ Implemented | `diffEnvironments()` — added/removed/changed via fingerprint |
| 6. Access-Denied Correlation | ✅ Implemented | `_correlateAccessDenied()` — joins syslog against ACL set |
| 7. Remediation Workbench | ✅ Implemented | Findings table + `remediationNarrative()` + export-as-report (no auto-apply) |

**AI layer (Now Assist / GenAI Controller):** Deferred by design — the design explicitly states AI is "optional, not load-bearing." The deterministic core delivers 100% of detection value without any LLM dependency. Remediation narratives use deterministic templates (`AclSentinelReport.remediationNarrative()`), not GenAI calls. This keeps the product sellable to security teams wary of LLMs touching access control.

---

## 4. Quality Notes

- **Read-only policy:** The engine only reads `sys_security_acl*`, `sys_db_object`, and `syslog`. It writes only to its own scoped tables (`finding`, `scan`). No ACL is ever modified — remediation is human-in-the-loop by design.
- **Deterministic core:** All five detectors are pure GlideRecord logic. No LLM in the critical path; results are reproducible and auditable.
- **Guarded writes:** Every `insert()`/`update()` is wrapped in try/catch (`_createScan`, `_finalizeScan`, `_createFinding`).
- **Cross-scope access:** 5 read-only `sys_scope_privilege` records for `sys_security_acl`, `sys_security_acl_role`, `sys_security_acl_condition`, `sys_db_object`, `syslog`.
- **REST safety:** `POST /execute` returns HTTP 400 with valid-action list for unknown actions. `GET /status` is read-only.
- **ACL completeness:** read/write/create ACLs on both tables (role-gated to `x_sn_acl_sentinel.admin`), execute ACL on the REST endpoint.
- **Copyright:** All `.js` files carry the AGPL-3.0 header with full name "Vladimir Kapustin".
- **CDATA integrity:** `sys_app.xml` assembled programmatically from standalone sources; all 4 CDATA blocks byte-match their standalone files (verified).

---

## 5. File Tree

```
03_build/
├── sys_app.xml                          # Combined manifest (scope, role, SIs, REST, scheduled job, cross-scope)
├── tables/
│   ├── x_sn_acl_sentinel_finding.xml    # Findings table (category, severity, status, reason, suggestion, detail_json)
│   └── x_sn_acl_sentinel_scan.xml       # Scan table (type, source_env, status, counts, scores_json)
├── scripts/
│   ├── AclSentinelEngine.js             # 5 detectors + correlation + drift + scoring
│   └── AclSentinelReport.js             # Markdown/JSON/CSV reports + narratives
├── rest/
│   ├── post_execute.js                  # POST action-dispatch (scan/drift/report/narrative)
│   └── get_status.js                    # GET read-only status/reporting
├── acl/
│   └── acl_definitions.xml              # 7 table ACLs + 1 REST execute ACL
└── br/
    └── scheduled_job.xml                # Daily delta scan (02:00 GMT)
```

---

## 6. Verification

- ✅ All 4 `.js` files pass `node --check` (syntax valid)
- ✅ `sys_app.xml` is well-formed XML (parsed via `xml.dom.minidom`)
- ✅ All 4 CDATA blocks byte-match standalone sources (no drift)
- ✅ Copyright headers present on all `.js` files
- ✅ `JSON.stringify` on all `setBody` calls
- ✅ try/catch around all `insert()`/`update()` calls
- ✅ `POST /execute` has `default:` case returning 400
