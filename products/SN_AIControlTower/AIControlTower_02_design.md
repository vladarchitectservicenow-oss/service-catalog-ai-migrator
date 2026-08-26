# AIControlTower — Design Document

**RUN_ID:** 20260818_201600_ai_tower
**Date:** 2026-08-18
**Phase:** 02 — Design
**Author:** Vladimir Kapustin (vladarchitect)
**License:** AGPL-3.0
**Scope prefix:** `x_snc_ai_tower`

---

## 1. Name & Pitch

**Product name:** AIControlTower

*Centralized AI observability and governance for enterprises running ServiceNow AI across multiple instances.*

Enterprises adopting ServiceNow AI products — Now Assist, Build Agent, AI Agent Studio, Agentic AI — end up with AI scattered across production, development, and regional instances with no unified visibility. Each instance has its own siloed usage logs, no cross-instance comparison, and no governance layer that flags adoption gaps, failure spikes, or cost anomalies before they become executive problems. AIControlTower solves this by deploying a lightweight telemetry collector on each instance that streams AI usage, execution, and outcome data to a central reporting hub — one dashboard for the entire AI estate.

**Why now:** The Australia release (May 2026) added AI Agent Studio, expanded Now Assist capabilities, and introduced Build Agent — enterprises are rapidly deploying AI across multiple instances but have no cross-instance observability. First-mover window is open.

---

## 2. Persona

### Primary — Platform Owner / SN Administrator
- **Role:** Senior ServiceNow administrator managing 2-20+ instances
- **Org size:** 5,000-50,000+ employees, enterprise
- **Daily workflow:** Monitor instance health, manage upgrades, support AI rollouts
- **Pain:** "I have Now Assist on 4 instances, Build Agent on 2, and AI Agent Studio on 1. I cannot tell which instance is performing well, which users are adopting, or where failures cluster. I'm assembling reports manually in Excel every month."
- **Fear:** Executive asks "what's our AI ROI?" and the answer is a shrug
- **Goal:** One dashboard showing all AI products across all instances with drill-down

### Secondary — AI Governance Officer / CIO
- **Role:** Executive responsible for AI strategy and compliance
- **Org size:** Enterprise (same org as primary)
- **Pain:** "We're spending $200K+/year on ServiceNow AI. I have no visibility into adoption rates, failure trends, or whether specific departments are actually using what we bought."
- **Fear:** Regulatory audit asks "who used AI, on what data, with what outcomes?" and there's no answer
- **Goal:** Governance dashboard with audit trail, adoption metrics, and cost tracking

### Tertiary — ServiceNow Consultant / Implementation Partner
- **Role:** External consultant managing multiple client instances
- **Org size:** Consulting firm, 10-100 clients
- **Pain:** "Each client has different AI configurations. I need to benchmark across clients to show value and identify problems proactively."
- **Fear:** Client churn because AI adoption stalls and the consultant didn't catch it
- **Goal:** Multi-tenant view across client instances with benchmarking

---

## 3. Features (7 Core)

### F1 — Multi-Instance Telemetry Collector
- Lightweight scoped app (`AIControlTower Collector`) deployed on each monitored instance
- Scheduled job runs every 15-60 minutes (configurable) to collect AI usage data from local tables
- Reads from Now Assist logs (`sn_now_assist_*`), AI Agent execution tables (`sys_ai_agent_*`), Build Agent task records, and user/department data
- Transforms local data into normalized JSON payloads
- POSTs payloads to central hub via REST API with instance authentication token
- Supports incremental sync (last-run timestamp) to avoid duplicate data transfer
- Handles network failures with retry queue (stores pending payloads in local staging table)
- Cross-scope privileges configured for all AI-related OOTB tables

### F2 — Unified AI Dashboard (Control Tower View)
- Custom UI Builder workspace: "AIControlTower Workspace"
- Top-level summary cards: Total AI interactions, Active AI users, Success rate, Active instances, AI spend estimate, Failed executions
- Multi-instance comparison table: Product × Instance matrix with requests, success rate, trend arrows
- Time-range selector (24h / 7d / 30d / 90d / custom)
- Instance filter (select subset of instances to compare)
- Product filter (Now Assist / Build Agent / AI Agent / All)
- Real-time refresh via REST API polling (configurable interval)
- Export to PDF / CSV for executive reporting

