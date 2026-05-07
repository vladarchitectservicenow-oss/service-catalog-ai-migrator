# LinkedIn Posts — ServiceNow AI Migration Architect

## Post 1 (Russian) — Announcement

🚀 Мы построили инструмент, который за 5 минут делает то, на что у архитектора уходит 2 недели.

ServiceNow AI Migration Architect — это Python-приложение, которое:
• Подключается к вашему инстансу ServiceNow
• Само анализирует ВСЕ catalog items, workflow, скрипты и историю запросов
• Генерирует полный пакет документов для миграции на AI-агентов

Что на выходе:
✅ Executive Summary для CTO
✅ Terms of Reference (ТЗ)
✅ Техническая спецификация с Mermaid-диаграммами
✅ Анализ каждого workflow (health score, readiness)
✅ Архитектура AI-агентов под каждый процесс
✅ Поэтапный план миграции (5 фаз)
✅ Реестр рисков (likelihood × impact)
✅ План обучения пользователей

Почему это важно:
ServiceNow Yokohama уже в проде с AI Agents. Enterprise-компании получают 40-55% deflection rate и ROI за 5-8 месяцев. Но главный вопрос — "с чего начать?". Наш инструмент отвечает на него за минуты, а не недели.

88 integration tests. Open source. Готово к использованию.

Кто хочет потестировать на своем инстансе? 👇

#ServiceNow #AIAgents #EnterpriseAutomation #DigitalTransformation #ServiceCatalog

---

## Post 2 (English) — Technical deep-dive

I built a tool that auto-discovers your ENTIRE ServiceNow instance and generates a complete AI agent migration blueprint.

Here's what it does under the hood:

Phase 1 — Discovery (parallel async crawlers):
• sc_cat_item → all catalog items with variables
• wf_workflow → workflow definitions + activities
• sys_script_include → script includes audit
• sys_script → business rules analysis
• sys_rest_message → integration mapping
• sc_req_item → historical request stats (SLA breaches, fulfillment time)

Phase 2 — Analysis:
• Workflow health scoring (0-100) based on complexity, manual steps, approvals
• Script auditor — finds GlideRecord patterns that need REST API refactoring
• Bottleneck finder — ranks workflows by pain (SLA breaches × volume × manual steps)
• Integration mapper — categorizes all external system connections

Phase 3 — Generation (Jinja2 + LLM):
• AI agent topology per workflow (Mermaid diagrams)
• 5-phase migration roadmap (Foundation → Quick Wins → Core → Advanced → Optimization)
• Risk register with likelihood × impact matrix
• Role-based training plan

Built with: Python 3.11+, httpx (async), Pydantic v2, Typer, Rich, Jinja2
88 passing tests, mock SN server included.

This is what enterprise AI transformation tooling should look like.

#ServiceNow #AI #Automation #Python #EnterpriseArchitecture

---

## Post 3 (Russian) — Реальные цифры

Факты из практики (май 2026):

• ServiceNow потратил $10B+ на AI-M&A за 18 месяцев: Moveworks ($3B), Armis ($7.75B), Cuein AI, Data.World
• Yokohama release — AI Agents в production, Agent Studio для low-code разработки
• Enterprise кейсы: deflection rate 40-55%, ROI 5-8 месяцев, MTTR с часов до минут
• Now Assist лицензия: ~$75-100/user/month, break-even при 23% deflection

Главный инсайт из community:
"Не автоматизируйте сломанный процесс — сначала оптимизируйте"
"Начинайте с топ-20 catalog items — это 80% объема"
"Чистите Knowledge Base минимум 3 месяца перед AI-запуском"
"Оставьте Service Catalog как fallback — пользователи не простят, если чат медленнее формы"

Мы встроили все эти принципы в наш инструмент. Он не просто генерирует документы — он подсвечивает проблемные workflow ДО миграции.

#ServiceNow #AITransformation #EnterpriseIT #Automation

---

## Post 4 (English) — The architect's perspective

As an enterprise architect, I've seen the same pattern repeat:

Company buys ServiceNow → builds 500 catalog items → years of custom scripts → now wants AI agents

The question is never "should we?" — it's "where do we start?"

Enter ServiceNow AI Migration Architect:

1 command. 5 minutes. Complete migration blueprint.

```
$ sn-ai-migrator generate
```

Output:
📄 Executive summary (send to your CTO today)
📄 Technical specification with architecture diagrams
📄 Per-workflow AI agent topology (orchestrator, approval, provisioning agents)
📄 5-phase roadmap with success criteria and rollback plans
📄 Risk register (12 risks, scored, with mitigations)
📄 Training plan by role (end users, approvers, admins)

The tool doesn't replace the architect — it eliminates the grunt work so the architect can focus on decisions that matter.

Open source. Built with real enterprise constraints in mind.

#EnterpriseArchitecture #ServiceNow #AI #DigitalTransformation
