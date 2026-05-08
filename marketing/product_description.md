# Product Description — ServiceNow AI Migration Architect

## One-liner

Automated ServiceNow instance analysis and full AI agent migration plan generation — 5 minutes instead of 2 weeks.

## Short Description

ServiceNow AI Migration Architect is an open-source CLI tool that connects to your ServiceNow instance, auto-discovers all catalog items, workflows, scripts, and history, then generates a complete AI agent migration blueprint: executive summary, TOR, technical specs with architecture diagrams, per-workflow AI agent topology, phased roadmap, risk register, and training plan.

Built for enterprise architects who need to answer "where do we start with AI agents?" — not in weeks, but in minutes.

## The Problem

Your organization has invested years building ServiceNow workflows. Now ServiceNow Australia release ships AI Agents with **AI Agent Studio** — a production-grade agentic AI platform. The CTO wants AI automation. But you have 500+ catalog items, hundreds of custom scripts, and decades of accumulated process logic. Where do you start? Which workflows are ready for AI agents? Which scripts will break? What's the migration sequence that minimizes production risk?

Answering these questions manually takes architects 2-4 weeks of analysis per instance.

## The Solution

ServiceNow AI Migration Architect answers all these questions in 5 minutes.

Connect it to your instance, run one command, and get a complete migration blueprint:

```
sn-ai-migrator generate
```

## What It Does

**Discovery** — Parallel async crawlers fetch everything:
- Catalog items with variables and workflow bindings
- Workflow definitions with full activity trees
- Script includes and business rules
- REST integrations and external system connections
- Historical request data with SLA statistics

**Analysis** — Four analysis engines:
- Workflow Health Scorer — 0-100 score per workflow based on complexity, manual steps, approvals, timers, and SLA breach history
- Script Auditor — Finds GlideRecord patterns needing REST refactoring, hardcoded IDs, sync HTTP calls, ES5 patterns
- Integration Mapper — Categorizes all external system connections with risk assessment
- Bottleneck Finder — Ranks workflows by "pain score" (SLA breaches × volume × manual steps)

**Generation** — Seven document generators:
- Executive Summary (CTO-ready)
- Terms of Reference (project scope, objectives, success metrics)
- Technical Specification (current/target architecture with diagrams)
- AI Agent Architecture per workflow (orchestrator, approval, provisioning, notification, escalation agents)
- 5-Phase Migration Roadmap (Foundation → Quick Wins → Core → Advanced → Optimization)
- Risk Register (12 risks across technical, operational, organizational, security, data, financial categories)
- Role-Based Training Plan (end users, approvers, administrators)

## Verified Instance Metrics (dev362840 — May 8, 2026)

Verified on a real ServiceNow Personal Developer Instance:

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
1. Password Reset - Self Service — HIGH readiness
2. Software License Provisioning — HIGH readiness
3. Laptop Request Approval — HIGH readiness
4. VM Provisioning — MEDIUM readiness
5. New Hire Onboarding — MEDIUM readiness
6. Access Card Issuance — MEDIUM readiness

**11 Active Integrations:** Azure AD User Sync, Slack Notification Service, Jira ITSM Integration, Okta SSO Provisioning, AWS Account Factory, SAP ERP - Purchase Orders, Datadog Monitoring Webhook, Yahoo Finance, Firebase Cloud Messaging V1, Firebase Cloud Messaging Send, ServiceNowMobileApp Push

## ServiceNow AI Platform Landscape (verified from official docs — Australia release)

Based on the **Australia release** (latest as of May 2026) — ServiceNow's AI platform for business transformation. All terminology verified against the official ServiceNowDocs repository (github.com/ServiceNow/ServiceNowDocs, Australia branch).

### Core AI Components (Australia)

| Component | Official Name | Description |
|---|---|---|
| AI Agent Builder | **AI Agent Studio** | Low-code guided setup to create, manage, and test AI agents and agentic workflows. Tool binding, human-in-the-loop rules. |
| AI Building Blocks | **Now Assist skills** | Discrete, reusable GenAI capabilities: summarization, content generation, record analysis, recommendations. |
| Agent Orchestrations | **Agentic workflows** | AI-driven multi-agent orchestrations using one or more AI agents. Dynamic planning, execution, adaptation based on context. |
| LLM Integration | **Generative AI Controller** | Integrates third-party LLMs via BYOK (Bring Your Own Key): Azure OpenAI, Amazon Bedrock, Google Vertex AI, IBM watsonx. Generic LLM connector for custom providers. |
| AI Governance | **Generative AI Controller** | Centralized prompt management, model routing, guardrails, audit trail. Now Assist Guardian: offensiveness detection + prompt injection blocking. |
| Workflow Engine | **Workflow Studio** | Unified interface: flows, subflows, actions, playbooks, decision tables. Agentic Playbooks for AI-driven activities. |
| Platform AI Agents | **Platform AI agents** (4 built-in) | Approval assistance, Issue Readiness, Request status, Domain Separation. |
| Agent Learning | AI agent episodic + long-term memory | Agents learn from past successful interactions. LTM categories define what agents learn about users. |
| Security | Role masking, Now Assist Guardian | Least-access privileges during tool execution. Offensive content detection, prompt injection blocking. |

### Platform Agentic Workflows (Australia release)

- **Analyze task trends** — detect recurring patterns, predict disruptions, recommend proactive actions
- **Classify tasks** — auto-triage: update fields, sentiment analysis, summarization
- **Generate my work plan** — personalized plan based on current + historical work
- **Generate resolution plan** — analyze tasks, generate resolution summaries, update work notes
- **Help optimize team productivity** — allocate work based on historical performance
- **Identify ways to improve service** — analyze feedback + metrics, recommend improvements
- **Investigate problems** — root cause analysis + actionable resolution plan

### Third-Party LLM Providers (Generative AI Controller — BYOK)

Per official docs: Azure OpenAI, Amazon Bedrock (Claude, Llama), Google AI Studio / Vertex AI (Gemini), IBM watsonx (Granite), OpenAI direct API, Generic LLM connector (any OpenAI-compatible API).

## Who Is This For

- Enterprise Architects planning ServiceNow → AI agent migration
- ServiceNow Practice Leads scoping AI transformation projects
- IT Directors who need data to justify AI investment
- Consultants who deliver migration assessments faster

## Technical Stack

- Python 3.11+ with async httpx for parallel data fetching
- Pydantic v2 for type-safe data models throughout
- Jinja2 templating for document generation
- Typer + Rich for polished CLI experience
- **88 passing tests** with mock ServiceNow server (verified May 8, 2026)
- WeasyPrint for professional PDF generation
- AGPL-3.0 licensed (commercial use requires separate license)

## Context (May 2026)

Built with real data from a production-style ServiceNow PDI and official Australia release docs:
- **197 catalog items** (147 active), **6 workflows**, **11 integrations**, **4,765** script includes, **5,654** business rules
- ServiceNow Australia: AI Agent Studio, Now Assist skills, agentic workflows in production
- Generative AI Controller with BYOK: Azure OpenAI, Bedrock, Vertex AI, watsonx
- Proven enterprise metrics: deflection 40-55%, ROI 5-8 months
- Community best practices: start top-20 items, clean KB 3+ months before AI, keep Service Catalog as fallback