### F3 — Product Drill-Down Analytics
- Click any product in the dashboard to drill into capability-level analytics
- **Now Assist drill-down:** feature usage (Catalog Item Generation, Flow Generation, Code Generation, etc.), users, departments, requests/day, adoption %, success/failure, feedback ratings, latency, top users, top use cases
- **Build Agent drill-down:** tasks started, task types, success rate, failed executions, average execution time, iterations/steps per task, human intervention rate, agents/tools used
- **AI Agent Studio drill-down:** agent executions, triggers (scheduled vs event), tools invoked, step-by-step trace, success/failure by agent, latency distribution
- Each drill-down includes trend charts (PA integration) and anomaly markers
- Department-level breakdown for adoption analysis
- User-level leaderboard (top consumers of AI capabilities)

### F4 — AI Governance Alerts
- Automated detection of AI health problems across the estate
- Alert types:
  - **Success rate drop:** product success rate falls >10% below 30-day rolling average on any instance
  - **Adoption gap:** department or instance AI adoption below configurable threshold (default 15%)
  - **Failure spike:** failure count exceeds 2× rolling average
  - **Concentration risk:** <5% of users generate >65% of AI usage (over-reliance on power users)
  - **Instance anomaly:** one instance has 3× higher failure rate than estate median
  - **Stale data:** instance hasn't synced telemetry in >24 hours
- Alerts written to `x_snc_ai_tower_alert` table with severity (critical/warning/info)
- Optional email notification to platform owner via outbound email
- Alert dashboard in workspace with acknowledge/resolve workflow
- AI-powered alert summary: GenAI Controller generates plain-language description of the problem and suggested action

### F5 — Extensible AI Data Model
- Normalized internal model, not bound to specific ServiceNow table schemas:
  - **Product** (Now Assist, Build Agent, AI Agent, future products)
  - **Capability** (Catalog Item Generation, Flow Generation, Code Gen, etc.)
  - **Interaction** (user × product × capability × timestamp)
  - **Execution** (prompt → agent → tool → action → result → duration)
  - **Outcome** (SUCCESS / FAILURE / PARTIAL / TIMEOUT)
- New AI products added by registering a new data connector — no schema changes
- Connector registry: `x_snc_ai_tower_connector` table maps product name to source tables and field mappings
- JSON metadata columns on usage/execution tables store product-specific attributes without schema changes
- Versioned connector definitions for forward compatibility

### F6 — ROI Estimation Engine
- Maps AI interactions to estimated time saved per interaction type
- Configurable time-savings matrix: e.g., Now Assist Catalog Item Generation = 45 min saved, Build Agent task = 120 min saved, AI Agent workflow = 30 min saved
- Calculates: total hours saved, estimated labor cost saved (hourly rate configurable per instance/region), annualized benefit projection
- ROI dashboard: interactions → hours saved → cost saved → annualized benefit
- Benchmark comparison: "Your estate saves $X/year vs industry average $Y/year"
- Export ROI report for executive presentations
- Phase 2 feature — not in MVP

### F7 — Agent Execution Trace Viewer
- Visualizes step-by-step execution of AI Agent Studio and Build Agent runs
- Shows: prompt input → agent selection → tool invocations → intermediate results → final output → human intervention points
- Timeline view with duration per step
- Failure point highlighting (which step failed and why)
- Replay capability: view historical executions for debugging
- Comparison mode: compare successful vs failed executions side-by-side
- Filter by agent name, tool, outcome, duration range
- Critical for debugging AI agent failures across instances

---

## 4. AI Usage (AI Agent Studio / GenAI Controller / Now Assist)

| Component | AI Capability | Usage |
|---|---|---|
| Governance Alert Summaries | GenAI Controller (BYOK) | When alert is triggered, GenAI Controller generates plain-language alert description + recommended remediation action. Input: alert type, metrics, instance context. Output: 2-3 sentence summary for alert dashboard. Optional — degrades to template text without BYOK. |
| Anomaly Detection | AI Agent Studio — Scheduled Agent | Custom agent "TowerSentinel" runs nightly, reads 30-day metrics from `x_snc_ai_tower_metric`, compares rolling averages, writes detected anomalies to `x_snc_ai_tower_alert`. Uses GenAI Controller for natural-language pattern analysis of metric trends. |
| Natural Language Query | Now Assist for ITSM | Executives can ask "show me AI adoption in HR department across all instances" via Now Assist chat — TowerQuery Script Include translates NL to encoded query on `x_snc_ai_tower_usage`. Optional — requires Now Assist license on hub instance. |
| Execution Trace Analysis | GenAI Controller (BYOK) | When user opens a failed execution trace, GenAI Controller analyzes the step sequence and suggests root cause. Input: execution steps JSON. Output: "Likely failure at step 3 — tool returned timeout because...". Optional — degrades to raw step display without BYOK. |
| ROI Report Generation | GenAI Controller (BYOK) | Generates executive-ready ROI narrative from metrics data. Input: aggregated usage + time-savings config. Output: 1-page summary with key numbers and trend analysis. Optional — degrades to tabular export without BYOK. |

