# service-catalog-ai-migrator Architecture Summary

**Product:** ServiceNow AI Catalog Migrator
**Repository:** service-catalog-ai-migrator
**Scope:** x_service_catalog_ai_migrator
**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only

## Overview

service-catalog-ai-migrator is the umbrella orchestrator for autonomous ServiceNow product development. It powers the end-to-end pipeline: research → architecture → generation → testing → deployment → marketing. The system ingests ServiceNow pain points (from Reddit, StackExchange, official docs), deduplicates ideas via honcho.db, generates scoped app artifacts, runs CI validation, and pushes to individual repos under vladarchitectservicenow-oss.

## Architecture Layers

```
┌────────────────────────────────────────────────────────┐
│                    CLI Layer (cli.py)                   │
│  argparse → dispatch (scan, generate, validate, push)  │
├────────────────────────────────────────────────────────┤
│                 Analysis Layer (analyzer/)              │
│  integration_mapper  workflow_health  script_auditor   │
│  bottleneck_finder                                    │
├────────────────────────────────────────────────────────┤
│                Generation Layer (generator/)            │
│  tor_generator  spec_generator  agent_designer         │
│  risk_analyzer  roadmap_builder  user_training         │
├────────────────────────────────────────────────────────┤
│              ServiceNow Client (servicenow/)            │
│  client.py (REST)  discovery.py  fetchers.py           │
├────────────────────────────────────────────────────────┤
│                  Data / Templates Layer                 │
│  models.py  config.py  prompts/  templates/ (Jinja2)   │
├────────────────────────────────────────────────────────┤
│                   External Systems                     │
│  ServiceNow PDI  GitHub API  honcho.db (SQLite)        │
└────────────────────────────────────────────────────────┘
```

## Component Details

| Component | File | Role |
|-----------|------|------|
| CLI Entry | src/cli.py | Argparse router: scan, generate, validate, push |
| Config | src/config.py | Environment variable loading, SN credentials |
| Models | src/models.py | Pydantic data models for scans, reports |
| SN Client | src/servicenow/client.py | REST API wrapper for ServiceNow tables |
| SN Discovery | src/servicenow/discovery.py | Auto-detect scope, plugins, tables |
| SN Fetchers | src/servicenow/fetchers.py | Table/record fetch with pagination |
| Integration Mapper | src/analyzer/integration_mapper.py | Map REST/SOAP integrations |
| Workflow Health | src/analyzer/workflow_health.py | Flow/workflow execution analysis |
| Script Auditor | src/analyzer/script_auditor.py | Deprecated API detection |
| Bottleneck Finder | src/analyzer/bottleneck_finder.py | Performance hotspot detection |
| TOR Generator | src/generator/tor_generator.py | Terms of Reference document generation |
| Spec Generator | src/generator/spec_generator.py | Technical specification generation |
| Agent Designer | src/generator/agent_designer.py | AI agent architecture generation |
| Risk Analyzer | src/generator/risk_analyzer.py | Risk register generation |
| Roadmap Builder | src/generator/roadmap_builder.py | Product roadmap generation |
| User Training | src/generator/user_training.py | Training plan document generation |

## Data Model

| Table | Purpose |
|-------|---------|
| x_service_catalog_ai_migrator_config | Pipeline configuration (PDI URL, scopes, thresholds) |
| x_service_catalog_ai_migrator_log | Execution logs with timestamps and status codes |
| x_service_catalog_ai_migrator_scan | Scan results (snapshot of instance state) |
| x_service_catalog_ai_migrator_report | Generated report artifacts (JSON, MD) |

## Data Flow

1. User runs `python3 src/cli.py scan --sn-url https://dev362840.service-now.com`
2. CLI dispatches to `servicenow/client.py` for REST authentication
3. `discovery.py` enumerates scopes, plugins, tables
4. `fetchers.py` paginates through records
5. Analyzer modules process raw data into structured findings
6. Generator modules produce TOR, SPEC, risk register, training plan
7. Results written to `output/` directory

## Key Design Decisions

- **Python-first**: All pipeline logic in Python; ServiceNow scoped apps are JS outputs
- **Jinja2 templates**: All documents generated from templates in `src/templates/`
- **Stateless runs**: Each CLI invocation is independent; state stored in honcho.db
- **PDI credentials**: Read from environment variables only, never hardcoded
- **Idempotent**: Re-running same scan produces identical output
