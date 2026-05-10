# Technical Architecture — AI Readiness Diagnostic

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                       SERVICE NOW INSTANCE                             │
│                                                                        │
│  ┌─────────────────────────┐          ┌────────────────────────────┐  │
│  │    EXECUTIVE DASHBOARD   │          │     REST API (Scripted)    │  │
│  │    (Service Portal)      │          │     /api/x_snc_ard/v1/*    │  │
│  └────────────┬────────────┘          └─────────────┬──────────────┘  │
│               │                                     │                  │
│  ┌────────────┴─────────────────────────────────────┴──────────────┐  │
│  │                     ANALYZER ENGINE                              │  │
│  │                                                                  │  │
│  │  ┌───────────────┐ ┌────────────────┐ ┌──────────────────────┐  │  │
│  │  │ProcessDebt    │ │CMDBHealth      │ │KBAnalyzer           │  │  │
│  │  │Scanner        │ │Analyzer        │ │                      │  │  │
│  │  └───────┬───────┘ └───────┬────────┘ └──────────┬───────────┘  │  │
│  │          └─────────────────┼─────────────────────┘               │  │
│  └────────────────────────────┼────────────────────────────────────┘  │
│                               │                                        │
│  ┌────────────────────────────┴────────────────────────────────────┐  │
│  │  ┌────────────────┐  ┌──────────────────────┐                   │  │
│  │  │AISimulator     │  │RoadmapGenerator      │                   │  │
│  │  └────────────────┘  └──────────────────────┘                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                               │                                        │
│  ┌────────────────────────────┴────────────────────────────────────┐  │
│  │                       DATA LAYER                                 │  │
│  │                                                                  │  │
│  │  Custom Tables:                                                  │  │
│  │  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │  │
│  │  │x_snc_ard_workflow│ │x_snc_ard_cmdb    │ │x_snc_ard_kb      │  │  │
│  │  │_health           │ │_health           │ │_health           │  │  │
│  │  └──────────────────┘ └──────────────────┘ └──────────────────┘  │  │
│  │  ┌──────────────────┐ ┌──────────────────┐                       │  │
│  │  │x_snc_ard_sim     │ │x_snc_ard_diag    │                       │  │
│  │  │_result           │ │_run              │                       │  │
│  │  └──────────────────┘ └──────────────────┘                       │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### ProcessDebtScanner
Scans `wf_workflow`, `sys_flow`, `sys_hub_flow`, `sys_flow_step` for:
- Missing owner/approver → references `sys_user` (active check)
- Unreachable steps (DFS from entry point)
- Circular dependencies (cycle detection)
- Silent completions (status=Cancelled without audit trail)
- Duplicate trigger conditions (hash comparison)

### CMDBHealthAnalyzer
Per CI class (configurable):
- `GlideAggregate` for COUNT, NULL check on required fields
- Duplicate detection: attribute vector cosine similarity >0.9
- Orphan: `cmdb_rel_ci` COUNT = 0
- Staleness: `sys_updated_on` >365 days
- Relationship density: rel count / CI count

### KBAnalyzer
- `kb_knowledge` scan: text emptiness, outdated flag, view count
- Title similarity via Levenshtein distance (85% threshold)
- Missing: `ts_query` search log analysis

### AISimulator
Takes workflow definition + real instance data, simulates agent execution path and identifies data dependency failures.

## Data Model

### `x_snc_ard_workflow_health`
| Field | Type | Description |
|-------|------|-------------|
| workflow_sys_id | GUID | Reference to workflow |
| workflow_name | String | Display name |
| workflow_type | Choice | wf_workflow / sys_flow / hub_flow |
| health_score | Integer | 0-100 |
| issue_count | Integer | Total issues found |
| critical_issues | Integer | Blocking issues |
| issues_json | String(4000) | JSON array of {type, description, step_id} |
| status | Choice | NEW / IN_PROGRESS / FIXED / WAIVED |
| diag_run | Reference | Link to diagnostic run |

### `x_snc_ard_cmdb_health`
| Field | Type | Description |
|-------|------|-------------|
| ci_class | String | CMDB class name |
| total_cis | Integer | Count |
| completeness_pct | Integer | 0-100 |
| duplicate_pct | Integer | 0-100 |
| orphan_pct | Integer | 0-100 |
| stale_pct | Integer | 0-100 |
| ai_impact_score | Integer | 0-100 (higher = worse for AI) |
| diag_run | Reference | Link |

### `x_snc_ard_kb_health`
| Field | Type | Description |
|-------|------|-------------|
| kb_name | String | KB name |
| total_articles | Integer | Count |
| empty_pct | Integer | 0-100 |
| outdated_pct | Integer | 0-100 |
| duplicate_pct | Integer | 0-100 |
| knowledge_readiness | Integer | 0-100 |
| diag_run | Reference | Link |

### `x_snc_ard_diag_run`
Master record per diagnostic execution: type (FULL/INCREMENTAL), timestamps, aggregate scores.

### `x_snc_ard_simulation_result`
Per-workflow AI simulation: pass/fail, failure reason, data dependency gap identified.

## Security Model
- Scope: `x_snc_ard`
- Roles: `x_snc_ard.admin`, `x_snc_ard.viewer`
- Read-only on platform tables (wf_*, cmdb_*, kb_*)
- Write only to custom tables within scope

## Deployment
Scoped Application via ServiceNow Store or update set. Post-install: configuration wizard for CMDB class selection, KB scope, workflow filters.
