---
title: "Реестр рисков миграции на AI-агентов — dev362840"
date: "2026-05-07 16:00 UTC"
version: "2.0"
total_risks: 12
classification: "high ≥ 15 | medium 6-14 | low < 6"
---

# Реестр рисков миграции на AI-агентов

## Сводка

| Класс | Количество | Порог |
|---|---|---|
| 🔴 Высокий | 4 | Score ≥ 15 |
| 🟡 Средний | 5 | Score 6-14 |
| 🟢 Низкий | 3 | Score < 6 |

Выявлено 12 рисков в 6 категориях. Наибольшая концентрация — в категориях **technical** (3) и **organizational** (2).

---

## Категории рисков

| Категория | Количество | Средний score | Ключевой риск |
|---|---|---|---|
| technical | 3 | 11.3 | R01 — API rate limits |
| security | 2 | 11.0 | R08 — Audit trail gaps |
| operational | 2 | 11.5 | R04 — SLA degradation |
| organizational | 2 | 10.5 | R05 — User resistance |
| data | 2 | 10.0 | R07 — Stale catalog items |
| financial | 1 | 9.0 | R12 — License cost overrun |

---

## Топ-5 критических рисков

### R03 — Agent Hallucination (L=2, I=5, Score=10)

**Категория**: technical

**Описание**: AI-агент генерирует некорректные provisioning-действия (неправильный доступ, ошибочный сброс пароля не тому пользователю, некорректный PO в SAP). Последствия — от операционных инцидентов до compliance violation.

**Митигация**:
1. Жёсткая валидация output агента через Pydantic/Pydantic схемы — ни одно действие не исполняется без schema check
2. Human-in-the-loop для ВСЕХ destructive actions (password reset на админа, удаление доступов, PO > $5000)
3. Guardrails в GenAI Controller: запрет на действия вне allow-list
4. Rate-limit на количество action в минуту per agent

**Детекция**: Аномалии в action frequency. Diff между запрошенным и исполненным действием. Alert при расхождении > 0.01%.

**Владелец**: AI/ML Engineer

---

### R01 — API Rate Limits (L=3, I=4, Score=12)

**Категория**: technical

**Описание**: ServiceNow REST API имеет per-session rate limits. При пиковой нагрузке (100+ одновременных запросов) агенты получают 429 Too Many Requests. Время исполнения растёт, SLA нарушается.

**Митигация**:
1. Request batching — группировка API-вызовов в batch requests (до 50 в одном)
2. Exponential backoff с jitter на стороне агента
3. Кэширование ответов на частые lookup-запросы (CMDB, user info, license status)
4. Negotiate higher rate limits с ServiceNow (enterprise tier)
5. Circuit breaker: при 50% ошибок 429 → агент переходит в queued режим

**Детекция**: Prometheus counter на HTTP 429. Alert при > 10 ошибок/минуту.

**Владелец**: Integration Architect

---

### R08 — Audit Trail Gaps (L=2, I=5, Score=10)

**Категория**: security

**Описание**: Решения AI-агентов не полностью логируются — невозможно восстановить цепочку: "почему агент выдал доступ пользователю X к системе Y?" При compliance audit (SOC2, ISO 27001) это критический finding.

**Митигация**:
1. Structured JSON-логирование КАЖДОГО agent decision: timestamp, agent_id, input_context, model_used, confidence_score, action_taken, rationale
2. Immutable audit log (append-only storage, WORM-совместимое хранилище)
3. Автоматическая проверка полноты логов каждые 15 минут — alert при gaps
4. Ежемесячный compliance audit силами Security Officer

**Детекция**: Автоматическая сверка: executed_actions == logged_decisions. Alert при расхождении.

**Владелец**: Security Officer

---

### R07 — Stale Catalog Items (L=3, I=4, Score=12)

**Категория**: data

**Описание**: ~30 из 197 catalog items имеют неполные или устаревшие описания. Агент, опираясь на эти данные, может предложить несуществующую услугу или некорректный fulfilment path.

**Митигация**:
1. Pre-migration audit (Фаза 0): полная проверка всех catalog items — описания, категории, активность
2. Автоматические валидационные правила при выборе item агентом — сверка с актуальным состоянием CMDB
3. Item staleness alert: если item не обновлялся > 90 дней → флаг "requires review"
4. Fallback: если agent confidence < 85% на выборе item → переключение на human agent с полным контекстом

**Детекция**: Catalog Health Dashboard (дата последнего обновления, % items без описаний, % items без категорий).

**Владелец**: ServiceNow Admin

---

### R02 — Auth Token Expiration (L=3, I=4, Score=12)

**Категория**: security

