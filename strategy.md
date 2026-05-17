# strategy.md — ServiceNow AI Migration Products
## Version: 5.0 — Hard Reset (thread_id: v5-2026-05-16, timestamp: 2026-05-16T21:22:00Z)

---

### Policy
- Products with `status: ARCHIVED_LEGACY` are **dead** — they do not participate in the build cycle.
- New thread_id is generated on each major reset. Previous context (181k tokens) is ignored per user directive [403, история].
- License: AGPL-3.0. Copyright: Vladimir Kapustin (owner of IP vladarchitect).
- All commits must use full name in message: "ServiceNow [Full Name] ([ID])".
- No approval requests. Build until daily limits exhausted.

---

### Archived Legacy Products (ID 3–8, ADIS/BYOK duplicates)
| ID | Name | Status | Note |
|---|---|---|---|
| 3 | ServiceNow ADIS | ARCHIVED_LEGACY | Duplicate of Instance Scan |
| 4 | ServiceNow BYOK | ARCHIVED_LEGACY | Merged into Generative AI Controller |
| 5 | ServiceNow CMDB Health | ARCHIVED_LEGACY | Superseded by Australia metrics |
| 6 | ServiceNow Migration Analyzer | ARCHIVED_LEGACY | Redundant with new Zurich APIs |
| 7 | ServiceNow Test Automator | ARCHIVED_LEGACY | Australia Studio covers this |
| 8 | ServiceNow KB Optimizer | ARCHIVED_LEGACY | Now Assist KB handles natively |
| — | Any ADIS/BYOK prefix | ARCHIVED_LEGACY | Auto-archived via honcho.py |

---

### Pipeline Stages (v5.0)
1. **Research** — browser_researcher.py discovers pains + APIs via Reddit, StackOverflow, Community, Docs.
2. **Strategy** — top findings written to this file + honcho.db.
3. **Planner** (Qwen-3.6 Max, num_predict=16384) — SOP with 10+ tests per product.
4. **Executor** (DeepSeek V4 Pro) — AGPL-3.0 code generation.
5. **Push** — auto commit + GitHub release with full name.

---

### Release Focus
- **Primary**: Zurich (latest stable)
- **Secondary**: Australia (new APIs, AI Agent Studio, Now Assist Skills)

---

### Research Methodology
- **Sources**: Reddit r/servicenow, StackOverflow (tagged servicenow), ServiceNow Community, GitHub issues, YouTube comments, job descriptions.
- **Keywords**: problem, issue, manual, workaround, how to automate, pain, migration, deprecated, breaking change, limitation.
- **Scoring**: pain + value + source credibility. Dedup by title similarity.

---

### Current Active Queue (TOP-5 from Research Cycle 1)

#### 1. SN Guardian (ID: 3) — ServiceNow Guarded Script Migration Tool
**Release:** ZURICH  
**Status:** QUEUED  
**Pain Source:** Reddit r/servicenow (KB2944435, KittyScript enforcement)  
**Pain Summary:** Breaking: Guarded Script enforces in Zurich Patch 9 / Australia Patch 2. Complex server-side JavaScript in filters, default values, AMB/RecordWatcher conditions is blocked. Admins must refactor logic into Script Includes or create exemptions before Phase 3 auto-enforcement on cloud instances (~4 weeks). On-prem requires manual phase advancement.  
**Product Potential:** Automated scanner of all guarded scripts across instance, generates migration report with Script Include stubs, auto-creates exemptions where migration is impossible.  
**Affected Modules:** All server-side sandbox scripts (UI policies, catalog client scripts, custom scripts, business rules).  
**Key API:** GlideGuardedScript.resetToPhase1(), advanceToPhase2(), advanceToPhase3()  
**Target Users:** ServiceNow admins preparing for Zurich Patch 9+ / Australia Patch 2+.

