# SOP: SN Guardian — ServiceNow Guarded Script Migration Tool
## Product ID: 3 | Release: ZURICH/AUSTRALIA | Thread: v5-2026-05-16
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### 1. Objective
Автоматический сканер серверных скриптов инстанса ServiceNow на совместимость с Guarded Script (KittyScript). Генерация миграционного отчета, автосоздание Script Include заглушек и управление фазами enforcement (Phase 1→3).

---

### 2. Components
| Модуль | Назначение |
|---|---|
| scanner.py | REST-запрос к sys_script, парсинг JS AST |
| classifier.py | Определение совместимости по белому списку API |
| migration_report.py | HTML/JSON/PDF отчет с рекомендациями |
| script_include_generator.py | Генерация Script Include из несовместимого кода |
| phase_manager.py | Управление GlideGuardedScript фазами через REST |
| cli.py | Typhoon CLI интерфейс |

---

### 3. Test Plan (10 tests — all must pass)

#### T1: Instance Connection
**Goal:** Успешное подключение к dev362840.service-now.com  
**Input:** URL, admin creds  
**Assert:** HTTP 200 на /api/now/table/sys_user?sysparm_limit=1  
**Gate:** FAIL = block all downstream tests

#### T2: Script Enumeration
**Goal:** Получить все записи sys_script с server-side кодом  
**Input:** GlideRecord скрипты (business rules, client scripts server, UI policies server-side)  
**Assert:** >= 1 запись найдена  
**Gate:** FAIL = instance не содержит тестовых данных

#### T3: Guarded Script Whitelist Verification
**Goal:** Скрипт состоит только из разрешенных конструкций  
**Input:** `gs.getUserID()` — простой вызов  
**Assert:** classifier возвращает COMPATIBLE  
**Gate:** FAIL = белый список неправильно реализован

#### T4: Complex Script Detection
**Goal:** Обнаружение несовместимого кода (переменные, if, for)  
**Input:** `var x = 1; if(x>0) gs.info('ok');`  
**Assert:** classifier возвращает INCOMPATIBLE с причиной "variable declaration, control flow"

#### T5: Forbidden API Detection
**Goal:** Обнаружение отсутствующего в белом списке API  
**Input:** `gs.log('test')` — gs.log deprecated в некоторых контекстах  
**Assert:** classifier помечает WARNING или INCOMPATIBLE если API не в whitelist

#### T6: Script Include Generation Stub
**Goal:** Из несовместимого кода генерируется корректный Script Include  
**Input:** INCOMPATIBLE скрипт из T4  
**Assert:** Сгенерированный Script Include содержит функцию, экспортирует ее, не содержит запрещенных конструкций

#### T7: Migration Report Generation
**Goal:** Отчет содержит все обязательные разделы  
**Input:** Результаты сканирования 10 скриптов  
**Assert:** HTML отчет содержит: summary (total/compatible/incompatible), таблицу скриптов с причинами, рекомендации по фазе, timestamp

#### T8: Phase Manager — Read Current Phase
**Goal:** Корректное чтение текущей фазы enforcement  
**Input:** REST GET к GlideGuardedScript  
**Assert:** Возвращает одно из: "Phase 1 Detection" / "Phase 2 Syntax" / "Phase 3 Full" / "Not enforced"

#### T9: Phase Manager — Advance Phase (simulated)
**Goal:** Управление переходами фаз без автоматического применения на prod  
**Input:** advanceToPhase2() в sandbox-режиме  
**Assert:** Команда сформирована корректно, preview-mode без side effects

#### T10: End-to-End Pipeline
**Goal:** Полный цикл: scan → classify → generate → report → phase check  
**Input:** Живой инстанс dev362840.service-now.com  
**Assert:** Выполнен без exception, отчет сохранен на диск, лог содержит все стадии

---

### 4. Architecture

```
┌──────────────┐     ┌───────────┐     ┌──────────────────┐
│ ServiceNow    │ REST│  Scanner   │     │ Classifier  │
│ Instance      ├────├────────├──────────├──────────────────┘
│ (dev362840)   │     │ (sys_script)│     │ (AST + whitelist)│
└──────────────┘     └───────────┘     │──────────────────────────────────────────────┤
                                                  │
                       ┌────────────────┤└──────────────────────────────────────────┘
                       │                         │
          ┌────────├─────────────────┐│┌──────────────────────────────┐
          │ Compatible├──────────────────┘││ Incompatible      │
          └────────┘          │          │└──────────────────────────────┘
                           │          ├──────────────────────────────────┤
                ┌──────────├───────────┐          │
                │ Report   │          │ Script Include    │
                │ (HTML)   │          │ Generator         │
                └──────────┘          └────────────────────────────────┘
```

---

### 5. API Integration Points
| API | Endpoint | Method | Purpose |
|---|---|---|---|
| Table API | /api/now/table/sys_script | GET | Enumerate scripts |
| Table API | /api/now/table/sys_script_include | GET/POST | Read/create Script Includes |
| Script API | /api/now/script | POST | Execute GlideGuardedScript methods |
| Instance API | /api/now/table/sys_properties | GET | Read sys_properties |

---

### 6. Exit Criteria
- Все 10 тестов PASS
- Отчет генерируется и содержит реальные данные с dev362840
- GitHub commit с полным именем: "ServiceNow Guarded Script Migration Tool (3)"
- honcho.db статус обновлен на DONE
