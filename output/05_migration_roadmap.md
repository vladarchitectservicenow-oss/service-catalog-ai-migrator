---
title: "Поэтапный план миграции на AI-агентов — dev362840"
date: "2026-05-07 16:00 UTC"
version: "2.0"
platform: "ServiceNow Yokohama (Mar 2025)"
---

# Поэтапный план миграции на AI-агентов

## Обзор

Данный план описывает переход от классического ServiceNow Service Catalog к AI-агентной архитектуре на базе Yokohama release. В основе лежат 6 обнаруженных workflow и 7 интеграций.

### Ключевые технологии Yokohama, задействованные в плане

| Технология | Назначение |
|---|---|
| **Agent Studio** | Low-code конструктор AI-агентов. Визуальное проектирование топологии, tool binding, human-in-the-loop правила |
| **Multi-model Routing** | Автоматический выбор модели (GPT-4, Claude 3.5, Llama 3) под тип задачи. Критично для cost optimization |
| **Now Assist Skill Kit** | Создание кастомных навыков агентов — API-вызовы, скрипты, интеграции |
| **GenAI Controller** | Governance-слой: аудит решений, мониторинг hallucination rate, guardrails на действия |
| **Flow Designer → Agent Bridge** | Перенос существующих Flow Designer workflows в agent-native формат |

---

## Фаза 0: Foundation (2 недели)

### Цель
Подготовить платформу и данные для AI-миграции.

### Активности

| № | Активность | Ответственный | Результат |
|---|---|---|---|
| 0.1 | Аудит catalog items: удалить неактивные, дополнить описания | ServiceNow Admin | Чистый каталог из ~150 активных items с полными описаниями |
| 0.2 | Развернуть GenAI Controller и настроить guardrails | Platform Architect | Правила: confidence <85% → human-in-the-loop, запрет на destructive actions без approval |
| 0.3 | Настроить multi-model routing: GPT-4 для сложных approvals, Llama 3 для простых запросов | AI Engineer | Роутинг с метриками latency/cost per model |
| 0.4 | Интеграция Agent Studio с 7 REST-эндпоинтами (Azure AD, Slack, Jira, Okta, AWS, SAP, Datadog) | Integration Architect | Тестовые вызовы через Now Assist Skill Kit, подтверждённые 200 OK |
| 0.5 | Определить baseline KPI: deflection rate, MTTR, CSAT, SLA compliance | Service Manager | Dashboard в ServiceNow Performance Analytics |

### KPI на входе (baseline)

| Метрика | Текущее значение | Цель после миграции |
|---|---|---|
| Deflection rate | 0% (нет self-service) | 45%+ |
| Среднее время исполнения запроса | ~4h (ручной процессинг) | < 30 min для auto-approved |
| CSAT | N/A | ≥ 4.2/5 |
| SLA compliance | 100% (1 запрос) | ≥ 95% при 100+ запросах/день |

---

## Фаза 1: Quick Wins (4 недели)

### Цель
Запустить первых AI-агентов на low-risk high-volume workflow. Достичь 40% deflection.

### Выбранные workflow

**1. Password Reset — Self Service** (readiness: HIGH)
- Простой линейный процесс без approvals
- Высокая частота запросов
- Автоматизация: 100% возможно

**2. Software License Provisioning** (readiness: HIGH)
- Автоматическая выдача лицензий через Azure AD + Okta
- SLA-sensitive, требует скорости

### Архитектура агентов для Password Reset

```
┌──────────┐    ┌──────────────────┐    ┌────────────────┐
│ End User │───▶│ Orchestrator     │───▶│ Identity Agent │───▶ Azure AD Reset
│ (Portal/ │    │ (NLU: "сбрось   │    │ (verify user,  │
│  Slack)  │    │  пароль от VPN") │    │  execute reset)│
└──────────┘    └──────────────────┘    └────────────────┘
                                              │
                                         ┌────▼────────┐
                                         │ Notification │───▶ Slack DM: "Пароль сброшен"
                                         │   Agent      │
                                         └─────────────┘
```

**Технологии**: Agent Studio (визуальный дизайн), Now Assist Skill Kit (кастомный навык сброса пароля через Azure AD API), Slack Notification Agent

### Архитектура агентов для Software License Provisioning

```
┌──────────┐    ┌──────────────────┐    ┌────────────────┐
│ End User │───▶│ Orchestrator     │───▶│ License Agent  │───▶ Okta Assign License
│          │    │ (определяет      │    │ (проверяет     │───▶ Azure AD Group Add
│          │    │  тип лицензии)   │    │  доступность)  │
└──────────┘    └──────────────────┘    └────────────────┘
                     │                        │
                     ▼                        ▼
              ┌──────────────┐    ┌────────────────────┐
              │ Approval     │    │ Jira Ticket Agent  │
              │ Agent        │    │ (если лицензия     │
              │ (auto: <$500)│    │  требует закупки)  │
              └──────────────┘    └────────────────────┘
```

