# Product Requirements Document — Workflow Cost Optimizer

## Problem Statement

> *"Cost per agent at our scale was 30-40 percent below SN. So we ended up: Now Assist for the enterprise SN-native pieces, startup AI helpdesk for the slack-native employee-facing layer."*
> — r/servicenow, 16 upvotes, 12 comments

> *"If they're in Slack (which is where employee requests actually happen), the startups win on speed and customization. Measured 2 weeks to deploy vs 4 months for Now Assist on the same workflow."*
> — Same thread comment

Companies are converging on hybrid AI helpdesk architectures: ServiceNow Now Assist for ITIL-heavy, compliance-sensitive workflows + Slack/Teams-native AI for fast, employee-facing requests + standalone AI startups for specialized use cases.

The problem: **no objective tool exists** to determine which workflow should run where. Current approach is 4+ months of manual evaluation by platform teams, biased vendor demos, and expensive consultant engagements — often resulting in suboptimal routing that wastes 30-40% of AI spend.

## User Personas

### Persona 1: Mark — Director of IT Operations
- **Company:** 2,500-employee tech company
- **Current state:** ServiceNow ITSM Pro + Slack. Evaluating Now Assist renewal ($180K/yr) vs Moveworks ($120K/yr) vs keeping both.
- **Goal:** Data-driven decision on which workflows stay on SN and which move to Slack-native AI.
- **Pain:** Vendor comparisons are apples-to-oranges. No standardized cost-per-workflow methodology.

### Persona 2: Lisa — VP of Digital Workplace
- **Company:** 8,000-employee professional services
- **Current state:** Just deployed Now Assist, but employee adoption is low because they live in Teams.
- **Goal:** Show CFO that a hybrid approach (SN for IT + Teams-bot for HR/Finance) delivers better ROI.
- **Pain:** Can't quantify the "adoption gap" in financial terms.

### Persona 3: Raj — CIO of Mid-Market
- **Company:** 1,500-employee manufacturing
- **Current state:** SN ITSM Standard. Evaluating first AI investment. Budget: $80K.
- **Goal:** Maximize AI helpdesk coverage for $80K — which platform(s) give best cost-per-resolved-ticket?
- **Pain:** Every vendor claims lowest TCO. No independent calculator exists.

## User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | Ops Director | Profile all workflows (catalog items, incidents, requests) by channel affinity | I know which workflows are portal vs slack vs email native | P0 |
| US-02 | Ops Director | See cost-per-workflow on Now Assist vs Moveworks vs standalone AI | I make data-driven platform decisions | P0 |
| US-03 | VP Digital | See latency and compliance constraints per workflow | I don't route regulated workflows to non-compliant platforms | P0 |
| US-04 | CIO | Get an optimal routing recommendation map | I maximize coverage within budget | P1 |
| US-05 | CIO | See ROI projection for hybrid vs all-SN vs all-startup | I justify the investment to the board | P1 |
| US-06 | Ops Director | Update pricing models as vendor pricing changes | My comparisons stay current | P2 |
| US-07 | All | Export cost analysis as PDF | I include it in budget proposals | P2 |

## Functional Requirements

### FR-01: Workflow Profiler
- Scan all service catalog items (`sc_cat_item`), record producers, incident categories, request types
- Classify each by channel affinity:
  - **Portal-native:** >80% submissions via Service Portal
  - **Slack/Teams-native:** >50% submissions via Virtual Agent or Slack integration
  - **Email-native:** >50% submissions via inbound email
  - **API-native:** programmatic submissions
  - **Walk-up:** submitted via walk-up experience
- Also classify by complexity:
  - **Simple:** single-step, no approvals, standard fulfillment (e.g., password reset)
  - **Medium:** 2-3 steps, 1 approval (e.g., software request)
  - **Complex:** multi-department, multi-approval, integrations (e.g., employee onboarding)

### FR-02: Cost-per-Workflow Calculator
- Pricing models (configurable, updated via admin panel):
  - **Now Assist:** per-resolved-incident cost + SKU allocation
  - **Moveworks:** per-agent-seat + per-automation
  - **Standalone AI (e.g., LangChain, custom GPT):** per-API-call + infrastructure
  - **Slack AI / Teams AI:** per-user + per-automation
- Calculation: for each workflow, estimate cost = (volume × unit_cost) + (fixed_cost / total_workflows)
- Show: annual cost, cost-per-resolution, total-platform-cost comparison

### FR-03: Latency & Compliance Matrix
- Per workflow:
  - Data residency requirement (GDPR, IL5, FedRAMP)
  - Max acceptable latency (sub-second vs 4-minute propagation acceptable)
  - Audit trail required (full vs summary)
  - PII exposure level (high/medium/low)
- Per platform:
  - Data center locations
  - Typical latency
  - Audit capabilities
  - Compliance certifications
- Auto-flag: "Workflow X cannot run on Platform Y due to IL5 requirement"

### FR-04: Optimal Routing Engine
- Input: all workflow profiles + cost data + compliance matrix + budget constraint
- Algorithm: cost-minimization with compliance constraints
- Output: routing map — each workflow assigned to recommended platform
- Budget mode: "Given $X budget, here's the optimal coverage"

### FR-05: ROI Projection
- Baseline: all workflows on Now Assist (most expensive)
- Optimized: routing map from FR-04
- Savings: baseline_cost − optimized_cost
- Break-even: months to recover evaluation/implementation cost

## Non-Functional Requirements

| Category | Requirement |
|----------|------------|
| Performance | Profiler <3 min for <5K catalog items |
| Data freshness | Pricing models cached, refreshable on-demand |
| Security | Read-only on platform data; pricing data encrypted at rest |
| Accuracy | Cost estimates within ±15% of actual vendor quotes |

## Scope

### MVP
- FR-01, FR-02, FR-03
- US-01, US-02, US-03

### v1.1
- FR-04, FR-05
- US-04, US-05

### v2.0
- PDF export, pricing model admin panel
- US-06, US-07

## Success Metrics

**North Star:** Cost Savings Realized — % reduction in AI helpdesk spend after implementing routing recommendations (target: >25%).

**KPIs:**
1. Evaluation time reduction: 4 months → <1 week
2. Routing accuracy: <5% workflows misrouted (compliance or cost violation)
3. Budget optimization: recommended routing fits within stated budget 100% of cases
4. Customer ROI: avg 30% cost reduction within 6 months
