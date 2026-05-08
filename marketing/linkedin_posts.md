# LinkedIn Posts — ServiceNow AI Migration Architect

## Post 1 (Russian) — Announcement

🚀 Мы построили инструмент, который за 5 минут делает то, на что у архитектора уходит 2 недели.

ServiceNow AI Migration Architect — Python-приложение, которое:
• Подключается к вашему инстансу ServiceNow
• Автоматически анализирует ВСЕ catalog items, workflow, скрипты и историю запросов
• Генерирует полный пакет документов для миграции на AI-агентов

Проверено на реальном PDI: **197 catalog items, 6 workflows, 11 интеграций, 4,765 script includes, 5,654 business rules** — полный анализ за секунды.

Что на выходе:
✅ Executive Summary для CTO (на русском)
✅ Terms of Reference (ТЗ)
✅ Техническая спецификация с архитектурными диаграммами
✅ Анализ каждого workflow (health score 0-100, readiness)
✅ Топология AI-агентов под каждый процесс
✅ Поэтапный план миграции (5 фаз, ~20 недель)
✅ Реестр рисков (12 рисков, 6 категорий, L×I scoring)
✅ План обучения по ролям

Почему это важно сейчас:
ServiceNow Australia release — AI Agent Studio уже в продакшене. Enterprise-компании получают 40-55% deflection rate и ROI 5-8 месяцев. Главный вопрос — «с чего начать?». Наш инструмент отвечает на него за минуты, а не недели.

**88 passing tests.** Open source (AGPL-3.0). Commercial licensing available.

Интересно потестировать на своем инстансе? 👇

#ServiceNow #AIAgents #EnterpriseAutomation #DigitalTransformation #ServiceCatalog

---

## Post 2 (English) — Technical deep-dive + real metrics

I built a tool that connects to your ServiceNow instance and generates a complete AI agent migration blueprint.

**Verified on a real PDI (May 8, 2026):** 197 catalog items, 6 workflows, 11 REST integrations, 4,765 script includes, 5,654 business rules — full analysis pipeline in seconds.

Here's what happens under the hood:

**Phase 1 — Discovery (parallel async httpx crawlers):**
• sc_cat_item → all catalog items with variables
• wf_workflow → workflow definitions + activity trees
• sys_script_include → script includes audit (4,765 found)
• sys_script → business rules analysis (5,654 found)
• sys_rest_message → integration mapping (11 active integrations)
• sc_req_item → historical request stats (SLA breaches, fulfillment time)

**Phase 2 — Analysis (4 engines):**
• Workflow Health — 0-100 score per workflow (complexity, manual steps, approvals, timers, SLA)
• Script Auditor — finds GlideRecord patterns needing REST refactoring
• Bottleneck Finder — ranks by pain (SLA breaches × volume × manual steps)
• Integration Mapper — categorizes Azure AD, Slack, Jira, Okta, AWS, SAP, Datadog + Firebase, Yahoo Finance

**Phase 3 — Generation (Jinja2 + analysis):**
• AI agent topologies per workflow (Mermaid diagrams)
• 5-phase roadmap: Foundation → Quick Wins → Core → Advanced → Optimization
• Risk register: 12 risks, L×I scoring, detailed mitigations
• Role-based training: end users, approvers, admins

Built with Python 3.11+, httpx, Pydantic v2, Typer, Rich, Jinja2.
**88/88 tests passing.** AGPL-3.0. Commercial licensing available.

All ServiceNow terminology verified against official Australia release docs (ServiceNowDocs repo). No hallucinations.

#ServiceNow #AI #Automation #Python #EnterpriseArchitecture

---

## Post 3 (Russian) — Реальные цифры и контекст

Факты из практики (май 2026):

• Протестировано на реальном ServiceNow PDI: **197 catalog items, 6 workflows, 11 интеграций**
• ServiceNow Australia release: AI Agent Studio, Now Assist skills, Generative AI Controller
• Enterprise кейсы: deflection rate 40-55%, ROI 5-8 месяцев, MTTR с часов до минут
• Platform agentic workflows: classify tasks, generate resolution plans, investigate problems, analyze trends

Главные инсайты из community:
«Не автоматизируйте сломанный процесс — сначала оптимизируйте»
«Начинайте с топ-20 catalog items — это 80% объема»
«Чистите Knowledge Base минимум 3 месяца перед AI-запуском»
«Оставьте Service Catalog как fallback — пользователи не простят, если чат медленнее формы»

Мы встроили все эти принципы в наш инструмент. Он не просто генерирует документы — он подсвечивает проблемные workflow ДО миграции.

**88 тестов, всё зелёное.**

#ServiceNow #AITransformation #EnterpriseIT #Automation

---

## Post 4 (English) — The architect's perspective

As an enterprise architect, I've seen the pattern repeat:

Company buys ServiceNow → builds 500 catalog items → years of custom scripts → now wants AI agents

The question is never "should we?" — it's "where do we start?"

Enter ServiceNow AI Migration Architect:

```
$ sn-ai-migrator generate
```

1 command. 5 minutes. Complete migration blueprint.

Output:
📄 Executive Summary (CTO-ready)
📄 Technical Specification with architecture diagrams
📄 Per-workflow AI agent topology (orchestrator, approval, provisioning agents)
📄 5-phase roadmap with success criteria and rollback plans
📄 Risk Register (12 risks, L×I scored, with mitigations)
📄 Training Plan by role (end users, approvers, admins)

**Verified on a real ServiceNow PDI with 197 items, 6 workflows, 11 integrations, 4,765 scripts.**

The tool doesn't replace the architect — it eliminates the grunt work so the architect can focus on decisions that matter.

Open source (AGPL-3.0). Commercial licensing available.
88/88 tests passing.

#EnterpriseArchitecture #ServiceNow #AI #DigitalTransformation
