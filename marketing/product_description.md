# Product Description — ServiceNow AI Migration Architect

## One-liner (для шапки профиля)

Автоматический анализ ServiceNow и генерация плана миграции на AI-агентов за 5 минут вместо 2 недель.

## Short Description (для GitHub/Product Hunt)

ServiceNow AI Migration Architect — open-source CLI tool that connects to your ServiceNow instance, auto-discovers all catalog items, workflows, scripts, and history, then generates a complete AI agent migration blueprint: executive summary, TOR, technical specs with Mermaid diagrams, per-workflow agent architecture, phased roadmap, risk register, and training plan.

Built for enterprise architects who need to answer "where do we start with AI agents?" — not in weeks, but in minutes.

## Long Description (для website/docs)

### The Problem

Your organization has invested years building ServiceNow workflows. Now ServiceNow Yokohama ships AI Agents in production. The CTO wants AI automation. But you have 500+ catalog items, hundreds of custom scripts, and decades of accumulated process logic. Where do you start? Which workflows are ready for AI agents? Which scripts will break? What's the migration sequence that minimizes production risk?

Answering these questions manually takes architects 2-4 weeks of analysis per instance.

### The Solution

ServiceNow AI Migration Architect answers all these questions in 5 minutes.

Connect it to your instance, run one command, and get a complete migration blueprint:

```
sn-ai-migrator generate
```

### What It Does

**Discovery** — Parallel async crawlers fetch everything:
- Catalog items with variables and workflow bindings
- Workflow definitions with full activity trees
- Script includes and business rules
- REST integrations and external system connections
- Historical request data with SLA statistics

**Analysis** — Four analysis engines:
- Workflow Health Scorer: 0-100 score per workflow based on complexity, manual steps, approvals, timers, and SLA breach history
- Script Auditor: Finds GlideRecord patterns needing REST refactoring, hardcoded IDs, sync HTTP calls, ES5 patterns
- Integration Mapper: Categorizes all external system connections (LDAP, email, ERP, cloud APIs) with risk assessment
- Bottleneck Finder: Ranks workflows by "pain score" (SLA breaches × volume × manual steps)

**Generation** — Six document generators:
- Executive Summary (CTO-ready)
- Terms of Reference (project scope, objectives, success metrics)
- Technical Specification (current/target architecture with Mermaid diagrams)
- AI Agent Architecture per workflow (orchestrator, approval, provisioning, notification, escalation agents)
- 5-Phase Migration Roadmap (Foundation → Quick Wins → Core → Advanced → Optimization)
- Risk Register (12 risks across technical, operational, organizational, security, data categories)
- Role-Based Training Plan (end users, approvers, administrators)

### Technical Stack

- Python 3.11+ with async httpx for parallel data fetching
- Pydantic v2 for type-safe data models throughout
- Jinja2 templating for document generation
- Typer + Rich for polished CLI experience
- LLM integration for qualitative narrative enhancement
- 88 integration tests with mock ServiceNow server

### Context (May 2026)

Built with real-world enterprise data:
- ServiceNow Yokohama: AI Agents in production, Agent Studio, Now Assist Skill Kit
- Enterprise metrics: 40-55% deflection rate, ROI in 5-8 months
- Community best practices embedded: start top-20 items, clean KB before AI, keep catalog as fallback
- Licensing awareness: Now Assist ~$75-100/user/month, break-even at 23% deflection

### Who Is This For

- Enterprise Architects planning ServiceNow → AI agent migration
- ServiceNow Practice Leads scoping transformation projects
- IT Directors who need data to justify AI investment
- Consultants who want to deliver migration assessments faster