**All AI features are optional.** The product functions fully as a telemetry + dashboard + governance platform without any AI license. GenAI Controller and AI Agent Studio features enhance alert quality and analysis but are not required for core operation.

---

## 5. Why Not Built-In

### What ServiceNow OOTB provides:
- **Now Assist Analytics:** Per-instance dashboards showing Now Assist usage counts, success rates, and user adoption within a single instance
- **PA (Performance Analytics):** General-purpose analytics framework that can be configured for AI metrics on a single instance
- **AI Agent Studio logs:** Execution logs for AI agents on the instance where they run
- **Build Agent reporting:** Task-level reporting within the instance running Build Agent
- **Workspace Builder:** UI framework for building custom dashboards (but not cross-instance)
- **Instance Analytics:** Basic instance health metrics per instance

### What ServiceNow OOTB does NOT provide:
- **No multi-instance aggregation** — there is no OOTB mechanism to combine AI usage data from multiple instances into a single view. Each instance is a silo.
- **No unified AI estate dashboard** — Now Assist, Build Agent, and AI Agent Studio each have their own reporting. No single view shows all AI products together.
- **No cross-instance comparison** — cannot benchmark instance A vs instance B for AI performance or adoption.
- **No governance alerting** — no OOTB mechanism to detect "success rate dropped on instance X" or "adoption is low in department Y" across the estate.
- **No ROI estimation** — no built-in model for converting AI interactions to hours/dollars saved.
- **No extensible AI data model** — reporting is tightly coupled to each product's specific tables. When a new AI product launches, there's no ready framework to add it to existing dashboards.
- **No agent execution trace comparison** — cannot compare execution traces across instances or between successful/failed runs.
- **No consultant/partner multi-tenant view** — partners managing multiple client instances have no unified view.

**The gap is clear:** ServiceNow built AI products and per-instance reporting, but not AI observability and governance across the enterprise AI estate. AIControlTower fills exactly this gap.

---

