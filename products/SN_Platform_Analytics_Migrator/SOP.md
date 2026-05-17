# SOP: SN Platform Analytics Migrator
## Product ID: 6 | Release: ZURICH/AUSTRALIA
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### Objective
Автоматический сканер и мигратор отчетов с Performance Analytics / Core UI на Platform Analytics (Next Experience). Генерация JSON конфигураций для импорта через Migration Center.

### Test Plan (10 tests)

#### T1: PA Plugin Check
#### T2: Enumerate Core UI Reports (sys_report)
#### T3: Enumerate PA Dashboards (pa_dashboards)
#### T4: Map report types (list, chart, pivot) to Platform Analytics equivalents
#### T5: Generate PA-compatible JSON configuration
#### T6: Validate JSON schema (required fields, table references)
#### T7: Detect unsupported visualizations (legacy bar3d, gauge unsupported)
#### T8: KB migration metadata (Executive Dashboards)
#### T9: HTML report with before/after mapping
#### T10: Full pipeline (scan → map → validate → export)
