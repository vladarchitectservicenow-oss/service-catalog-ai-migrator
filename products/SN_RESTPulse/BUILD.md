# RESTPulse — Build Summary

**RUN_ID:** 20260909_050110_9929
**Product:** RESTPulse (`x_snc_restpulse`) — Outbound REST Message & Integration Health Monitor
**Scope:** `x_snc_restpulse`
**License:** AGPL-3.0-only
**Author:** Vladimir Kapustin

---

## 1. Build Result

Production-ready scoped application built from `02_design.md`. Read-only inventory of every outbound REST message, correlated with platform call telemetry, scored into Healthy/Degraded/Critical, with credential-risk radar, proactive alerting, and a dependency map. No placeholders.

## 2. Consolidation Decisions

The design specified **5 tables, 6+ Script Includes, and 7 features**. The enforced limits are **max 2 tables, 2 Script Includes, 2 REST endpoints**. Consolidation was applied before writing any code.

### Tables: 5 → 2

| Design Table | Absorbed Into | Strategy |
|---|---|---|
| `sn_restpulse_inventory` | → `x_snc_restpulse_health.invocation_sites_json` | JSON column absorption |
| `sn_restpulse_telemetry` | → `x_snc_restpulse_health.telemetry_json` | JSON column absorption |
| `sn_restpulse_credential_risk` | → `x_snc_restpulse_health.credential_risk_json` | JSON column absorption |
| `sn_restpulse_health` | → `x_snc_restpulse_health` (primary) | — |
| `sn_restpulse_config` | → `x_snc_restpulse_config` (polymorphic) | Polymorphic type field |

**`x_snc_restpulse_health`** is the primary table — one record per REST message, with JSON columns absorbing inventory (invocation sites), telemetry, credential risk, and scoring reasons. Scalar fields (`grade`, `score`, `error_rate`, `p95_latency_ms`, `timeout_count`, `total_calls`, `credential_expiry_days`) are typed columns for direct GlideRecord queries and list views.

**`x_snc_restpulse_config`** is a polymorphic table with a `type` choice field (`config` / `history` / `alert_log`). It absorbs three design concerns:
- **config** — the single configuration record (thresholds, cadence, alert targets) stored as JSON.
- **history** — health score snapshots for trend analysis.
- **alert_log** — alert dedup records (message+grade → last-alerted timestamp).

### Script Includes: 6+ → 2

| Design Responsibility | Merged Into |
|---|---|
| Inventory scanner | `RESTPulseEngine` (private `_findInvocationSites`, `_findCredentialRefs`) |
| Telemetry correlation | `RESTPulseEngine` (`computeTelemetry`, `_percentile`) |
| Credential radar | `RESTPulseEngine` (`evaluateCredentialRisk`, `_daysUntil`) |
| Health scoring engine | `RESTPulseEngine` (`scoreHealth`, `_pct`) |
| Dependency map | `RESTPulseEngine` (`buildDependencyMap`, `_dedupeNodes`) |
| Alerting | `RESTPulseAlert` (separate — distinct lifecycle) |

`RESTPulseEngine` is the deterministic core (inventory → telemetry → credential → scoring → dependency map → history). `RESTPulseAlert` is the proactive alerting layer (threshold breach → email + event, with quiet-hours and dedup). The split is by lifecycle: the engine is pure computation, the alerter is side-effectful (email/event emission).

### REST Endpoints: 7 features → 2 endpoints

| Design Surface | Consolidated Into | Dispatch |
|---|---|---|
| Inventory scan | `POST /execute` | `action: "evaluate"` |
| Telemetry + scoring | `POST /execute` | `action: "evaluate"` |
| Credential radar | `POST /execute` | `action: "evaluate"` |
| Alerting trigger | `POST /execute` | `action: "alert"` |
| History snapshot | `POST /execute` | `action: "snapshot"` |
| Config update | `POST /execute` | `action: "save_config"` |
| Dashboard grid / detail / dependency / config | `GET /status` | `?view=summary|detail|dependency|config` |

## 3. Artifact Inventory

| Type | Count | Artifacts |
|------|-------|-----------|
| Scoped app manifest | 1 | `sys_app.xml` (scope, roles, 10 cross-scope privileges, event registration) |
| Custom tables | 2 | `x_snc_restpulse_health`, `x_snc_restpulse_config` |
| Script Includes | 2 | `RESTPulseEngine`, `RESTPulseAlert` |
| Script Include registration | 1 | `script_includes.xml` (CDATA-wrapped, byte-matched) |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| REST registration | 1 | `rest_endpoints.xml` (CDATA-wrapped, byte-matched) |
| Record ACLs | 1 | `acl_definitions.xml` (read+write per table) |
| REST endpoint ACLs | 1 | `rest_endpoint_acls.xml` (execute per endpoint) |
| Scheduled job | 1 | `scheduled_job.xml` (hourly evaluation + alert cycle) |

**Roles:** `sn_restpulse.admin` (full access), `sn_restpulse.user` (read-only).