**Human-in-the-loop**: Запросы на лицензии > $500/мес, специализированный софт (SAP, AutoCAD), новые вендоры без approval в системе

### Активности Фазы 1

| Неделя | Активность | Результат |
|---|---|---|
| W1 | Собрать агентов в Agent Studio, написать Now Assist Skills для password reset и license assign | Рабочие навыки, протестированные на sandbox |
| W2 | Интеграция с Azure AD + Okta через REST API, настройка Slack-уведомлений | End-to-end flow работает в dev |
| W3 | Внутреннее тестирование: 50+ тестовых запросов на разных сценариях | Багрепорт, фиксы, confidence calibration |
| W4 | Запуск в production parallel-run режиме. Service Catalog остаётся как fallback | Агенты принимают реальные запросы. Fallback на форме доступен |

### Success Criteria Фазы 1

- [ ] Deflection rate ≥ 40% для Password Reset и Software License
- [ ] Время исполнения Password Reset < 2 min (сейчас ~30 min ручного)
- [ ] Время выдачи лицензии < 10 min (сейчас ~4h)
- [ ] Human escalation rate < 15%
- [ ] 0 critical incidents (P1/P2) за первую неделю prod

---

## Фаза 2: Core Migration (8 недель)

### Цель
Перенести средние по сложности workflow с approvals и multi-step процессами.

### Мигрируемые workflow

1. **Laptop Request Approval** (readiness: HIGH) — approval chain, procurement integration
2. **VM Provisioning** (readiness: MEDIUM) — resource gate checks, Azure/AWS API
3. **New Hire Onboarding** (readiness: MEDIUM) — multi-system orchestration

### Архитектура Laptop Approval Agent

```
┌──────────┐    ┌─────────────────┐    ┌──────────────────┐
│ Employee │───▶│ Orchestrator    │───▶│ Eligibility Agent│───▶ Check policy:
│          │    │ (тип ноутбука,  │    │ (role-based      │    dev→Mac, sales→PC
│          │    │  urgency, dept) │    │  assignment)     │
└──────────┘    └─────────────────┘    └──────────────────┘
                                               │
                                          ┌────▼───────────┐
                                          │ Approval Agent  │───▶ Manager approval
                                          │ (auto < $2000,  │    (> $2000 или спец.
                                          │  standard hw)   │    конфигурация)
                                          └─────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    ▼                          ▼                      ▼
           ┌──────────────┐    ┌────────────────────┐    ┌────────────────────┐
           │ Procurement  │    │ SAP ERP Purchase   │    │ Asset Agent        │
           │ Agent        │    │ Order Agent        │    │ (assign to user in │
           │ (check stock)│    │ (create PO if      │    │  CMDB, generate    │
           │              │    │  out of stock)     │    │  asset tag)        │
           └──────────────┘    └────────────────────┘    └────────────────────┘
```

### Архитектура New Hire Onboarding Agent (multi-orchestrator)

```
┌──────────┐    ┌──────────────────┐
│ HR       │───▶│ Onboarding       │
│ Manager  │    │ Orchestrator     │
└──────────┘    └──┬───────┬───────┘
                   │       │
        ┌──────────▼─┐ ┌──▼────────────┐
        │ AD Account │ │ Hardware      │
        │ Agent      │ │ Agent         │───▶ Laptop + Monitor + Accessories
        │ (create     │ │ (trigger      │
        │  user+email)│ │  laptop req)  │
        └────────────┘ └───────────────┘
                   │       │
        ┌──────────▼─┐ ┌──▼────────────┐
        │ Access     │ │ Software      │
        │ Card Agent │ │ License Agent │───▶ Standard software bundle
        │ (physical  │ │               │
        │  security) │ └───────────────┘
        └────────────┘
                   │
        ┌──────────▼──────────┐
        │ Notification Agent  │───▶ Welcome email + Slack #new-hires
        │ (day-1 checklist)   │
        └─────────────────────┘
```

### Активности Фазы 2

| Неделя | Активность | Результат |
|---|---|---|
| W1-2 | Дизайн агентов для Laptop Approval в Agent Studio; multi-model routing: Claude для сложных approval decisions, Llama для простых | Топология и guardrails утверждены |
| W3-4 | Разработка и тестирование Laptop Approval агента. Интеграция с SAP ERP для purchase orders | Laptop flow работает end-to-end |
| W5-6 | Разработка VM Provisioning агента: resource check → approval gate → Azure/AWS API → monitoring через Datadog | VM provisioning автоматизирован |
| W7-8 | New Hire Onboarding: multi-agent orchestration, координация между AD, hardware, access card, software агентами | Onboarding flow готов. Parallel run включён |

### Parallel Run Strategy — Critical

На время Фазы 2 включается **dual-write режим**:
- Агент исполняет запрос
- Параллельно создаётся запись в ServiceNow для audit trail
- Если агент падает — ServiceNow workflow подхватывает автоматически
- Каждые 4 часа сверка executed vs expected

### Success Criteria Фазы 2

