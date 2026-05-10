# Product Manifest — ServiceNow AI Migration Portfolio

> Generated: 10 May 2026
> Organization: [vladarchitectservicenow-oss](https://github.com/vladarchitectservicenow-oss)

## Products Summary

| # | Product | Scope | Priority | Status | Effort (pts) |
|---|---------|-------|----------|--------|-------------|
| 1 | Sandbox Migration Shield | `x_snc_sms` | 🥇 CRITICAL | Design Complete | 34 |
| 2 | AI Readiness Diagnostic | `x_snc_ard` | 🥈 HIGH | Design Complete | 42 |
| 3 | Workflow Cost Optimizer | `x_snc_wco` | 🥉 MEDIUM | Design Complete | 28 |

## Development Order

### Phase 1 — Sandbox Migration Shield (Week 1-2)
**Why first:** KB2944435 is actively rolling out — market window is NOW. Highest urgency, clearest ICP, no direct competitor.

**Build sequence:**
1. Scoped app scaffolding + tables (Day 1)
2. SandboxScanner.js + scan_run logic (Day 2-3)
3. Dashboard widget (Day 4)
4. ExemptionManager + Exemption widget (Day 5-6)
5. MigrationEngine + preview mode (Day 7-8)
6. REST APIs (Day 9)
7. Scheduled jobs + email reports (Day 10)
8. ATF tests (Day 11-12)

### Phase 2 — AI Readiness Diagnostic (Week 3-4)
**Why second:** Complements KB2944435 story — same ICP, different pain. Can cross-sell.

**Build sequence:**
1. Scoped app scaffolding + tables (Day 1)
2. ProcessDebtScanner (Day 2-3)
3. CMDBHealthAnalyzer (Day 4-5)
4. KBAnalyzer (Day 6)
5. Dashboard (Day 7)
6. AISimulator (Day 8-9)
7. RoadmapGenerator (Day 10)
8. REST APIs + ATF (Day 11-12)

### Phase 3 — Workflow Cost Optimizer (Week 5-6)
**Why third:** Builds on infrastructure from #1 and #2. More niche ICP but strong upsell potential for existing customers of #1 and #2.

## Shared Infrastructure

| Component | Used By | Description |
|-----------|---------|-------------|
| Service Portal framework | All 3 | Dashboard widgets, list views |
| Scripted REST API patterns | All 3 | Authentication, routing, error handling |
| GlideAjax pattern | All 3 | Client-server communication |
| Scheduled job framework | All 3 | Recurring scans/checks |
| Audit log table pattern | #1, #2 | Compliance and traceability |

## Estimated Effort

| Product | Story Points | Developers | Calendar Weeks |
|---------|-------------|------------|----------------|
| Sandbox Migration Shield | 34 | 1 senior | 2 |
| AI Readiness Diagnostic | 42 | 1 senior | 2.5 |
| Workflow Cost Optimizer | 28 | 1 senior | 2 |
| **Total** | **104** | **1** | **6.5 weeks** |

## Cross-Sell Strategy

```
Customer buys Sandbox Migration Shield ($25K/yr)
  → "While we're fixing scripts, let's check AI readiness" → upsell ARD ($35K/yr)
  → "Now that you're AI-ready, let's optimize cost" → upsell WCO ($25K/yr)
  
Bundle: All 3 for $65K/yr (23% discount vs $85K à la carte)
```

## Repository Structure

```
products/
├── MANIFEST.md
├── sandbox-migration-shield/
│   ├── README.md
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── SPEC.md
│   ├── DESIGN.md
│   └── src/
│       ├── script_includes/
│       │   ├── SandboxScanner.js
│       │   ├── MigrationEngine.js
│       │   └── ExemptionManager.js
│       ├── rest_apis/
│       │   └── scanner_api.js
│       ├── scheduled_jobs/
│       │   ├── weekly_scan.js
│       │   └── weekly_report.js
│       └── ui/
│           ├── dashboard_widget.html
│           └── exemption_form.html
├── ai-readiness-diagnostic/
│   ├── README.md
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── SPEC.md
│   ├── DESIGN.md
│   └── src/
│       ├── script_includes/
│       │   ├── ProcessDebtScanner.js
│       │   ├── CMDBHealthAnalyzer.js
│       │   ├── KBAnalyzer.js
│       │   ├── AISimulator.js
│       │   └── RoadmapGenerator.js
│       ├── rest_apis/
│       │   └── diagnostic_api.js
│       └── scheduled_jobs/
│           └── weekly_health_scan.js
└── workflow-cost-optimizer/
    ├── README.md
    ├── PRD.md
    ├── ARCHITECTURE.md
    ├── SPEC.md
    ├── DESIGN.md
    └── src/
        ├── script_includes/
        │   ├── WorkflowProfiler.js
        │   ├── CostCalculator.js
        │   └── RoutingEngine.js
        ├── rest_apis/
        │   └── optimizer_api.js
        └── scheduled_jobs/
            └── monthly_cost_scan.js
```
