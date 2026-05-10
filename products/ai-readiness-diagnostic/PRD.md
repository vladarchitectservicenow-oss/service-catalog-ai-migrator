# Product Requirements Document — AI Readiness Diagnostic

## Problem Statement

> *"None of this works without clean data and structured workflows. Agents do not fix broken processes, they just run them faster."*
> — K26 Day 1 Keynote discussion, 68 upvotes, 59 comments

> *"AI maturity is going DOWN 20% year over year despite all the AI activity. So more AI, less confidence."*
> — K26 Australia Release Keynote

ServiceNow has bet the company on AI — Otto (autonomous AI agent), Now Assist, and AI Control Tower. But the platform reality is grim:

- **367+ applications** in the average enterprise ServiceNow instance
- **70%+ customers** have incomplete CMDBs, broken workflows, stale knowledge bases
- **AI maturity declining 20% YoY** — more AI tools, less trust
- **No diagnostic tool exists** to measure readiness or prescribe fixes

Companies are spending millions on Otto licenses and professional services, only to discover their data and processes can't support AI. Failed AI pilots cost $500K-2M and destroy executive confidence.

## User Personas

### Persona 1: Sarah — CTO / VP of Platform
- **Company:** 12,000-employee financial services firm
- **Current state:** ITSM Pro, CMDB at 40% completeness, KB largely unmaintained
- **Goal:** Board mandate to implement Otto by Q1 2027. Needs confidence the investment will deliver.
- **Pain:** No objective way to measure AI readiness. Consultant quotes are vague and expensive.

### Persona 2: David — Director of IT Operations
- **Company:** 8,000-employee healthcare organization
- **Current state:** 200+ workflows, half have known issues (silent failures, missing owners)
- **Goal:** Fix what's broken before AI amplifies the problems.
- **Pain:** Can't prioritize — which of 100 broken workflows matters most for AI?

### Persona 3: Rachel — AI/ML Platform Lead
- **Company:** 25,000-employee telecom
- **Current state:** Running Now Assist pilot, seeing poor results
- **Goal:** Prove to leadership that process debt (not AI quality) is the problem.
- **Pain:** No data to back up her diagnosis. Leadership thinks "AI just isn't ready."

## User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | CTO | See an overall AI Readiness Score (0-100) | I can report to the board | P0 |
| US-02 | Ops Director | Scan all workflows and identify broken/silently-failing flows | I fix what AI will break | P0 |
| US-03 | Ops Director | Get a Process Health Score for each workflow | I prioritize fixes | P0 |
| US-04 | Ops Director | See CMDB completeness and duplicate rate | I know if AI can trust the CMDB | P0 |
| US-05 | AI Lead | Analyze knowledge base quality (empties, outdated, duplicates) | AI doesn't hallucinate from bad KB | P0 |
| US-06 | AI Lead | Simulate Otto/Now Assist against each workflow | I predict failure points before go-live | P1 |
| US-07 | CTO | Get a prioritized remediation roadmap with effort estimates | I resource the fix phase correctly | P1 |
| US-08 | AI Lead | See trend data (readiness score improving week-over-week) | I show progress to skeptics | P1 |
| US-09 | Ops Director | Identify quick wins (fixes that unlock multiple AI workflows) | I get early momentum | P2 |
| US-10 | All | Export diagnostic report as executive-ready PDF | I present to non-technical stakeholders | P2 |

## Functional Requirements

### FR-01: Workflow Scanner & Process Health Analyzer
- Scan tables: `wf_workflow`, `sys_flow`, `sys_hub_flow`, `sys_flow_step`, `sys_flow_trigger`
- Detection patterns:
  - **Broken:** Missing owner, null approver, unreachable step, circular reference
  - **Silent failure:** Flow completes with status "Cancelled" or no audit trail
  - **Orphan:** Approval pending >30 days, assigned to inactive user
  - **Duplicate:** Multiple flows handling identical trigger conditions
  - **Non-compliant:** Lack of audit trail, no error handling branch
- Output: `x_snc_ard_workflow_health` record per workflow with score (0-100)

### FR-02: CMDB Health for AI Analyzer
- Metrics (per CI class):
  - Completeness: % required fields populated
  - Duplicate rate: % CIs with >90% attribute match
  - Orphan rate: % CIs with zero relationships
  - Staleness: % CIs not updated >365 days
  - Relationship density: avg relationships per CI
- Thresholds configurable by CI class
- AI Impact Score: how badly this CMDB state affects AI agent accuracy

### FR-03: Knowledge Base Gap Analyzer
- Metrics:
  - Empty articles: content field null or <50 chars
  - Outdated: last updated >730 days
  - Unattached: no category, no views in 180 days
  - Duplicate: title similarity >85%
  - Missing: top search queries with 0 results
- Output: `x_snc_ard_kb_health` record with Knowledge Readiness %

### FR-04: AI Agent Simulator
- For each workflow: dry-run Otto/Now Assist behavior
- Inputs consumed: workflow definition + CMDB state + KB articles + user context
- Simulate: "Otto receives trigger → queries CMDB for CI → searches KB for resolution → executes action → updates record"
- Identify failure points: missing CI, no KB article, insufficient permissions, ambiguous intent
- Output: `x_snc_ard_simulation_result` with pass/fail + failure reason

### FR-05: Remediation Roadmap Generator
- Aggregate all findings into prioritized list
- Priority scoring: AI Impact × Workflow Frequency × Fix Complexity⁻¹
- Quick wins: fixes taking <2 hours that unblock 3+ AI flows
- Timeline: 30-day / 90-day / 6-month phases
- Effort estimate per item (story points or hours)

### FR-06: Executive Dashboard
- Readiness Score gauge (0-100)
- Breakdown: Workflow Health %, CMDB Health %, KB Health %, Integration Readiness %
- Trend line (weekly snapshots)
- "Biggest Blocker" widget — single most impactful fix

## Non-Functional Requirements

| Category | Requirement |
|----------|------------|
| Performance | Full diagnostic <5 min for instances with <1,000 workflows |
| Accuracy | >90% detection rate for known broken workflow patterns |
| Security | Read-only access to platform tables; no cross-scope writes |
| Scalability | Handle 5,000+ workflows, 100K+ CIs, 10K+ KB articles |
| Compatibility | Zurich through Australia releases |

## Scope

### MVP (v1.0)
- FR-01: Workflow Scanner (broken + silent failure detection)
- FR-02: CMDB Health (completeness + duplicates)
- FR-03: KB Analyzer (empties + outdated)
- FR-06: Dashboard with Readiness Score
- US-01 through US-05

### v1.1
- FR-04: AI Simulator
- FR-05: Roadmap Generator
- US-06, US-07

### v2.0
- Trend data, quick wins, PDF export
- US-08, US-09, US-10

## Success Metrics

**North Star:** AI Pilot Success Rate — % of customers who achieve target ROI on Otto/Now Assist after using the Diagnostic.

**KPIs:**
1. Readiness Score improvement: avg +25 points from first scan to go-live
2. Broken workflow closure: >80% of critical findings resolved before AI pilot
3. CMDB completeness: +30% improvement after following recommendations
4. Diagnostic-to-pilot time: <90 days (vs 12+ months industry average)
5. Customer retention: >90% annual renewal
