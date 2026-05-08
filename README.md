# ServiceNow AI Migration Architect

Инструмент для архитектора, который автоматически анализирует инстанс ServiceNow
и генерирует полный пакет документов для миграции существующих workflow
на AI-агентов.

## Что делает

```
sn-ai-migrator discover  — подключается к SN и собирает всё (каталог, workflow, скрипты, историю)
sn-ai-migrator analyze   — анализирует: здоровье workflow, аудит скриптов, бутылочные горла
sn-ai-migrator generate  — генерирует полный пакет документов в output/
```

## Что на выходе

```
output/
├── 00_executive_summary.md        # Executive Summary для руководства (на русском)
├── 01_terms_of_reference.md       # ТЗ на миграцию
├── 02_technical_specification.md  # Техническая спецификация с архитектурными диаграммами
├── 03_workflow_analysis/          # Анализ каждого workflow (health score, readiness)
├── 04_agent_architectures/        # Топология AI-агентов под каждый workflow
├── 05_migration_roadmap.md        # Поэтапный план миграции (5 фаз, ~20 недель)
├── 06_risk_register.md            # Реестр рисков (12 рисков, 6 категорий, LxI scoring)
├── 07_training_plan.md            # План обучения по ролям
└── 08_appendices/                 # JSON-данные (discovery, analysis, roadmap, risks)
```

## Как это работает

### Фаза 1 — Discovery (параллельные async-запросы)
- `sc_cat_item` — все позиции каталога с переменными
- `wf_workflow` — определения workflow с деревом активностей
- `sys_script_include` — серверные скрипты
- `sys_script` — бизнес-правила
- `sys_rest_message` — внешние REST-интеграции
- `sc_req_item` — исторические запросы (SLA, время исполнения)

### Фаза 2 — Analysis (4 анализатора)
- **Workflow Health Scorer** — оценка 0-100: сложность, ручные шаги, approvals, таймеры, SLA-метрики
- **Script Auditor** — поиск GlideRecord-паттернов под REST-рефакторинг, хардкод ID, синхронные HTTP
- **Integration Mapper** — категоризация внешних интеграций с оценкой рисков
- **Bottleneck Finder** — ранжирование по pain score (SLA breaches x volume x manual steps)

### Фаза 3 — Generation (Jinja2 + анализ)
- **Executive Summary** — готово для CTO: метрики, readiness, Quick Wins
- **Terms of Reference** — scope, objectives, success metrics
- **Technical Specification** — текущая/целевая архитектура с диаграммами
- **AI Agent Architecture** — топология агентов под каждый workflow (orchestrator, approval, provisioning, notification, escalation agents)
- **5-Phase Migration Roadmap** — Foundation → Quick Wins → Core Migration → Advanced AI → Optimization (~20 недель)
- **Risk Register** — 12 рисков в 6 категориях с likelihood x impact scoring и митигациями
- **Training Plan** — по ролям: end users, approvers, administrators

## ServiceNow AI Platform (Australia release — май 2026)

Продукт построен на реальной информации из официальной документации ServiceNow (ServiceNowDocs, Australia branch):

| Компонент | Официальное название | Что делает |
|---|---|---|
| Среда создания агентов | **AI Agent Studio** | Low-code guided setup для создания, управления и тестирования AI-агентов |
| AI-навыки | **Now Assist skills** | Переиспользуемые GenAI-возможности: суммаризация, генерация, анализ записей |
| Оркестрация агентов | **Agentic workflows** | Multi-agent оркестрации с динамическим планированием и адаптацией |
| LLM-интеграция | **Generative AI Controller** | BYOK (Bring Your Own Key): Azure OpenAI, Amazon Bedrock, Google Vertex AI, IBM watsonx |
| Governance | **Generative AI Controller** | Guardrails, аудит решений, rate limiting, Now Assist Guardian (защита от offensive/prompt injection) |
| Workflow-движок | **Workflow Studio** | Унифицированная среда: flows, subflows, actions, playbooks, decision tables |
| Платформенные агенты | **Platform AI agents** (4 шт.) | Approval assistance, Issue Readiness, Request status, Domain Separation |
| Память агентов | **AI agent learning** | Episodic + long-term memory (LTM categories) |
| Безопасность | **Role masking** | Least-access privileges при исполнении инструментов агентом |

### Платформенные agentic workflows (Australia)

- **Analyze task trends** — детектирует повторяющиеся паттерны, предиктивные рекомендации
- **Classify tasks** — авто-триаж: обновление полей, sentiment analysis, суммаризация
- **Generate my work plan** — персональный план на основе текущей работы и истории
- **Generate resolution plan** — анализ задач, генерация шагов разрешения
- **Help optimize team productivity** — аллокация работ на основе исторической производительности
- **Identify ways to improve service** — анализ фидбека и метрик, рекомендации по улучшению
- **Investigate problems** — root cause analysis и actionable план разрешения проблем

## Лицензия и коммерческое использование

**AGPL-3.0** — строгая защитная лицензия. Что это значит:

- ✅ Можно клонировать, изучать код, делать форк
- ✅ Можно использовать внутри компании для своих нужд
- ❌ **Запрещено** использовать в коммерческих продуктах и SaaS без отдельной paid-лицензии
- ❌ **Запрещено** продавать, распространять как часть проприетарного софта
- ⚠️ Любые производные работы ОБЯЗАНЫ быть открыты под той же AGPL-3.0 (copyleft)

**Хотите использовать в коммерческом проекте?**

Свяжитесь со мной для получения коммерческой лицензии:
📧 [ваш email]
💼 [LinkedIn профиль]

### Защита интеллектуальной собственности

Проект защищён комбинацией юридических и технических мер. Подробный гайд: [IP Protection Guide](marketing/ip_protection_guide.md)

---

## Быстрый старт

1. Клонируйте репозиторий
2. Скопируйте `config.example.yaml` → `config.yaml` и заполните credentials
3. Установите зависимости: `pip install -e ".[dev]"`
4. Запустите: `sn-ai-migrator discover && sn-ai-migrator analyze && sn-ai-migrator generate`

## Verified Documentation Sources

- ServiceNowDocs (Australia branch) — официальная документация ServiceNow, оптимизированная для LLM: https://github.com/ServiceNow/ServiceNowDocs
- Файлы indexed через llms.txt (raw.githubusercontent.com/ServiceNow/ServiceNowDocs/australia/llms.txt)
- Документация обновляется минимум ежемесячно
- Последняя verified дата: 2026-05-08

## Лицензия

**GNU AGPL-3.0** — см. файл [LICENSE](./LICENSE). Коммерческое использование требует отдельной paid-лицензии.
