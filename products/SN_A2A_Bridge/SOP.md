# SOP: SN A2A Bridge — ServiceNow A2A Protocol Integration Bridge
## Product ID: 7 | Release: AUSTRALIA
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### Objective
Автоматический сканер и мигратор external agent интеграций с deprecated manual на A2A Protocol. Проверяет соответствие A2A spec, генерирует новые конфигурации.

### Test Plan (10 tests)

#### T1: External Agent Enumeration (sn_agent type=external)
#### T2: Detect deprecated integration_type (manual, webhook) vs A2A
#### T3: Generate A2A Protocol config from legacy webhook endpoint
#### T4: Validate A2A required fields (protocol_version, agent manifest, capabilities)
#### T5: Check A2A client authentication (OAuth 2.0 / mTLS)
#### T6: Detect circular dependencies between agents
#### T7: Compatibility matrix: which legacy patterns map to A2A
#### T8: Export migration script for automated deployment
#### T9: HTML report with before/after agent topology
#### T10: End-to-end (scan → detect → generate → validate → export)