#### 2. SN NowAssist Optimizer (ID: 4) — ServiceNow Now Assist Performance Optimizer
**Release:** AUSTRALIA  
**Status:** QUEUED  
**Pain Source:** Reddit r/servicenow (tier-1 deflection failure)  
**Pain Summary:** Now Assist purchased for Tier-1 deflection (access requests, password resets, app provisioning) but acts as a slightly smarter Virtual Agent. KB answers too generic or wrong; employees abandon after two weeks and return to Slack DMs. No native tooling to audit deflection rate, KB coverage gaps, skill routing accuracy.  
**Product Potential:** Dashboard + audit engine: measures actual deflection rate, maps KB article gaps by intent, tracks skill routing accuracy, identifies low-confidence conversations for human review.  
**Affected Modules:** Now Assist for ITSM / HRSD / CSM, Virtual Agent, Knowledge Management.  
**Key API:** Now Assist analytics API (SN), Virtual Agent conversation logs, KB search scoring.  
**Target Users:** ServiceNow platform owners, AI team leads, KM managers.

#### 3. SN AI Agent Validator (ID: 5) — ServiceNow AI Agent Readiness Validator
**Release:** AUSTRALIA  
**Status:** QUEUED  
**Pain Source:** Reddit r/servicenow (broken AI Agents OOTB)  
**Pain Summary:** Organizations testing new AI Agents (Zurich/Australia timeframe) report many agents shipped broken and not useful in real workflows. Teams struggle to find viable use cases and encounter broken out-of-the-box agents. No validation framework exists for agent readiness.  
**Product Potential:** Automated validator: checks agent configuration completeness, skill binding integrity, role masking compliance, A2A Protocol compliance, data readiness (CMDB quality, KB coverage), pre-flight simulation.  
**Affected Modules:** AI Agent Studio, AI Agent Advisor, Workflow Studio, Now Assist Skills.  
**Key API:** AI Agent Studio metadata, A2A Protocol spec, role masking ACLs, Access Analyzer v6.1.  
**Target Users:** AI platform architects, ServiceNow release managers, compliance teams.

#### 4. SN Platform Analytics Migrator (ID: 6) — ServiceNow Platform Analytics Migration Assistant
**Release:** AUSTRALIA  
**Status:** QUEUED  
**Pain Source:** Reddit r/servicenow (Platform Analytics regression)  
**Pain Summary:** Migration from Performance Analytics to Platform Analytics broke drilldown views, removed Ctrl+click to open records in new tabs, broke column sorting/search. Scheduled Reports lost Insert and Stay / Duplicate actions. Executive Dashboards must be rebuilt. Migration Center exists but is manual and error-prone.  
**Product Potential:** Assisted migration tool: scans existing Performance Analytics widgets/dashboards, auto-generates Platform Analytics equivalents, preserves drilldown logic, maps scheduled report configurations, validates migrated dashboards.  
**Affected Modules:** Platform Analytics, Performance Analytics, Next Experience Dashboards, KPI Composer.  
**Key API:** Platform Analytics Migration Center API, dashboard/widget metadata, PA export/import.  
**Target Users:** ServiceNow reporting teams, BI administrators, platform owners.

#### 5. SN A2A Bridge (ID: 7) — ServiceNow A2A Protocol Integration Bridge
**Release:** AUSTRALIA  
**Status:** QUEUED  
**Pain Source:** ServiceNow Docs (Australia Patch 1)  
**Pain Summary:** Australia introduces A2A Protocol for external agents but deprecated manual external agent integration starting Patch 1. Organizations with existing manual/external integrations need migration path. No automated tool exists to validate A2A compliance or migrate existing integrations.  
**Product Potential:** Bridge tool: scans existing external agent integrations, generates A2A Protocol equivalent configurations, validates protocol compliance, tests agent-to-agent communication, maintains backward compatibility layer during transition.  
**Affected Modules:** AI Agent Studio, Integrations, ServiceNow Store apps.  
**Key API:** A2A Protocol spec, AI Agent Studio API, external agent webhook endpoints.  
**Target Users:** Integration architects, AI platform teams, ServiceNow ecosystem developers.

---

### Stop Conditions
- Empty research queue → trigger recursive research.
- Daily token/CPU limit reached → pause gracefully, resume on next cron tick.
- Build attempts > 3 → mark REJECTED, log, move on.

---

### Build Order (Priority)
1. SN Guardian — highest urgency (Phase 3 enforcement ~4 weeks)
2. SN NowAssist Optimizer — immediate ROI (deflection audit)
3. SN AI Agent Validator — Australia readiness
4. SN Platform Analytics Migrator — Zurich→Australia upgrade path
5. SN A2A Bridge — protocol compliance
