# AIControlTower

**Centralized AI observability and governance for enterprises running ServiceNow AI across multiple instances.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/badge/version-0.9.0-orange.svg)](#)
[![Tests](https://img.shields.io/badge/tests-30%2F30%20pass-brightgreen.svg)](#)

## Overview

Enterprises adopting ServiceNow AI products — Now Assist, Build Agent, AI Agent Studio, Agentic AI — end up with AI scattered across production, development, and regional instances with no unified visibility. Each instance has its own siloed usage logs, no cross-instance comparison, and no governance layer that flags adoption gaps, failure spikes, or cost anomalies before they become executive problems.

**AIControlTower** solves this by deploying a lightweight telemetry collector on each instance that streams AI usage, execution, and outcome data to a central reporting hub — one dashboard for the entire AI estate.

## Architecture

```
  Instance US          Instance EU          Instance APAC
  ┌──────────┐         ┌──────────┐         ┌──────────┐
  │Collector │         │Collector │         │Collector │
  └────┬─────┘         └────┬─────┘         └────┬─────┘
       │  REST API          │                    │
       └─────────┬──────────┘────────────────────┘
                  ▼
         ┌────────────────┐
         │  CENTRAL HUB   │
         │  (AIControlTower)│
         │                │
         │ IngestionEngine │
         │ MetricsAggregator│
         │ GovernanceEngine │
         │  ROI Engine     │
         │  NL Query       │
         └───────┬────────┘
                 ▼
         ┌────────────────┐
         │  WORKSPACE UI  │
         │ Estate Overview│
         │ Drill-Down     │
         │ Alert Center   │
         │ Trace Viewer   │
         │ ROI Dashboard  │
         └────────────────┘
```

## Data Model

| Table | Type | Purpose |
|---|---|---|
| `x_snc_ai_tower_record` | Polymorphic | Normalized AI usage, execution, and metric records (`record_type` discriminates) |
| `x_snc_ai_tower_alert` | Dedicated | Governance alerts with lifecycle (new → acknowledged → resolved) |
| `x_snc_ai_tower_config` | Polymorphic | Instance registry, connector definitions, global config (`config_type` discriminates) |

## Features

| Feature | Description | Phase |
|---|---|---|
| Multi-Instance Telemetry Collector | Lightweight scoped app on each instance, scheduled sync every 15-60 min | MVP |
| Unified AI Dashboard | Estate overview: interactions, users, success rate, spend, failures across all instances | MVP |
| Product Drill-Down | Now Assist / Build Agent capability-level analytics with department and user breakdown | MVP |
| AI Governance Alerts | 6 alert types: success rate drop, adoption gap, failure spike, concentration risk, stale data | MVP |
| Extensible AI Data Model | Product → Capability → Interaction → Execution → Outcome. New products = new connector, no schema change | MVP |
| ROI Estimation Engine | Time savings matrix, cost benefit projection, annualized ROI | MVP |
| Agent Execution Trace Viewer | Step-by-step visualization of AI agent executions (v1.0) | v1.0 |
| GenAI Controller Integration | AI-powered alert summaries and trace analysis (v1.5) | v1.5 |
| TowerSentinel AI Agent | Nightly automated governance scan via AI Agent Studio (v1.5) | v1.5 |
| Natural Language Query | Now Assist chat integration for executive queries (v1.5) | v1.5 |

## Installation

### Hub Instance (Central Reporting Hub)

1. ServiceNow → Retrieved Update Sets → Import Update Set from XML
2. Upload `src/update_set_combined.xml`
3. Preview → Commit
4. Register monitored instances in `x_snc_ai_tower_config` (config_type = instance)
5. Register connectors for each AI product (config_type = connector)
6. Approve cross-scope privileges (System Security → Cross Scope Privileges)
7. Assign `x_snc_ai_tower.admin` and `x_snc_ai_tower.user` roles

### Collector Instance (Each Monitored Instance)

1. Import the same Update Set
2. Configure hub URL and auth token
3. The collector scheduled job reads local AI tables and POSTs to the hub

## API

### POST /api/x_snc_ai_tower/v1/execute

```bash
# Ingest telemetry
curl -X POST https://hub.service-now.com/api/x_snc_ai_tower/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"action":"ingest","instance_token":"tok123","sync_id":"s1","records":[...]}'

# Register instance
curl -X POST ... -d '{"action":"register_instance","name":"PROD-US","url":"https://..."}'

# Acknowledge alert
curl -X POST ... -d '{"action":"alert_ack","alert_id":"abc123"}'
```

### GET /api/x_snc_ai_tower/v1/status

```bash
# Get metrics
curl "https://hub.service-now.com/api/x_snc_ai_tower/v1/status?type=metrics&product=Now Assist"

# Get alerts
curl "https://hub.service-now.com/api/x_snc_ai_tower/v1/status?type=alerts&severity=critical"

# Get ROI
curl "https://hub.service-now.com/api/x_snc_ai_tower/v1/status?type=roi&instance_id=abc&report=full"

# Natural language query
curl "https://hub.service-now.com/api/x_snc_ai_tower/v1/status?type=nl_query&q=show%20Now%20Assist%20adoption%20in%20HR"
```

## Testing

```bash
cd tests && node test_suite.js
# Expected: 30 passed, 0 failed
```

## Cross-Scope Privileges

| Table | Operation |
|---|---|
| sys_user | read |
| cmn_department | read |
| sn_now_assist_interaction | read |
| sn_now_assist_usage | read |
| sys_ai_agent_run | read |
| sys_ai_agent_step | read |

## Build Constraints

| Component | Limit | Built |
|---|---|---|
| Script Includes | 3 | 3 |
| Tables | 3 | 3 |
| REST Endpoints | 2 | 2 |
| Business Rules | 3 | 3 |
| Scheduled Jobs | 2 | 2 |
| Cross-Scope Privileges | 6 | 6 |

## License

Copyright © 2026 Vladimir Kapustin. Licensed under AGPL-3.0.