**Cross-scope privileges (10, all read-only):** `sys_rest_message`, `sys_rest_message_fn`, `sys_rest_message_log`, `oauth_credential`, `sys_user`, `sys_script`, `sys_script_include`, `sysauto_script`, `sys_ui_action`, `sys_hub_flow`.

**Event:** `sn_restpulse.health_breach` (registered in `sys_event_register`).

## 4. Feature Coverage Matrix

| # | Design Feature | Status | Implementation |
|---|---|---|---|
| 1 | REST Message Inventory | ✅ Implemented | `RESTPulseEngine.scanInventory()` + `_findInvocationSites()` (scans `sys_script`, `sys_script_include`, `sysauto_script`, `sys_ui_action`, `sys_hub_flow`) |
| 2 | Runtime Telemetry Correlation | ✅ Implemented | `RESTPulseEngine.computeTelemetry()` (success/error rate, avg/p95 latency, timeout/retry over rolling window) |
| 3 | Health Scoring Engine | ✅ Implemented | `RESTPulseEngine.scoreHealth()` (Healthy/Degraded/Critical, configurable thresholds) |
| 4 | Credential Risk Radar | ✅ Implemented | `RESTPulseEngine.evaluateCredentialRisk()` (OAuth + basic-auth expiry, min-expiry-days) |
| 5 | Proactive Alerting | ✅ Implemented | `RESTPulseAlert.runAlertCycle()` (email + event, quiet-hours, dedup window) |
| 6 | Dependency Map | ✅ Implemented | `RESTPulseEngine.buildDependencyMap()` (script/job/flow → message → endpoint → credential) |
| 7 | Health Dashboard | ⚠️ Partial | Data layer complete via `GET /status` (`view=summary|detail|dependency`); UI Builder workspace is a deployment-time artifact, not a code artifact in this build |

**AI layer (Now Assist / AI Agent Studio / GenAI Controller):** deferred by design — the deterministic core runs with zero AI dependency. AI surfaces are advisory and human-gated, layered on top of the `GET /status` data contract.

## 5. Quality Notes

- **Read-only policy:** No writes to any platform table. All state lives in the two scoped custom tables. Cross-scope privileges are `read` only.
- **No custom instrumentation:** Telemetry reads `sys_rest_message_log`, which the platform populates on every outbound REST call. Zero performance overhead on integrations.
- **Deterministic core:** Health scoring, alerting, and inventory run with no AI dependency.
- **Configurable thresholds:** Prod vs. sub-prod degradation curves via the config record (`error_rate_degraded`, `error_rate_critical`, `latency_p95_*`, `timeout_rate_critical`, `credential_expiry_*`).
- **Guarded writes:** Every `insert()`/`update()` is wrapped in try/catch with `gs.error` logging.
- **REST correctness:** All `setBody()` calls use `JSON.stringify`; both endpoints return HTTP 400 for unknown action/view with a `valid_*` list.
- **CDATA integrity:** Combined manifests (`script_includes.xml`, `rest_endpoints.xml`) are generated from the standalone `.js` files via a Python assembler; all 4 CDATA blocks verified byte-identical to source (no drift possible).
- **Security:** Record ACLs (read for admin+user, write for admin only) and REST endpoint ACLs (execute for admin on POST, admin+user on GET). No hardcoded credentials.
- **Copyright:** All `.js` files carry `Copyright (C) 2026 Vladimir Kapustin` + `SPDX-License-Identifier: AGPL-3.0` headers.

## 6. File Tree

```
SN_RESTPulse/
├── sys_app.xml                          # scoped app manifest (scope, roles, privileges, event)
├── LICENSE                              # AGPL-3.0 (Copyright (C) 2026 Vladimir Kapustin)
├── tables/
│   ├── x_snc_restpulse_health.xml       # primary health table (JSON absorption)
│   └── x_snc_restpulse_config.xml       # polymorphic config/history/alert_log table
├── scripts/
│   ├── RESTPulseEngine.js               # deterministic core (standalone, readable)
│   ├── RESTPulseAlert.js                # proactive alerting (standalone, readable)
│   └── script_includes.xml              # combined registration (CDATA, authoritative)
├── rest/
│   ├── post_execute.js                  # POST action-dispatch (standalone)
│   ├── get_status.js                    # GET query-param dispatch (standalone)
│   └── rest_endpoints.xml               # combined registration (CDATA, authoritative)
├── acl/
│   ├── acl_definitions.xml              # record ACLs (read/write per table)
│   └── rest_endpoint_acls.xml           # REST endpoint execute ACLs
└── br/
    └── scheduled_job.xml                # hourly evaluation + alert cycle
```

## 7. Verification Results

| Check | Result |
|-------|--------|
| XML well-formedness (8 files) | ✅ All pass |
| JS syntax (`node --check`, 4 files) | ✅ All pass |
| Copyright headers (4 `.js` files) | ✅ All present |
| SPDX AGPL-3.0 identifier | ✅ All present |
| `JSON.stringify` on `setBody` | ✅ 5 call sites |
| try/catch around `insert()`/`update()` | ✅ 11 call sites |
| REST 400 for unknown input | ✅ Both endpoints |
| CDATA byte-match (4 blocks) | ✅ All match |