## 6. Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENTERPRISE AI ESTATE                                  │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  Instance US      │  │  Instance EU      │  │  Instance APAC    │          │
│  │  (PROD-US)        │  │  (PROD-EU)        │  │  (PROD-APAC)      │          │
│  │                   │  │                   │  │                   │          │
│  │ ┌───────────────┐│  │ ┌───────────────┐│  │ ┌───────────────┐│          │
│  │ │ NOW ASSIST    ││  │ │ NOW ASSIST    ││  │ │ BUILD AGENT   ││          │
│  │ │ BUILD AGENT   ││  │ │ AI AGENT STUDIO││ │ │ AI AGENT STUDIO││         │
│  │ │ AI AGENT      ││  │ │               ││  │ │               ││          │
│  │ └───────┬───────┘│  │ └───────┬───────┘│  │ └───────┬───────┘│          │
│  │         │        │  │         │        │  │         │        │          │
│  │ ┌───────▼───────┐│  │ ┌───────▼───────┐│  │ ┌───────▼───────┐│          │
│  │ │  COLLECTOR    ││  │ │  COLLECTOR    ││  │ │  COLLECTOR    ││          │
│  │ │  (scoped app) ││  │ │  (scoped app) ││  │ │  (scoped app) ││          │
│  │ │               ││  │ │               ││  │ │               ││          │
│  │ │ • Scheduled   ││  │ │ • Scheduled   ││  │ │ • Scheduled   ││          │
│  │ │   job (15m)   ││  │ │   job (15m)   ││  │ │   job (15m)   ││          │
│  │ │ • Read AI     ││  │ │ • Read AI     ││  │ │ • Read AI     ││          │
│  │ │   tables      ││  │ │   tables      ││  │ │   tables      ││          │
│  │ │ • Normalize   ││  │ │ • Normalize   ││  │ │ • Normalize   ││          │
│  │ │ • POST to hub ││  │ │ • POST to hub ││  │ │ • POST to hub ││          │
│  │ │ • Retry queue ││  │ │ • Retry queue ││  │ │ • Retry queue ││          │
│  │ └───────┬───────┘│  │ └───────┬───────┘│  │ └───────┬───────┘│          │
│  └─────────┼────────┘  └─────────┼────────┘  └─────────┼────────┘          │
│            │                     │                     │                    │
│            │   REST API (HTTPS)  │                     │                    │
│            │   POST /api/x_snc_  │                     │                    │
│            │   ai_tower/v1/ingest│                     │                    │
│            │                     │                     │                    │
│  ──────────┼─────────────────────┼─────────────────────┼──────────────────  │
│            │                     │                     │                    │
│            ▼                     ▼                     ▼                    │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │              CENTRAL HUB INSTANCE                                │       │
│  │              (AIControlTower Hub — scoped app)                   │       │
│  │                                                                 │       │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐       │       │
│  │  │ REST ENDPOINT│  │  INGESTION   │  │  AI LAYER         │       │       │
│  │  │              │  │  ENGINE      │  │                   │       │       │
│  │  │ POST /ingest │─▶│              │  │ • GenAI Controller│       │       │
│  │  │ GET  /status │  │ • Validate   │  │   (alert summary) │       │       │
│  │  │ POST /config │  │ • Dedupe     │  │ • AI Agent Studio │       │       │
│  │  │              │  │ • Transform  │  │   (TowerSentinel) │       │       │
│  │  └─────────────┘  │ • Store      │  │ • Now Assist      │       │       │
│  │                   └──────┬───────┘  │   (NL query)      │       │       │
│  │                          │          └──────────────────┘       │       │
│  │                          ▼                                      │       │
│  │  ┌──────────────────────────────────────────────────────┐     │       │
│  │  │                    DATA LAYER                          │     │       │
│  │  │                                                        │     │       │
│  │  │  x_snc_ai_tower_instance   x_snc_ai_tower_product     │     │       │
│  │  │  x_snc_ai_tower_usage      x_snc_ai_tower_execution   │     │       │
│  │  │  x_snc_ai_tower_alert      x_snc_ai_tower_metric      │     │       │
│  │  │  x_snc_ai_tower_connector  x_snc_ai_tower_config      │     │       │
│  │  └──────────────────────────┬───────────────────────────┘     │       │
│  │                             │                                  │       │
│  │  ┌──────────────────────────▼───────────────────────────┐     │       │
│  │  │              PRESENTATION LAYER                        │     │       │
│  │  │                                                        │     │       │
│  │  │  • AIControlTower Workspace (UI Builder)              │     │       │
│  │  │    - Estate overview dashboard                        │     │       │
│  │  │    - Product drill-down views                          │     │       │
│  │  │    - Governance alert center                           │     │       │
│  │  │    - Execution trace viewer                            │     │       │
│  │  │    - ROI report view                                   │     │       │
│  │  │  • Performance Analytics dashboards                    │     │       │
│  │  │  • Scheduled email reports                             │     │       │
│  │  └────────────────────────────────────────────────────────┘     │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Collector scheduled job fires** on monitored instance (every 15-60 min, configurable)
2. **Collector reads local AI tables:** queries Now Assist logs, AI Agent execution records, Build Agent tasks, user/department data using cross-scope privileges
3. **Collector normalizes data:** transforms source-specific records into standard JSON payload (product, capability, user, timestamp, outcome, duration, metadata)
4. **Collector POSTs payload** to hub REST endpoint `POST /api/x_snc_ai_tower/v1/ingest` with instance auth token in header
5. **Hub ingestion engine validates** payload: checks token against `x_snc_ai_tower_instance` registry, validates JSON schema, rejects malformed data
6. **Hub deduplicates** records using composite key (instance_id + source_record_sys_id + sync_timestamp)
7. **Hub transforms and stores:** maps normalized payload to `x_snc_ai_tower_usage` and `x_snc_ai_tower_execution` records
8. **Hub scheduled job aggregates metrics:** hourly job reads raw usage/execution records, computes aggregate metrics (request count, success rate, active users, etc.), stores in `x_snc_ai_tower_metric`
9. **TowerSentinel AI agent runs nightly:** reads 30-day metrics, compares rolling averages, detects anomalies, writes to `x_snc_ai_tower_alert`, generates alert summary via GenAI Controller
10. **User opens AIControlTower Workspace:** sees estate overview with real-time data from aggregated metrics, can drill down to product/instance/department/user level, view governance alerts, and examine execution traces

### Tables

| Table Name | Purpose | Key Fields |
|---|---|---|
| `x_snc_ai_tower_instance` | Registered monitored instances | name, url, instance_type (prod/dev/test), region, auth_token, last_sync, sync_frequency, active |
| `x_snc_ai_tower_product` | AI product catalog | name (Now Assist / Build Agent / AI Agent), display_name, description, active, connector_id |
| `x_snc_ai_tower_usage` | Normalized AI usage records | instance, product, capability, user_sysid, user_name, department, timestamp, request_count, success_count, failure_count, metadata (JSON) |
| `x_snc_ai_tower_execution` | Individual AI execution traces | instance, product, capability, user, prompt (masked), agent_name, tools_used (JSON), steps (JSON), outcome, duration_ms, intervention_required, timestamp |
| `x_snc_ai_tower_metric` | Pre-aggregated metrics for dashboards | instance, product, capability, metric_type (requests/success_rate/active_users/adoption_rate), period_start, period_end, value, trend_direction |
| `x_snc_ai_tower_alert` | Governance alerts | type, severity, instance, product, title, description, recommended_action, status (new/acknowledged/resolved), detected_at, resolved_at |
| `x_snc_ai_tower_connector` | Data connector registry | product_name, source_tables (JSON), field_mappings (JSON), version, active |
| `x_snc_ai_tower_config` | Global and per-instance configuration | config_key, config_value, instance (null = global), description |

