# ServiceNow AI Migration Architect

An automated CLI tool that connects to your ServiceNow instance, discovers all catalog items, workflows, scripts, and history, then generates a complete AI agent migration blueprint — in 5 minutes instead of 2 weeks.

## Commands

```
sn-ai-migrator discover  — connects to SN instance, fetches everything (catalog, workflows, scripts, history)
sn-ai-migrator analyze   — analyzes: workflow health, script audit, bottlenecks, integration mapping
sn-ai-migrator generate  — generates the full document package in output/
```

## Output Package

```
output/
├── 00_executive_summary.md        # Executive Summary (CTO-ready)
├── 01_terms_of_reference.md       # Terms of Reference — scope, objectives, success metrics
├── 02_technical_specification.md  # Technical Specification with architecture diagrams
├── 03_workflow_analysis/          # Per-workflow analysis (health score, readiness)
├── 04_agent_architectures/        # AI agent topology per workflow
├── 05_migration_roadmap.md        # Phased migration plan (5 phases, ~20 weeks)
├── 06_risk_register.md            # Risk register (12 risks, 6 categories, L×I scoring)
├── 07_training_plan.md            # Role-based training plan
└── 08_appendices/                 # JSON exports (discovery, analysis, roadmap, risks)
```

## How It Works

### Phase 1 — Discovery (parallel async queries)
- `sc_cat_item` — all catalog items with variables
- `wf_workflow` — workflow definitions with activity trees
- `sys_script_include` — server-side script includes
- `sys_script` — business rules
- `sys_rest_message` — external REST integrations
- `sc_req_item` — historical request data (SLA, fulfillment time)

### Phase 2 — Analysis (4 engines)
- **Workflow Health Scorer** — 0-100 score: complexity, manual steps, approvals, timers, SLA metrics
- **Script Auditor** — finds GlideRecord patterns needing REST refactoring, hardcoded IDs, sync HTTP calls
- **Integration Mapper** — categorizes external connections with risk assessment
- **Bottleneck Finder** — ranks workflows by pain score (SLA breaches × volume × manual steps)

### Phase 3 — Generation (Jinja2 + analysis)
- **Executive Summary** — CTO-ready: metrics, readiness, Quick Wins
- **Terms of Reference** — scope, objectives, success metrics
- **Technical Specification** — current/target architecture with diagrams
- **AI Agent Architecture** — agent topology per workflow (orchestrator, approval, provisioning, notification, escalation agents)
- **5-Phase Migration Roadmap** — Foundation → Quick Wins → Core Migration → Advanced AI → Optimization (~20 weeks)
- **Risk Register** — 12 risks across 6 categories with likelihood × impact scoring and mitigations
- **Training Plan** — by role: end users, approvers, administrators

## Verified Instance Metrics (dev362840 — May 8, 2026)

| Resource | Count |
|---|---|
| Catalog Items (total) | **197** |
| Catalog Items (active) | **147** |
| Workflows | **6** |
| Integrations (sys_rest_message) | **11** |
| Script Includes | **4,765** |
| Business Rules | **5,654** |
| Requests (sc_request) | **13** |
| Request Items (sc_req_item) | **5** |
| Categories | **45** |

**6 Workflows discovered:**
1. Laptop Request Approval
2. Password Reset - Self Service
3. VM Provisioning
4. Software License Provisioning
5. New Hire Onboarding
6. Access Card Issuance

**11 Active Integrations:** Azure AD User Sync, Slack Notification Service, Jira ITSM Integration, Okta SSO Provisioning, AWS Account Factory, SAP ERP - Purchase Orders, Datadog Monitoring Webhook, Yahoo Finance, Firebase Cloud Messaging V1, Firebase Cloud Messaging Send, ServiceNowMobileApp Push

## ServiceNow AI Platform (Australia Release — May 2026)

Built on verified information from official ServiceNow documentation (ServiceNowDocs, Australia branch):

| Component | Official Name | Function |
|---|---|---|
| Agent Builder | **AI Agent Studio** | Low-code guided setup to create, manage, and test AI agents and agentic workflows |
| AI Skills | **Now Assist skills** | Reusable GenAI capabilities: summarization, generation, record analysis |
| Agent Orchestration | **Agentic workflows** | Multi-agent AI-driven orchestrations with dynamic planning and adaptation |
| LLM Integration | **Generative AI Controller** | BYOK (Bring Your Own Key): Azure OpenAI, Amazon Bedrock, Google Vertex AI, IBM watsonx |
| Governance | **Generative AI Controller** | Guardrails, audit trail, rate limiting, Now Assist Guardian (offensiveness + prompt injection detection) |
| Workflow Engine | **Workflow Studio** | Unified environment: flows, subflows, actions, playbooks, decision tables |
| Platform Agents | **Platform AI agents** (4 built-in) | Approval assistance, Issue Readiness, Request status, Domain Separation |
| Agent Memory | AI agent learning | Episodic + long-term memory (LTM categories) |
| Security | Role masking, Now Assist Guardian | Least-access privileges during agent tool execution |

### Platform Agentic Workflows (Australia)

- **Analyze task trends** — detect recurring patterns, predict disruptions, recommend proactive actions
- **Classify tasks** — auto-triage: update fields, sentiment analysis, summarization
- **Generate my work plan** — personalized plan based on current + historical work
- **Generate resolution plan** — analyze tasks, generate resolution summaries, update work notes
- **Help optimize team productivity** — allocate work based on historical performance
- **Identify ways to improve service** — analyze feedback + metrics, recommend improvements
- **Investigate problems** — root cause analysis + actionable resolution plan

## License & Commercial Use

**AGPL-3.0** — a strong protective copyleft license. What this means:

- ✅ You may clone, study the code, and fork the project
- ✅ You may use it internally within your organization
- ❌ **Prohibited** from use in commercial products and SaaS without a separate paid license
- ❌ **Prohibited** from selling, redistributing as part of proprietary software
- ⚠️ All derivative works MUST be open-sourced under the same AGPL-3.0 (copyleft)

**Want to use this in a commercial project?**

Contact me for a commercial license:
📧 [your email]
💼 [LinkedIn profile]

### Intellectual Property Protection

The project is protected by a combination of legal and technical measures. Full guide: [IP Protection Guide](marketing/ip_protection_guide.md)

---

## Quick Start

1. Clone the repository
2. Copy `config.example.yaml` → `config.yaml` and fill in your credentials
3. Install dependencies: `pip install -e ".[dev]"`
4. Run: `sn-ai-migrator discover && sn-ai-migrator analyze && sn-ai-migrator generate`

## Verified Documentation Sources

- ServiceNowDocs (Australia branch) — official ServiceNow documentation, optimized for LLM consumption: https://github.com/ServiceNow/ServiceNowDocs
- Files indexed via llms.txt (raw.githubusercontent.com/ServiceNow/ServiceNowDocs/australia/llms.txt)
- Documentation refreshed at least monthly
- Last verified: 2026-05-08

## License

**GNU AGPL-3.0** — see [LICENSE](./LICENSE). Commercial use requires a separate paid license.