- [ ] Laptop Approval: 50% deflection, time-to-approval < 1h (было ~24h)
- [ ] VM Provisioning: 60% deflection, provisioning time < 15 min (было ~2 days)
- [ ] New Hire Onboarding: 80% автоматизации шагов, SLA compliance > 90%
- [ ] Agent availability 99.5%+

---

## Фаза 3: Advanced AI (6 недель)

### Цель
Сложные сценарии, multi-model оптимизация, feedback loops.

### Активности

| № | Активность | Детали |
|---|---|---|
| 3.1 | Access Card Issuance агент | Связка с физической безопасностью: approval от Security Officer, интеграция с системой печати карт |
| 3.2 | Multi-model routing optimization | A/B тесты: GPT-4 vs Claude vs Llama на approval accuracy. Автоматический routing по метрикам |
| 3.3 | Now Assist Skill Kit — кастомные навыки | Навыки: "generate purchase order", "validate security clearance", "check license availability" |
| 3.4 | Feedback Loop Integration | Пользователь оценивает ответ агента (👍/👎) → данные идут в GenAI Controller → дообучение routing |
| 3.5 | Agent Analytics Dashboard | Deflection rate per workflow, hallucination rate, escalation rate, avg tokens/request, cost per deflection |

### Multi-model Routing — Target Configuration

| Тип запроса | Модель | Причина |
|---|---|---|
| Password Reset | Llama 3 8B | Простой, высокая скорость, низкая стоимость |
| License Assignment | Llama 3 70B | Структурированные данные, нужна точность |
| Laptop Approval (>$2000) | Claude 3.5 Sonnet | Сложные policy decisions, требуется reasoning |
| VM Provisioning | GPT-4 | Комплексные resource calculations |
| New Hire Onboarding | Claude 3.5 (orchestrator) + Llama 3 (workers) | Multi-agent, cost optimization |

### Success Criteria Фазы 3

- [ ] Access Card агент в работе, deflection 30%
- [ ] Multi-model routing экономит ≥ 25% LLM costs vs single-model
- [ ] CSAT ≥ 4.3/5
- [ ] Hallucination rate < 2% (измеряется GenAI Controller)

---

## Фаза 4: Ongoing Optimization (непрерывно)

### Постоянные процессы

| Процесс | Частота | Описание |
|---|---|---|
| A/B тестирование routing стратегий | Ежемесячно | Сравнение моделей, промптов, guardrail thresholds |
| Catalog health audit | Ежеквартально | Проверка описаний, удаление неиспользуемых items, обновление категорий |
| Agent fine-tuning | По необходимости | Дообучение на feedback loop данных. Только при падении accuracy > 5% |
| Security audit agent decisions | Ежемесячно | Независимый аудит 100 случайных agent decisions на compliance |
| Cost optimization review | Ежемесячно | Оптимизация model routing, кэширования ответов, batching |

### Зрелость платформы — Roadmap по годам

```
Year 1 (2026)          Year 2 (2027)              Year 3 (2028)
─────────────────────  ─────────────────────────  ─────────────────────────
Quick Wins   40% defl  Core workflows  55% defl   Full autonomy  70%+ defl
6 agents deployed      12+ agents deployed        25+ agents, cross-domain
Single-instance        Multi-instance federation  Agent marketplace
Human-in-loop          Human-on-exception         Human-on-strategy-only
```

---

## Ресурсы и команда

| Роль | Фаза 0-1 | Фаза 2 | Фаза 3-4 |
|---|---|---|---|
| AI/ML Engineer | 1 FTE | 2 FTE | 2 FTE |
| Integration Architect | 0.5 FTE | 1 FTE | 0.5 FTE |
| ServiceNow Admin | 1 FTE | 1 FTE | 0.5 FTE |
| Security Officer | 0.25 FTE | 0.5 FTE | 0.25 FTE |
| Change Manager | 0.5 FTE | 0.5 FTE | 0.25 FTE |
| SRE/Platform Engineer | 0.5 FTE | 1 FTE | 1 FTE |
| **Total** | **4 FTE** | **6 FTE** | **5 FTE** |

---

## Оценка стоимости (лицензии + инфраструктура)

| Компонент | Стоимость (год) |
|---|---|
| Now Assist лицензии (50 power users) | $45K-60K |
| LLM inference (OpenRouter/Anthropic API) | $25K-45K |
| Инфраструктура (K8s кластер, мониторинг) | $30K-50K |
| **Итого** | **$100K-155K/год** |

Ожидаемая экономия от автоматизации: $250K-400K/год (сокращение L1/L2 поддержки + ускорение fulfilment).
**ROI: 5-8 месяцев.**

---

## Ключевые риски плана

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Задержки из-за качества данных каталога | Средняя | Высокое | Фаза 0 — обязательный аудит |
| Сопротивление пользователей | Высокая | Среднее | Service Catalog как fallback, обучение |
| Нехватка AI-экспертизы в команде | Средняя | Высокое | Внешний консультант первые 6 мес |
| LLM hallucination на provisioning | Низкая | Критическое | Human-in-the-loop на destructive actions |
