# SOP: SN NowAssist Optimizer — ServiceNow Now Assist Performance Optimizer
## Product ID: 4 | Release: AUSTRALIA | Thread: v5-2026-05-16
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### 1. Objective
Дашборд и аудит-движок для измерения реальной эффективности Now Assist: deflection rate, KB coverage gaps, skill routing accuracy, low-confidence conversations для human review. Подключается к ServiceNow REST API для анализа Virtual Agent логов и Now Assist метрик.

---

### 2. Test Plan (10 tests)

#### T1: Instance Connection + Now Assist License Check
**Input:** dev362840.service-now.com  
**Assert:** HTTP 200 + sys_plugin содержит `com.snc.now_assist`  
**Gate:** FAIL = блокировать downstream (нет Now Assist)

#### T2: Virtual Agent Conversation Enumeration
**Input:** REST GET `/api/now/table/sa_conversation` (или аналогичная таблица VA логов)  
**Assert:** >=1 разговор извлечен  

#### T3: Deflection Rate Calculation
**Input:** 100 VA conversations с полем `deflected`  
**Assert:** deflection_rate = deflected / total * 100, в разумных пределах 0-100%

#### T4: KB Answer Quality Score
**Input:** VA conversation с reference на KB article + user_feedback (`helpful`/`not_helpful`)  
**Assert:** KB quality score = helpful / (helpful + not_helpful)

#### T5: Skill Routing Accuracy
**Input:** Conversations с intent classification и actual resolution path  
**Assert:** accuracy = correct_intent_routing / total_routed

#### T6: Low-Confidence Conversation Detection
**Input:** Conversations с confidence score < 0.85 (или threshold)  
**Assert:** Список извлечен, топ-N предложены для human review

#### T7: Dashboard Generation (HTML)
**Input:** Результаты T2-T6  
**Assert:** HTML содержит: summary cards (deflection, KB score, routing accuracy, low-confidence count), таблицу conversation

#### T8: Report Export JSON
**Input:** Сырые метрики  
**Assert:** JSON структурирован, содержит timestamp, instance, metrics

#### T9: Now Assist vs Virtual Agent Comparison
**Input:** Сессии Now Assist и классический VA за один период  
**Assert:** Рассчитаны сравнительные метрики ( uplift/downlift )

#### T10: End-to-End Pipeline Instance+Report
**Input:** Живой инстанс + реальные записи VA  
**Assert:** Отчет сохранен на диск, лог содержит все стадии

---

### 3. Architecture
1. `audit_engine.py` — REST анализ sa_conversation, sa_intent, sn_kb_feedback
2. `metrics.py` — расчет deflection_rate, kb_quality, routing_accuracy, confidence_threshold
3. `dashboard.py` — генерация HTML/JSON отчетов
4. `cli.py` — CLI интерфейс

---

### 4. Key APIs
| Endpoint | Table | Purpose |
|---|---|---|
| /api/now/table/sa_conversation | sa_conversation | VA conversation logs |
| /api/now/table/sa_intent | sa_intent | Intent classification |
| /api/now/table/sn_kb_feedback | sn_kb_feedback | KB user feedback |
| /api/now/table/sys_user | sys_user | User info |
| /api/now/table/sn_now_assist_config | sn_now_assist_config | Now Assist configuration |
