# SOP: SN Security Migrator — ServiceNow Security Migration Job Cleaner
## Product ID: 8 | Release: ZURICH | Thread: v5-2026-05-16
## Copyright: Vladimir Kapustin | License: AGPL-3.0

---

### Objective
После апгрейда Zurich администраторы получают повторяющиеся уведомления о падении security migration jobs. Причина — устаревшие скрипты и запланированные задачи. Сканер находит failed jobs, генерирует fix scripts, отключает/исправляет задачи.

### Test Plan (10 tests)

#### T1: Instance Connection + sys_schedule Scan
#### T2: Detect failed security migration jobs (state=failure, name LIKE '%security%')
#### T3: Identify root artifacts (sys_trigger, ecc_agent, legacy mid server)
#### T4: Classify failure types (ACL, encryption key, password, snc_identity)
#### T5: Generate fix script for password migration
#### T6: Generate fix script for encryption key sync
#### T7: Generate fix script for ACL migration
#### T8: Safety check — preview mode, no destructive changes
#### T9: Export HTML report with failed jobs + fix scripts
#### T10: End-to-end pipeline (scan → classify → generate → export)
