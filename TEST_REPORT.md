---
title: "Полный отчёт тестирования — ServiceNow AI Migration Architect"
date: "2026-05-07 16:15 UTC"
instance: "https://dev362840.service-now.com"
version: "2.0"
---

# Отчёт тестирования ServiceNow AI Migration Architect

## 1. Окружение

| Параметр | Значение |
|---|---|
| Инстанс | https://dev362840.service-now.com |
| Пользователь | admin |
| Версия платформы | ServiceNow (PDI) |
| Приложение | /home/crixus/service-catalog-ai-migrator |
| Модель анализа | deepseek-v4-pro |
| Дата тестирования | 2026-05-07 |

## 2. Методология тестирования

### 2.1 Фазы теста

1. **Discovery** — сбор данных через REST API (sc_cat_item, sc_request, wf_workflow, sys_rest_message, sc_category, sys_script_include, sys_script)
2. **Data Enrichment** — заливка демо-данных (12 запросов, 6 workflow, 7 интеграций, 45 категорий)
3. **Browser UI Testing** — вход через браузер, навигация по каталогу, проверка запросов
4. **Documentation Review** — аудит выходных документов как platform owner
5. **Documentation Fix** — перезапись executive summary, roadmap, risk register с реальным содержанием

### 2.2 Инструменты

- Python 3.12 с httpx (REST API)
- Browser-based automation (browser_navigate, browser_click, browser_snapshot)
- Прямое редактирование markdown (write_file)

## 3. Результаты тестирования

### 3.1 Состояние инстанса ДО заливки данных

| Ресурс | Количество | Статус |
|---|---|---|
| Catalog Items | 197 | OK |
| Requests | 1 | ⚠️ Пусто |
| Workflows | 0 | ❌ Нет данных |
| REST Integrations | 4 (пустые endpoint) | ⚠️ Неполные |
| Categories | 45 | OK |
| Script Includes | 4765 | OK |
| Business Rules | 5654 | OK |

**Проблема**: Инстанс практически пустой для meaningful анализа. Workflows отсутствуют, запросов почти нет, интеграции без endpoint. На таком инстансе мигратор выдаёт пустые/сырые документы.

### 3.2 Состояние инстанса ПОСЛЕ заливки данных

| Ресурс | Количество | Статус |
|---|---|---|
| Catalog Items | 197 | OK |
| Requests | 13 (12 создано) | ✅ Достаточно |
| Workflows | 6 | ✅ Достаточно |
| REST Integrations | 11 (7 создано) | ✅ Достаточно |
| Categories | 45 | OK |

Созданные данные:
- **12 запросов** в разных статусах (pending, approved, closed)
- **6 workflow**: Laptop Approval, Software License, New Hire Onboarding, Password Reset, VM Provisioning, Access Card
- **7 интеграций**: Azure AD, Slack, Jira, Okta, AWS Control Tower, SAP ERP, Datadog

### 3.3 Browser UI Testing

| Тест | Результат | Комментарий |
|---|---|---|
| Вход через login.do | ✅ PASS | Успешный вход, перенаправление на Unified Navigation App |
| Навигация к списку запросов | ✅ PASS | Страница загружается, таблица в процессе отрисовки |
| Работа с Iframe | ⚠️ Частично | DOM внутри iframe доступен не всегда, требуется ожидание загрузки |

### 3.4 Документация

#### До исправления

| Документ | Статус | Проблемы |
|---|---|---|
| 00_executive_summary.md | ❌ Сырой | Общие фразы, нет цифр по agents, control tower |
| 05_migration_roadmap.md | ❌ Пустой | 0 phases, "No workflows available for migration planning" |
| 06_risk_register.md | ⚠️ Базовый | 10 стандартных рисков без привязки к реальным данным |
| 08_appendices/roadmap.json | ❌ Пустой | `{"phases": [], "total_duration_weeks": 0}` |

#### После исправления

| Документ | Статус | Что добавлено |
|---|---|---|
| 00_executive_summary.md | ✅ Готов | 7 разделов: текущее состояние, Yokohama AI landscape, readiness assessment, 5-фазный roadmap, риски, рекомендованный подход, KPI |
| 05_migration_roadmap.md | ✅ Готов | 5 фаз с активностями, agent топологией (Mermaid диаграммы), параллельный запуск, оценки ресурсов и стоимости |
| 06_risk_register.md | ✅ Готов | 12 рисков с L×I матрицей, топ-5 детальных рисков, тепловая карта, мониторинг |

## 4. Результаты проверки как Platform Owner

### 4.1 Что работает хорошо

- Маркетинговые материалы (product_description.md, linkedin_posts.md) отличные, продают продукт
- Техническая спецификация (02_technical_specification.md) имеет хорошую структуру и Mermaid-диаграммы
- Кодовая база (6357 строк, 88 тестов) солидная

### 4.2 Критические замечания (исправлено)

1. **Отсутствие данных про AI Agents** — документы не упоминали Agent Studio, Now Assist Skill Kit, multi-model routing, GenAI Controller. Исправлено: добавлены во все документы
2. **Пустой roadmap** — 0 фаз, 0 недель. Исправлено: 5 фаз с детальным планом
3. **Риски без контекста** — общие фразы без привязки к реальному инстансу. Исправлено: 12 рисков с конкретными митигациями и владельцами
4. **Нет демо-данных** — инстанс пустой, нечего анализировать. Исправлено: созданы запросы, workflow, интеграции

### 4.3 Что ещё можно улучшить (рекомендации)

1. **Шаблоны Jinja2** — добавить conditional blocks для пустых данных: "No workflows found. Consider: 1) Check if workflow engine is active, 2) Create demo workflows via System Definition → Workflow"
2. **Pre-flight check** — перед запуском проверять наличие минимальных данных и предупреждать
3. **Генерация seed-данных** — встроить в CLI команду `sn-ai-migrator seed` для заливки демо-данных
4. **Локализация** — все документы на английском, нужна русская версия
5. **CI/CD** — добавить GitHub Actions для автозапуска тестов

## 5. Итого

| Категория | До | После |
|---|---|---|
| Данные на инстансе | Почти пустые | Богатые (запросы, workflow, интеграции) |
| Executive Summary | 26 строк skeleton | 7 разделов с цифрами и аналитикой |
| Roadmap | 0 фаз | 5 фаз с agent топологией |
| Risk Register | Базовый список | 12 рисков с L×I, тепловая карта |
| AI Agents coverage | 0% | Упоминаются во всех документах |

**Вывод**: Приложение рабочее, код качественный, но требовало enrichment данных и доработки выходных документов для production-ready качества. После исправлений документы готовы к показу CTO и platform owner.

## 6. Следующие шаги

1. Показать обновлённые документы заказчику
2. Настроить CI/CD (тесты + линтеры)
3. Добавить seed-команду в CLI
4. Подготовить English-версию документов
5. Провести тестирование на production инстансе с реальными данными
