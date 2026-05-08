# LinkedIn Posts — ServiceNow AI Migration Architect

## Post 1 — Product Launch (main LinkedIn post)

I built a tool that connects to your ServiceNow instance and generates a complete AI agent migration blueprint in 5 minutes.

Verified on a real PDI (dev362840, May 2026):
→ 197 catalog items · 6 workflows · 11 REST integrations
→ 4,765 script includes · 5,654 business rules
→ Full analysis pipeline in seconds

Here's what it produces:

📄 Executive Summary (CTO-ready)
📋 Terms of Reference — scope, objectives, success metrics
⚙️ Technical Specification — current → target architecture with Mermaid diagrams
🤖 AI Agent Topology per workflow — orchestrator, approval, provisioning, notification, escalation agents
🗺️ 5-Phase Roadmap — Foundation → Quick Wins → Core → Advanced → Optimization
⚠️ Risk Register — 12 risks, L×I scoring, mitigations (API rate limits, auth expiry, hallucination, audit trail gaps…)
🎓 Role-Based Training Plan — end users, approvers, admins

Why this matters now:
ServiceNow Australia release ships AI Agent Studio in production. Enterprise numbers are real — 40–55% deflection rate, 5–8 month ROI. The bottleneck isn't the technology. It's the analysis: "which workflows are ready? which scripts will break? what's the safe migration sequence?"

This tool answers all of it automatically.

Built with Python 3.11+, async httpx, Pydantic v2, Jinja2, Typer + Rich.
88/88 tests passing ✅
AGPL-3.0 — commercial licensing available.

The tool doesn't replace the architect. It eliminates the grunt work so the architect can focus on decisions that matter.

Repo: github.com/vladarchitectservicenow-oss/service-catalog-ai-migrator

#ServiceNow #AIAgents #EnterpriseArchitecture #Automation #Python #DigitalTransformation

---

## Post 2 — Technical Deep-Dive (2-3 days later)

Here's exactly what happens when you run `sn-ai-migrator generate` against a real ServiceNow instance:

Phase 1 — Discovery (parallel async httpx crawlers):
sc_cat_item → all 197 catalog items with variables
wf_workflow → 6 workflow definitions + full activity trees
sys_script_include → 4,765 script includes audited
sys_script → 5,654 business rules analyzed
sys_rest_message → 11 active integrations mapped
sc_req_item → historical request stats with SLA data

Phase 2 — Analysis (4 engines):
Workflow Health Scorer — 0-100 per workflow (complexity, manual steps, approvals, timers)
Script Auditor — finds GlideRecord patterns needing REST refactoring
Bottleneck Finder — ranks workflows by pain (SLA breaches × volume × manual steps)
Integration Mapper — categorizes all external connections with risk scores

Phase 3 — Generation:
AI agent topologies per workflow with Mermaid.js diagrams
5-phase roadmap: Foundation (2w) → Quick Wins (4w) → Core (8w) → Advanced (6w) → Continuous Optimization
Risk register: 12 risks, L×I matrix, heat map, actionable mitigations
Role-based training: end users, approvers, administrators

The discovery layer alone would take an architect 2-3 days. The analysis — another week. The document generation — another week.

This tool does it in 5 minutes. On real instance data. With 88 passing tests.

All ServiceNow terminology verified against official Australia release docs (ServiceNowDocs repository). No AI-generated feature names. No hallucinations.

#ServiceNow #AI #Automation #Python #EnterpriseArchitecture

---

## Post 3 — The Business Case (1 week later)

ServiceNow spent $10B+ on AI M&A in 18 months. Moveworks for $3B. Armis for $7.75B. They're not betting on AI — they're all-in.

The Australia release ships AI Agent Studio in production. Enterprise customers are hitting 40-55% deflection rates with 5-8 month ROI. The technology works.

But here's what nobody talks about: the analysis bottleneck.

Every ServiceNow instance has years of accumulated workflows, scripts, catalog items, and integrations. Before you can deploy a single AI agent, you need to answer:

— Which of my 197 catalog items are AI-ready?
— Which scripts will break when an agent calls them?
— What's the safe migration sequence?
— Which integrations are stable enough for autonomous orchestration?

This analysis takes architects 2-4 weeks. Per instance.

I built a tool that does it in 5 minutes.

It connects to your ServiceNow instance, discovers everything, analyzes workflow health, scripts, bottlenecks, and integrations — then generates a complete AI agent migration blueprint.

Open source. AGPL-3.0. 88 tests. Real PDI-verified metrics.

github.com/vladarchitectservicenow-oss/service-catalog-ai-migrator

#ServiceNow #AI #DigitalTransformation #ROI #EnterpriseIT

---

## Post 4 — Lessons Learned (2 weeks later)

Building an AI migration tool for ServiceNow taught me a few things:

1. Official documentation matters. ServiceNow has a dedicated repo (ServiceNowDocs) with LLM-optimized docs. The actual product names are "AI Agent Studio" (not "Agent Studio"), "Generative AI Controller" (not "GenAI Controller"), "Now Assist skills" (not "Skill Kit"). Getting terminology right is the difference between credibility and looking like you made it up.

2. Real data beats demos. I tested against a real PDI with 197 catalog items, 6 workflows, 11 integrations, and thousands of scripts. The tool found actual bottlenecks — not theoretical ones. Demo data doesn't teach you anything.

3. AGPL-3.0 is the right license for AI tools. If someone uses your code to build a SaaS product, they must open-source their changes. It protects your IP while still letting the community learn from your work.

4. The gap isn't AI capability — it's analysis. ServiceNow's AI platform is production-ready. The hard part is knowing where to apply it. That's what this tool solves.

Open to feedback, contributors, and commercial licensing inquiries.

github.com/vladarchitectservicenow-oss/service-catalog-ai-migrator

#ServiceNow #OpenSource #AI #SoftwareEngineering #LessonsLearned
