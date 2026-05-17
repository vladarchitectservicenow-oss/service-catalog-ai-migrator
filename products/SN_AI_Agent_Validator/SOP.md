# SOP: SN AI Agent Validator — ServiceNow AI Agent Readiness Validator
## Product ID: 5 | Release: AUSTRALIA | Thread: v5-2026-05-16
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### 1. Objective
Валидатор готовности AI Agent к production: проверяет конфигурацию агента, привязки навыков (skills), соответствие role masking, A2A protocol compliance, качество данных (CMDB, KB) перед запуском.

---

### 2. Test Plan (10 tests)

#### T1: Plugin Check
**Input:** Instance + AI Platform plugin  
**Assert:** Plugin active = true

#### T2: Agent Configuration Scan
**Input:** AI Agent definitions (table sn_agent)  
**Assert:** Все обязательные поля заполнены (name, description, skills, roles)

#### T3: Skill Binding Integrity
**Input:** Skill-to-agent mappings  
**Assert:** Нет orphaned skills, все skills активны

#### T4: Role Masking Compliance
**Input:** Agent roles + ACLs  
**Assert:** Роли агента не шире чем роли создателя; нет admin/sudo escalation

#### T5: A2A Protocol Compliance
**Input:** External agent configurations  
**Assert:** Deprecated manual integrations отсутствуют; все external agents используют A2A Protocol

#### T6: Data Readiness (CMDB)
**Input:** CMDB Health Scan  
**Assert:** Completeness >= 80%, stale CIs <= 10%

#### T7: Knowledge Base Coverage
**Input:** KB articles + agent topics  
**Assert:** Каждый topic агента имеет >= 3 KB articles, актуальность <= 90 дней

#### T8: Simulation / Dry-run
**Input:** Test agent conversation with sample data  
**Assert:** Ответ получен, latency <= 3 сек, no errors

#### T9: Compliance Report
**Input:** Results T1-T8  
**Assert:** JSON report со score (0-100), red/yellow/green per area

#### T10: End-to-End
**Input:** Real Australia instance  
**Assert:** Full validation pipeline completes < 60 сек
