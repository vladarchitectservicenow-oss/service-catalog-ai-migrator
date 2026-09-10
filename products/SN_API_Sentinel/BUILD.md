# API Sentinel — Build Summary

**RUN_ID:** 20260910_050052_4141
**Product:** API Sentinel (`x_snc_api_sentinel`) — Inbound API Exposure Auditor
**Scope:** `x_snc_api_sentinel`
**Category:** Security / Inbound API Exposure Auditor
**License:** AGPL-3.0-only · Copyright (C) 2026 Vladimir Kapustin
**Author:** Vladimir Kapustin
**Release target:** Utah → Australia (scoped app, read-only)

---

## 1. Build Result

Production-ready scoped application built from `02_design.md`. Read-only inventory of every inbound API surface (Scripted REST, Table API, inbound web services, OAuth scopes), mapped to enforcement (ACLs, role guards), scored into Critical/High/Medium/Low risk bands, with PII/sensitive-field detection, scheduled delta reporting, and compliance export (Markdown/JSON/CSV). No placeholders.

## 2. Consolidation Decisions

The design specified **3 tables** (endpoint / scan / finding), which exceeds the enforced limit of **2 tables**. Consolidation applied:

| Design element | Before | After | Strategy |
|----------------|--------|-------|----------|
| Tables | 3 (`endpoint`, `scan`, `finding`) | 2 (`endpoint`, `scan`) | **JSON column absorption** — the `finding` table was absorbed into `endpoint`. Each endpoint record already carries `risk_score`, `risk_band`, `pii_fields` (JSON), and `tables_touched` (JSON), which fully captures the "flagged issue" semantics. A finding *is* an endpoint with an elevated risk score. |
| Script Includes | 2 (`ApiSentinelScanner`, `ApiSentinelScoreEngine`) | 2 | No consolidation needed — within limit. |
| REST endpoints | 2 (`POST /execute`, `GET /status`) | 2 | No consolidation needed — within limit. |

**Rationale for the finding→endpoint merge:** The design's `finding` table held `endpoint` (ref), `severity`, `category`, `description`, `remediation`, `ai_narrative`. All of these are derivable from the endpoint record itself: `severity` = `risk_band`, `category` = `endpoint_type`, `description`/`remediation`/`ai_narrative` are generated on demand by `ApiSentinelScoreEngine.generateNarrative()` / `_deterministicNarrative()`. Storing them as a separate table would duplicate the endpoint's identity with no new information. The risk-scored endpoint record *is* the finding.

## 3. Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Scoped app manifest | 1 | `sys_app.xml` (994 lines) — scope, 2 roles, 9 cross-scope privileges, 2 Script Includes (CDATA), 1 REST service + 2 operations (CDATA) |
| Custom tables | 2 | `x_snc_api_sentinel_endpoint`, `x_snc_api_sentinel_scan` |
| Script Includes | 2 | `ApiSentinelScanner` (inventory + enforcement + PII), `ApiSentinelScoreEngine` (scoring + delta + report + AI narrative) |
| REST endpoints | 2 | `POST /api/x_snc_api_sentinel/execute` (action dispatch), `GET /api/x_snc_api_sentinel/status` |
| Scheduled job | 1 | `API Sentinel Daily Scan` (daily, 05:00, delta report on change) |
| ACLs | 10 | 3 per table (read/write/create) × 2 tables + 2 REST endpoint execute ACLs (admin + viewer) |
| Roles | 2 | `x_snc_api_sentinel.admin`, `x_snc_api_sentinel.viewer` |

## 4. Feature Coverage Matrix

