# SN Notification Trace (NTRC)

**Scope:** `x_ntrc`  
**Release Target:** Australia (minimum: Utah)  
**License:** AGPL-3.0  
**Copyright:** Vladimir Kapustin

## Overview

Notification Trace is a ServiceNow scoped application that traces notification delivery paths, detects silent failures, identifies overlapping notifications, and provides AI-powered remediation suggestions. It monitors OOTB notification infrastructure (Email, Events, Incidents) and surfaces health metrics through REST endpoints.

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| `NotificationTracer` | Script Include | Core engine: traceRecord(), detectSilentFailures(), remediate(), storeTraceResult() |
| `TraceAnalyzer` | Script Include | Analysis engine: detectOverlaps(), computeHealth(), generateTimeline(), aiExplain(), cleanupOldResults() |
| `trace_endpoint` | REST Endpoint | Trigger traces and query results |
| `health_endpoint` | REST Endpoint | Health dashboard data |
| `x_ntrc_trace_config` | Table | Trace configuration (scope, filters, AI toggle, schedule, retention, alerts) |
| `x_ntrc_trace_result` | Table | JSON-absorbed trace results with health scores and AI explanations |
| `ntrc_health_monitor` | Business Rule | Periodic health computation |
| `ntrc_overlap_scanner` | Business Rule | Overlap detection scheduling |
| `ntrc_result_cleanup` | Business Rule | Retention-based cleanup |

## Artifacts

- **23 total artifacts:** 2 tables, 2 script includes, 2 REST endpoints, 10 ACLs, 3 business rules, 3 cross-scope privileges, 1 sys_app.xml
- **4 JavaScript files** (syntax-validated)
- **19 XML files** (syntax-validated)

## Build

```
20260710050044_d4fdb485 — Phase 03 Build
```
