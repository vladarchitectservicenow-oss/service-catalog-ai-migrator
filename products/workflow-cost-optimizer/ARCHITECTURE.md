# Technical Architecture — Workflow Cost Optimizer

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                       SERVICE NOW INSTANCE                             │
│                                                                        │
│  ┌──────────────────────┐            ┌─────────────────────────────┐  │
│  │   DECISION DASHBOARD  │            │     REST API (Scripted)     │  │
│  │   (Service Portal)    │            │     /api/x_snc_wco/v1/*     │  │
│  └──────────┬───────────┘            └──────────────┬──────────────┘  │
│             │                                       │                  │
│  ┌──────────┴───────────────────────────────────────┴──────────────┐  │
│  │                     OPTIMIZER ENGINE                             │  │
│  │                                                                  │  │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │  │
│  │  │WorkflowProfiler │  │CostCalculator    │  │RoutingEngine   │  │  │
│  │  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │  │
│  │           └────────────────────┼────────────────────┘            │  │
│  └────────────────────────────────┼────────────────────────────────┘  │
│                                   │                                    │
│  ┌────────────────────────────────┴────────────────────────────────┐  │
│  │                         DATA LAYER                                │  │
│  │                                                                  │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │  │
│  │  │x_snc_wco_profile │ │x_snc_wco_pricing │ │x_snc_wco_routing │  │  │
│  │  │(workflow profiles)│ │(platform pricing)│ │(recommendations) │  │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### WorkflowProfiler
Scans `sc_cat_item`, `sc_req_item`, `incident`, interaction records to determine:
- Channel affinity (portal vs slack vs email vs api)
- Volume (tickets/month)
- Complexity class (simple/medium/complex)
- Average resolution time
- Data sensitivity flags

### CostCalculator
Maintains configurable pricing models per platform. Computes per-workflow cost given:
- Volume × per-transaction rate
- Fixed seat license amortized across workflows
- Infrastructure cost allocation

### RoutingEngine
Constraint-satisfaction algorithm:
- Compliance constraints (hard — cannot violate)
- Latency constraints (soft — penalty for exceeding)
- Budget constraint (hard — total cost ≤ budget)
- Maximizes workflow coverage within constraints

## Data Model

### `x_snc_wco_profile` — Workflow Profile
| Field | Type | Description |
|-------|------|-------------|
| source_table | String | sc_cat_item / incident_category / etc. |
| source_sys_id | GUID | Reference |
| name | String | Workflow name |
| monthly_volume | Integer | Avg tickets/month |
| channel_affinity | Choice | PORTAL / SLACK / EMAIL / API / WALKUP |
| complexity | Choice | SIMPLE / MEDIUM / COMPLEX |
| avg_resolution_min | Integer | Minutes |
| data_sensitivity | Choice | LOW / MEDIUM / HIGH |
| compliance_required | Choice | NONE / GDPR / IL5 / FEDRAMP / HIPAA |

### `x_snc_wco_pricing` — Platform Pricing Model
| Field | Type | Description |
|-------|------|-------------|
| platform | Choice | NOW_ASSIST / MOVEWORKS / SLACK_AI / TEAMS_AI / STANDALONE |
| fixed_monthly_cost | Decimal | Seat license + infra |
| cost_per_transaction | Decimal | Per-resolution cost |
| min_monthly_commit | Decimal | Minimum spend |
| compliance_certs | String | JSON array of certifications |
| typical_latency_ms | Integer | Avg response latency |
| last_updated | DateTime | Pricing freshness |

### `x_snc_wco_routing` — Routing Recommendation
| Field | Type | Description |
|-------|------|-------------|
| workflow_profile | Reference | Link to profile |
| recommended_platform | Choice | Platform |
| estimated_monthly_cost | Decimal | Cost |
| constraint_violations | String | JSON: any violated constraints |
| confidence_score | Integer | 0-100 |

## Security
- Scope: `x_snc_wco`
- Roles: `x_snc_wco.admin`, `x_snc_wco.analyst`
- Read-only on sc_cat_item, sc_req_item, incident, sys_user
- Pricing data editable by admin, read-only for analysts

## Deployment
Scoped Application via Store or update set. Initial pricing models seeded from public vendor pricing data.