| # | Design feature | Status | Implementation |
|---|----------------|--------|----------------|
| 1 | Endpoint Inventory | ✅ Implemented | `ApiSentinelScanner.scan()` enumerates Scripted REST (`sys_ws_operation`), Table API (`sys_db_object`), inbound web services (`sys_web_service`), OAuth scopes (`oauth_entity` + `oauth_entity_profile`) |
| 2 | Enforcement Mapping | ✅ Implemented | `_resolveAuth()`, `_resolveTableAcls()`, `_detectRoleGuard()`, `_extractTables()` |
| 3 | Over-Permission Flagging | ✅ Implemented | `_exposureFactor()` (public=1.0), `_authWeaknessFactor()` (no guard=1.0), OAuth `admin`/`snc_platform` scope detection |
| 4 | PII / Sensitive-Field Detection | ✅ Implemented | `_detectPiiFields()` scans `sys_dictionary` against a 30-term sensitive dictionary |
| 5 | Risk Scoring Engine | ✅ Implemented | `scoreEndpoint()` = exposure × sensitivity × auth_weakness → 0–100 + Critical/High/Medium/Low band |
| 6 | Scheduled Scan + Delta Reporting | ✅ Implemented | `API Sentinel Daily Scan` scheduled job + `computeDelta()` (added/removed/changed) |
| 7 | Compliance Export | ✅ Implemented | `buildMarkdownReport()`, `buildJsonReport()`, `buildCsvReport()` via `POST /execute` with `action=report` |

**AI usage (assistive layer):** `ApiSentinelScoreEngine.generateNarrative()` dispatches to `sn_generative_ai.GenerativeAI` (BYOK) with a deterministic fallback. The determinism boundary is preserved — AI never *decides* exposure; it only explains/recommends on top of verified GlideRecord/ACL facts.

## 5. Quality Notes

- **Read-only by design** — the app writes only to its own scoped tables (`x_snc_api_sentinel_*`); all source-table access is read-only cross-scope.
- **Deterministic core + assistive AI** — risk scores are reproducible; AI narrative is layered on top with graceful fallback.
- **No credential storage** — the app reads OAuth scope *breadth* only, never tokens/secrets.
- **Security model** — `admin` (full) and `viewer` (read-only reports) roles; REST ACLs gate `execute` to admin and `status` to admin+viewer.
- **Cross-scope grants** — 8 read-only table grants + 1 `sn_generative_ai` scriptable grant (target_type=scriptable, per anti-pattern #179).
- **Guarded writes** — all 4 `insert()` call sites are inside try/catch blocks.
- **REST correctness** — `response.setBody(JSON.stringify(...))` everywhere (no raw objects); unknown action returns HTTP 400; errors return HTTP 500.
- **CDATA integrity** — `sys_app.xml` assembled programmatically from standalone `.js` sources; all 4 CDATA blocks verified byte-match (no drift).
- **XML well-formedness** — all 7 XML files parse cleanly.
- **Copyright** — all `.js` files carry `Copyright (C) 2026 Vladimir Kapustin` + `SPDX-License-Identifier: AGPL-3.0` headers.

## 6. File Tree

```
SN_API_Sentinel/
├── sys_app.xml                          # authoritative combined manifest (994 lines)
├── LICENSE                              # AGPL-3.0 (Copyright (C) 2026 Vladimir Kapustin)
├── tables/
│   ├── x_snc_api_sentinel_endpoint.xml  # endpoint table + 12 field definitions
│   └── x_snc_api_sentinel_scan.xml      # scan header table + 5 field definitions
├── scripts/
│   ├── ApiSentinelScanner.js            # inventory + enforcement + PII (standalone)
│   └── ApiSentinelScoreEngine.js        # scoring + delta + report + AI (standalone)
├── rest/
│   ├── execute.js                       # POST /execute action dispatch (standalone)
│   └── status.js                        # GET /status summary (standalone)
├── acl/
│   ├── endpoint_table_acls.xml          # read/write/create ACLs for endpoint table
│   ├── scan_table_acls.xml              # read/write/create ACLs for scan table
│   └── rest_endpoint_acls.xml           # execute ACLs for both REST endpoints
└── br/
    └── daily_scan_scheduled_job.xml     # daily scan scheduled job (CDATA script)
```

## 7. Dependencies

- **OOTB tables read (cross-scope, read-only):** `sys_ws_operation`, `sys_ws_definition`, `sys_web_service`, `sys_db_object`, `sys_security_acl`, `oauth_entity`, `oauth_entity_profile`, `sys_dictionary`, `sys_trigger`.
- **Optional plugin:** `sn_generative_ai` (Now Assist / GenAI Controller) — used for AI narrative only; graceful fallback when absent.
- **No external services, no outbound calls, no credential storage.**
