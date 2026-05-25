# service-catalog-ai-migrator Risk Report

**Generated:** 2026-05-25
**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only

## Risk Matrix

| ID | Risk | Probability | Impact | Severity | Status |
|----|------|------------|--------|----------|--------|
| R01 | PDI instance hibernates during scan | High | High | P0 Critical | Mitigated |
| R02 | GitHub personal access token expires | Medium | High | P0 Critical | Mitigated |
| R03 | ServiceNow REST API rate limiting | Medium | Medium | P1 High | Mitigated |
| R04 | honcho.db SQLite corruption | Low | High | P1 High | Open |
| R05 | Jinja2 template syntax error at runtime | Low | Medium | P2 Medium | Mitigated |
| R06 | Generated scoped app import fails on PDI | Medium | High | P1 High | Open |
| R07 | Credential leakage in generated artifacts | Low | Critical | P0 Critical | Mitigated |
| R08 | Concurrent pipeline runs conflict | Medium | Medium | P1 High | Open |
| R09 | Python dependency breakage on upgrade | Low | Medium | P2 Medium | Open |
| R10 | /tmp state files lost (tmpwatch) | High | Medium | P1 High | Mitigated |
| R11 | Large instance (50k+ records) OOM | Medium | Medium | P2 Medium | Open |
| R12 | Unicode encoding errors in reports | Low | Low | P3 Low | Mitigated |

## P0 Critical (Must Fix)

### R01: PDI Hibernation
- **Cause:** ServiceNow PDIs auto-hibernate after ~10 days of inactivity
- **Impact:** All REST API calls return 503; pipeline stalls
- **Mitigation:** Pre-flight health check via `api/now/stats/incident?sysparm_count=true` before scan. If 503, log status and exit gracefully.
- **Fallback:** Manual wake via developer.servicenow.com → Manage Instances → Wake

### R02: GitHub PAT Expiration
- **Cause:** Classic PATs can expire or be revoked
- **Impact:** All git push operations fail with 401
- **Mitigation:** Token validation in Python (length >30, no ellipsis). If invalid, archive to /tmp/*.tar.gz and notify.
- **Fallback:** Local archive → manual push later

### R07: Credential Leakage
- **Cause:** Hardcoded passwords in generated source code or reports
- **Impact:** Public GitHub repo exposes PDI credentials
- **Mitigation:** Pre-commit scan via `grep -rPn 'password=|DEFAULT_PASS'`. All creds from env vars only, fallback is empty string.

## P1 High (Should Fix)

### R03: API Rate Limiting
- **Mitigation:** Exponential backoff: 1s → 2s → 4s → 8s, max 3 retries
- **Impact:** Scan takes longer but completes

### R06: Scoped App Import Failure
- **Cause:** UUID cross-scope references, plugin gaps, XML malformation
- **Mitigation:** Validate sys_app.xml against XSD before push. Smoke test on PDI via Background Script.
- **Status:** Partially mitigated — full PDI testing is deferred

### R08: Concurrent Runs
- **Cause:** Two cron jobs or manual runs executing simultaneously
- **Impact:** Race condition on honcho.db writes, duplicate git commits
- **Mitigation:** File lock via `/tmp/scam.lock`; check before starting

### R10: /tmp State File Loss
- **Cause:** tmpwatch or reboot cleans `/tmp/repo_list.json`, `/tmp/pipeline_progress.json`
- **Mitigation:** Reconstruct from GitHub API (repo list + contents API for Phase doc detection)
- **Status:** Mitigated — reconstruction pipeline verified May 2026

## P2 Medium (Nice to Fix)

### R09: Dependency Breakage
- **Mitigation:** Pin all deps in pyproject.toml with exact versions; use pip-tools for lockfile

### R11: Large Instance OOM
- **Mitigation:** Chunked pagination (500 records/batch); streaming JSON parser

## P3 Low

### R12: Unicode Errors
- **Mitigation:** All file I/O uses `encoding='utf-8'`; `ensure_ascii=False` on all json.dump calls