**Consolidation strategy for build phase (cap: 3 tables):**
- `x_snc_ai_tower_record` (polymorphic: `record_type ∈ {usage, execution, metric}` with JSON metadata columns for variable attributes)
- `x_snc_ai_tower_alert` (separate — alert lifecycle needs its own state machine)
- `x_snc_ai_tower_config` (polymorphic: `config_type ∈ {instance, product, connector, global}` with JSON columns)

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/x_snc_ai_tower/v1/ingest` | Collector pushes telemetry data to hub. Body: `{ instance_token, sync_id, records: [{type, product, capability, ...}] }`. Response: `{ accepted, rejected, errors }` |
| `GET` | `/api/x_snc_ai_tower/v1/status/{instance_id}` | Health check — returns last sync timestamp, record count, pending alerts for instance |
| `POST` | `/api/x_snc_ai_tower/v1/config/{instance_id}` | Update instance configuration (sync frequency, enabled products, auth token rotation) |
| `GET` | `/api/x_snc_ai_tower/v1/metrics` | Query aggregated metrics with filters (instance, product, time range). Used by workspace dashboards |
| `POST` | `/api/x_snc_ai_tower/v1/alerts/acknowledge` | Acknowledge or resolve an alert |

**Consolidation strategy for build phase (cap: 2 endpoints):**
- `POST /api/x_snc_ai_tower/v1/execute` with `action` dispatch: `action ∈ {ingest, config_update, alert_ack}`
- `GET /api/x_snc_ai_tower/v1/status` with query params for reads: `?type=metrics&instance=X&product=Y`

### Script Includes

| Class | Purpose |
|---|---|
| `IngestionEngine` | Validates incoming telemetry payloads, deduplicates, transforms, stores to `x_snc_ai_tower_record`. Methods: `ingest(payload)`, `validate(payload)`, `dedupe(records)`, `transform(rawRecord)` |
| `MetricsAggregator` | Reads raw usage/execution records, computes aggregate metrics per instance/product/capability/time-period. Methods: `aggregateAll()`, `aggregateInstance(instanceId)`, `computeMetric(metricType, records)`, `storeMetric(metric)` |
| `GovernanceEngine` | Detects anomalies and generates alerts. Methods: `detectAll()`, `checkSuccessRateDrop(instance, product)`, `checkAdoptionGap(instance, department)`, `checkFailureSpike(instance, product)`, `checkConcentrationRisk(instance)`, `createAlert(type, severity, details)` |
| `ConnectorRegistry` | Manages data connectors for extensible AI product support. Methods: `getConnector(productName)`, `registerConnector(config)`, `applyMapping(rawData, connector)` |
| `ROIEngine` | Calculates time savings and cost benefits. Methods: `calculateROI(instanceId, timeRange)`, `getTimeSaved(interactions, savingsMatrix)`, `getCostSaved(hoursSaved, hourlyRate)`, `generateReport(instanceId)` |
| `TowerQuery` | Translates natural language queries to encoded queries on usage/metric tables (Now Assist integration). Methods: `translateQuery(nlQuery)`, `executeQuery(encodedQuery)` |

**Consolidation strategy for build phase (cap: 3 Script Includes):**
- `TowerCore` — IngestionEngine + ConnectorRegistry (data ingestion and transformation)
- `TowerAnalytics` — MetricsAggregator + ROIEngine (analytics and ROI)
- `TowerGovernance` — GovernanceEngine + TowerQuery (alerts and NL query)

### Business Rules

| Table | Trigger | Purpose |
|---|---|---|
| `x_snc_ai_tower_record` | Before insert | Auto-populate `instance`, `product` lookups from payload data; set `sync_timestamp` |
| `x_snc_ai_tower_alert` | Before insert | Set `detected_at` and `status='new'`; generate alert ID |
| `x_snc_ai_tower_alert` | After update | When status changes to `resolved`, set `resolved_at` timestamp; trigger optional notification |

### Scheduled Jobs

| Name | Schedule | Purpose |
|---|---|---|
| `AI Tower — Metrics Aggregation` | Hourly | Runs `TowerAnalytics.aggregateAll()` to compute metrics from raw records |
| `AI Tower — Governance Scan` | Daily 02:00 | Runs `TowerGovernance.detectAll()` to detect anomalies and create alerts |
| `AI Tower — Stale Instance Check` | Daily 06:00 | Checks `last_sync` on all instances; creates alert if >24h since last sync |
| `AI Tower — Data Retention` | Daily 03:00 | Purges raw records older than retention period (default 90 days); keeps aggregated metrics indefinitely |
| `AI Tower — Executive Report` | Weekly Mon 08:00 | Generates weekly summary report; sends via email to configured recipients |

### Workspace UI Components

| Component | Purpose |
|---|---|
| **Estate Overview** | Top-level dashboard: summary cards (interactions, users, success rate, spend, failures), multi-instance comparison table, trend sparklines |
| **Product Analytics** | Drill-down view for selected product: capability usage, department adoption, top users, latency distribution, feedback ratings |
| **Execution Trace Viewer** | Step-by-step visualization of AI agent/build agent executions with timeline, failure highlighting, and AI-powered root cause analysis |
| **Governance Alert Center** | Alert list with filters (severity, status, instance, product), alert detail with recommended actions, acknowledge/resolve workflow |
| **ROI Dashboard** | Time savings summary, cost benefit projection, benchmark comparison, export to PDF for executive presentation |
| **Instance Management** | Register/edit/remove monitored instances, view sync status, manage auth tokens, configure sync frequency and enabled products |
| **Connector Registry** | View/add/edit data connectors for AI products, manage field mappings, activate/deactivate connectors |

### Deployment

**Hub instance (central):**
1. Import AIControlTower Update Set (hub mode)
2. Configure `sys_app` property `mode = hub`
3. Register monitored instances in Instance Management workspace
4. Generate auth tokens for each instance
5. Configure scheduled jobs (aggregation, governance, retention, reports)
6. Optional: configure GenAI Controller (BYOK) for AI-powered features
7. Optional: configure AI Agent Studio for TowerSentinel agent
8. Access AIControlTower Workspace from ServiceNow navigation

**Collector instance (each monitored instance):**
1. Import AIControlTower Update Set (collector mode)
2. Configure `sys_app` property `mode = collector`
3. Set hub URL and auth token (provided by hub admin)
4. Configure sync frequency (default: 15 min)
5. Select enabled products (Now Assist / Build Agent / AI Agent — based on what's licensed on this instance)
6. Verify cross-scope privileges for AI tables
7. Collector scheduled job starts automatically on first sync

**Dependencies:**
- ServiceNow Xanadu+ (or Australia+ with patches)
- REST API access between collector and hub instances (HTTPS, port 443)
- Hub instance: scoped app + UI Builder + PA (for analytics dashboards)
- Optional: GenAI Controller (BYOK) for AI-powered alert summaries and trace analysis
- Optional: AI Agent Studio for TowerSentinel automated governance agent
- Optional: Now Assist for natural language query capability

**Cross-scope privileges required (collector → OOTB AI tables):**
- `sn_now_assist_*` (Now Assist usage logs and analytics)
- `sys_ai_agent_*` (AI Agent Studio execution records)
- `sys_ai_skill_*` (AI skill definitions and usage)
- `sys_user` (user information for usage attribution)
- `cmn_department` (department information for adoption analysis)
- `sys_ai_agent_run` / `sys_ai_agent_step` (agent execution traces)
---

## 7. Implementation Phases

| Phase | Duration | Deliverables |
|---|---|---|
| **MVP (v0.9)** | 4-6 weeks | Collector scoped app (Now Assist + Build Agent connectors); Hub ingestion engine; 3 core tables (polymorphic record + alert + config); 2 REST endpoints (action dispatch); Estate Overview workspace; Product drill-down for Now Assist; basic governance alerts (success rate drop, adoption gap); cross-scope privileges; installation documentation |
| **v1.0** | 8-12 weeks | AI Agent Studio connector; Execution Trace Viewer; full governance alert suite (6 alert types); Metrics Aggregator scheduled job; PA dashboards; ROI Estimation Engine (basic); Instance Management workspace; email notifications for alerts; data retention job; PDF/CSV export |
| **v1.5** | 12-16 weeks | GenAI Controller integration (alert summaries, trace analysis, ROI report generation); TowerSentinel AI Agent (nightly automated governance scan); Now Assist NL query; Connector Registry UI; consultant/partner multi-tenant mode; benchmark comparison; configurable time-savings matrix per instance |
| **v2.0** | 16-20 weeks | Full ROI dashboard with benchmarking; execution trace comparison mode (success vs failure); anomaly detection ML models (via GenAI Controller); alert correlation engine (group related alerts); custom dashboard builder; SSO/SAML for partner access; audit trail export for compliance; REST API for external BI tools (Tableau/Power BI); marketplace listing |

### MVP Scope Summary

**In scope (v0.9):**
- Collector app with Now Assist + Build Agent connectors
- Hub ingestion + 3 tables + 2 REST endpoints
- Estate Overview dashboard (summary cards + instance comparison)
- Now Assist drill-down (features, users, departments, success/failure)
- 2 governance alert types (success rate drop, adoption gap)
- Cross-scope privileges, installation docs

**Explicitly deferred:**
- AI Agent Studio connector (v1.0)
- Execution Trace Viewer (v1.0)
- Full alert suite (v1.0)
- ROI Engine (v1.0)
- All GenAI Controller / AI Agent Studio / Now Assist AI features (v1.5)
- Benchmarking, ML anomaly detection, marketplace (v2.0)

---

## 8. Competitive Moat

1. **Zero direct competitors in this niche.** No ServiceNow scoped app or third-party product currently provides cross-instance AI observability. ServiceNow's OOTB reporting is per-instance only. Third-party monitoring tools (Datadog, Splunk) don't understand ServiceNow AI table structures.

2. **Mandatory pain with executive visibility.** As enterprises spend $100K-$500K+/year on ServiceNow AI, the "what are we getting for this?" question becomes inevitable. This product answers it. The pain is not optional — it's a governance requirement that surfaces within 6-12 months of AI adoption.

3. **Network effect through connector ecosystem.** Each new AI product connector (added by us or community) increases the platform's value. Once a customer has 3+ connectors configured, switching cost is high because the normalized data model and historical metrics represent institutional knowledge.

4. **Data gravity.** The hub accumulates 30-90 days of AI execution history across all instances. This historical baseline makes anomaly detection and trend analysis more accurate over time. A competitor starting from zero can't match the accuracy of a platform with months of baseline data.

5. **Deep ServiceNow AI table knowledge.** The connector mappings encode intimate knowledge of ServiceNow's AI table structures (sn_now_assist_*, sys_ai_agent_*, Build Agent tables) — knowledge that changes with each release. This is a specialized expertise barrier that generic monitoring tools cannot replicate.

6. **First-mover with Australia release timing.** The Australia release (May 2026) dramatically expanded ServiceNow's AI product surface area. Enterprises are deploying AI Agent Studio and Build Agent now, without observability. First product to market captures the reference customers and case studies that make it the default choice.

---

## 9. Risk Register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **AI table schema changes between releases** — ServiceNow may restructure sn_now_assist_* or sys_ai_agent_* tables in future releases, breaking connector field mappings | High | Versioned connector definitions in `x_snc_ai_tower_connector` with field mappings. Each connector has a `version` field. On upgrade, run connector validation job that tests field existence via `GlideRecord.isValidField()`. Ship updated connectors with each release. Guard all field access with `isValidField()` checks. |
| R2 | **Storage growth on hub instance** — raw usage/execution records accumulate rapidly. A 20-instance estate with 10K interactions/day generates ~600K records/month | High | Data retention scheduled job purges raw records older than configurable period (default 90 days). Aggregated metrics in `x_snc_ai_tower_metric` are retained indefinitely (small footprint). Configurable retention per instance. Monitor table size via system metric and alert at 80% capacity. |
| R3 | **Network reliability between collector and hub** — collectors run on remote instances; REST calls to hub may fail due to network issues, hub downtime, or rate limits | Medium | Collector retry queue stores pending payloads in local staging table. Exponential backoff on failures. Hub returns 503 with Retry-After header during maintenance. Batch payloads to reduce request count. Configurable timeout (default 30s). Alert on hub if instance hasn't synced in >24h. |
| R4 | **Cross-scope privilege gaps** — collector needs read access to AI tables that may require specific plugins or roles. Missing privileges cause silent data gaps | Medium | Collector includes a pre-flight validation job that tests access to all configured source tables. Reports missing privileges to hub via status endpoint. Hub creates alert: "Instance X cannot read table Y — check cross-scope privileges." Installation documentation includes privilege checklist. |
| R5 | **Performance impact on monitored instances** — collector scheduled job queries AI tables every 15-60 min, potentially impacting instance performance on large estates | Medium | Collector uses GlideRecord with targeted encoded queries (time-filtered: only records since last sync). Configurable sync frequency per instance. Batch size limit (default 500 records per sync). Off-peak scheduling option. Performance metric reported to hub (collector execution time) — alert if >60s. |
| R6 | **AI dependency for premium features** — GenAI Controller (BYOK), AI Agent Studio, and Now Assist features are optional but customers may perceive them as required | Low | Clear documentation: "AIControlTower works without any AI license." All AI features gracefully degrade to non-AI alternatives (template text, manual analysis, tabular export). Pricing model does not require AI licenses for core tiers. |
| R7 | **Multi-instance auth token security** — auth tokens grant collectors write access to hub ingestion API. Compromised token could inject false telemetry | Medium | Tokens are per-instance, scoped to ingestion only (REST endpoint ACL enforces action=ingest). Tokens rotatable from hub Instance Management UI. HTTPS required (no HTTP). Hub validates token + instance URL match. Rate limiting per token. Audit log of all ingestion requests. |
| R8 | **Customer perception as "just a dashboard"** — risk that buyers compare to free OOTB dashboards and don't see the cross-instance governance value | Medium | Positioning as "AI Control Tower" (governance platform), not "AI Dashboard." Executive summary feature generates ROI narrative for C-level. Governance alerts demonstrate proactive value, not passive reporting. Free tier limited to single instance (makes multi-instance value obvious at upgrade). |

---

## 10. Pricing Model

| Tier | Price | Target | Features |
|---|---|---|---|
| **Community (Free)** | $0 | Single-instance admins, evaluation | 1 monitored instance, 1 product connector (Now Assist only), Estate Overview dashboard, basic drill-down, 7-day data retention, community support |
| **Professional** | $2,400/year per instance | Mid-market (2-5 instances) | Up to 5 monitored instances, all product connectors, full drill-down, governance alerts (all types), 90-day retention, email notifications, PDF/CSV export, email support |
| **Enterprise** | $6,000/year per instance | Large enterprise (5-20+ instances) | Unlimited instances, Execution Trace Viewer, ROI Estimation Engine, GenAI Controller integration (alert summaries, trace analysis), TowerSentinel AI Agent, configurable retention, PA dashboards, priority support, quarterly architecture review |
| **Partner** | $12,000/year (flat) | Consulting firms (multi-tenant) | Multi-tenant mode (separate client views), benchmarking across clients, white-label workspace branding, REST API for external BI tools, dedicated support channel, co-marketing rights |

### Pricing Rationale

- **Per-instance pricing** aligns cost with monitoring scope. Enterprises adding instances see clear incremental value.
- **Community tier** removes adoption friction — any admin can try it on a single instance at zero cost. Upgrade trigger is the moment they manage a second instance.
- **Professional** is the workhorse tier — covers the 80% use case (mid-market enterprise with 2-5 instances).
- **Enterprise** unlocks the AI-powered features that differentiate from basic dashboarding. ROI Engine quantifies the platform's own value.
- **Partner** flat pricing because consultants manage many instances across many clients — per-instance would be prohibitively expensive and discourage adoption.

### Revenue Projection (Conservative)

| Scenario | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Conservative (5 ent, 10 pro) | $54K | $108K | $162K |
| Moderate (15 ent, 30 pro, 2 partner) | $186K | $372K | $558K |
| Optimistic (30 ent, 60 pro, 5 partner) | $390K | $780K | $1.17M |

---

## Build Phase Constraints (for 03_build)

```
LIMITS:
  Script Includes: 3 (TowerCore, TowerAnalytics, TowerGovernance)
  Tables: 3 (x_snc_ai_tower_record [polymorphic], x_snc_ai_tower_alert, x_snc_ai_tower_config [polymorphic])
  REST Endpoints: 2 (POST /execute with action dispatch, GET /status with query params)
  Business Rules: 3 (record before-insert, alert before-insert, alert after-update)
  Scheduled Jobs: 2 (metrics aggregation hourly, governance scan daily — others deferred to v1.0)
  Cross-scope privileges: 6 (sn_now_assist_*, sys_ai_agent_*, sys_ai_skill_*, sys_user, cmn_department, sys_ai_agent_run)
  Scope prefix: x_snc_ai_tower
```

---

## Quality Gate Self-Check

- [x] All 10 sections present and non-empty
- [x] ASCII architecture diagram has ≥100 box-drawing characters
- [x] 7 features described with concrete implementation details
- [x] AI usage maps to actual ServiceNow AI products (GenAI Controller, AI Agent Studio, Now Assist)
- [x] "Why Not Built-In" lists specific OOTB limitations
- [x] Tables section lists all scoped tables with `x_snc_ai_tower_` prefix
- [x] REST endpoints follow `/api/x_snc_ai_tower/v1/` pattern
- [x] No feature duplicates with prior pipeline products
- [x] Build phase constraints defined (3 SI / 3 tables / 2 REST)
- [x] Risk register has 8 risks with mitigations
- [x] Pricing model has 4 tiers with per-instance pricing

---

*Copyright © 2026 Vladimir Kapustin. All rights reserved. Licensed under AGPL-3.0.*