**Описание**: OAuth2 access tokens истекают (обычно 1 час), refresh tokens — через 90 дней. Если агент не обновляет токен вовремя, запросы к внешним системам (Azure AD, Okta, SAP) падают с 401.

**Митигация**:
1. Proactive refresh: обновление access token за 5 минут до expiry
2. Circuit breaker: при 3 consecutive 401 → переключение на backup credential
3. Health check endpoint: проверка валидности токенов всех интеграций каждые 5 минут
4. Secure credential vault (HashiCorp Vault или AWS Secrets Manager)

**Детекция**: Prometheus alert на 401 ошибки > 0. Health check мониторинг.

**Владелец**: Security Officer

---

## Полный реестр рисков (R01-R12)

| ID   | Категория       | Описание                                                            | L | I | Score | Митигация (ключевая)                                      | Владелец             |
|------|----------------|----------------------------------------------------------------------|---|---|-------|----------------------------------------------------------|----------------------|
| R01  | technical      | API rate limits restrict agent throughput during peak load           | 3 | 4 | **12** | Request batching, exponential backoff, кэширование        | Integration Architect |
| R02  | security       | Authentication token expiration causes agent failures                | 3 | 4 | **12** | Proactive refresh, circuit breaker, health checks         | Security Officer      |
| R03  | technical      | Agent hallucination produces incorrect fulfillment actions           | 2 | 5 | **10** | Schema validation, human-in-the-loop for destructive      | AI/ML Engineer        |
| R04  | operational    | SLA degradation during migration due to parallel-run overhead        | 3 | 3 | **9**  | Staged rollout, auto-rollback triggers, SLA monitoring    | Service Manager       |
| R05  | organizational | User resistance and low adoption of agent-driven catalog             | 4 | 3 | **12** | Champions program, training, Service Catalog fallback     | Change Manager        |
| R06  | organizational | Skill gaps — team lacks AI/agent operations expertise                | 3 | 3 | **9**  | Hire AI ops specialist, vendor support, training program  | Engineering Manager   |
| R07  | data           | Incomplete/stale catalog items cause incorrect agent behavior         | 3 | 4 | **12** | Pre-migration audit, validation rules, staleness alerts   | ServiceNow Admin      |
| R08  | security       | Audit trail gaps — agent decisions not fully logged                  | 2 | 5 | **10** | Structured JSON logging, immutable audit log              | Security Officer      |
| R09  | technical      | LLM inference latency exceeds SLA thresholds under load              | 3 | 3 | **9**  | Autoscaling, caching, circuit breaker, local fallback     | Platform Engineer     |
| R10  | operational    | Integration failures cascade across agent fleet                      | 2 | 4 | **8**  | Circuit breakers, bulkhead pattern, graceful degradation  | SRE Lead              |
| R11  | data           | Data migration errors when syncing catalog state                     | 4 | 2 | **8**  | Incremental sync, checksum validation, reconciliation     | Data Engineer         |
| R12  | financial      | License cost overrun from AI agent scaling (Now Assist + LLM API)    | 3 | 3 | **9**  | Cost monitoring, multi-model routing optimization         | IT Finance            |

---

## Тепловая карта рисков (Likelihood × Impact)

```
            Impact →
            1       2       3       4       5
       ┌───────┬───────┬───────┬───────┬───────┐
L  5   │       │       │       │       │       │
       ├───────┼───────┼───────┼───────┼───────┤
i  4   │       │  R11  │  R05  │R01 R02│       │
k      │       │       │       │  R07  │       │
e  ────┼───────┼───────┼───────┼───────┼───────┤
l  3   │       │       │R04 R06│       │       │
i      │       │       │R09 R12│       │       │
h  ────┼───────┼───────┼───────┼───────┼───────┤
o  2   │       │       │       │  R10  │R03 R08│
o      │       │       │       │       │       │
d  ────┼───────┼───────┼───────┼───────┼───────┤
   1   │       │       │       │       │       │
       └───────┴───────┴───────┴───────┴───────┘
            🟢           🟡           🔴
```

## Мониторинг и контроль

Каждый риск отслеживается через:

- **Risk Dashboard** (ServiceNow GRC): статус митигации, дата последнего ревью
- **Автоматические триггеры**: при изменении likelihood или impact → пересчёт score → alert если crossing threshold (low→medium→high)
- **Ежемесячный Risk Review** с participation всех владельцев рисков
- **Quarterly external audit**: независимая оценка maturity risk management

## История изменений

| Дата | Изменение | Автор |
|---|---|---|
| 2026-05-07 | Первичная версия, 12 рисков | ServiceNow AI Migration Architect v2.0 |
