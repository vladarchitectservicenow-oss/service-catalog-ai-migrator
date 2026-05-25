# service-catalog-ai-migrator Dependency Report

**Generated:** 2026-05-25
**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only

## Python Dependencies

| Package | Version | Purpose | Required |
|---------|---------|---------|----------|
| requests | >=2.31 | HTTP client for ServiceNow REST API | Yes |
| jinja2 | >=3.1 | Template rendering engine | Yes |
| pydantic | >=2.0 | Data model validation | Yes |
| pytest | >=7.0 | Test framework | Dev |
| pytest-cov | >=4.0 | Coverage reporting | Dev |
| ruff | >=0.4 | Linting | Dev |
| mypy | >=1.0 | Static type checking | Dev |

## ServiceNow Platform Dependencies

| Plugin / Feature | ID | Required | Notes |
|-----------------|-----|---------|-------|
| REST API Plugin | com.glide.rest | Yes | Core transport |
| Table API | com.glideapp.servicecatalog | No | For catalog scanning |
| Flow Designer | com.glide.hub | No | Workflow analysis |
| IntegrationHub | com.glide.hub.integrations | No | Integration mapping |

## External Services

| Service | Endpoint | Scope | Auth Method |
|---------|----------|-------|-------------|
| ServiceNow PDI | https://dev362840.service-now.com | REST API | Basic Auth |
| GitHub API | https://api.github.com | Repo management | PAT (classic) |
| honcho.db | Local SQLite | Idea deduplication | File access |

## Test Dependencies

| Tool | Version | Purpose |
|------|---------|---------|
| pytest | >=7.0 | Test runner |
| pytest-mock | >=3.0 | Mocking framework |
| responses | >=0.23 | HTTP mock for SN API |
| freezegun | >=1.2 | Time freezing for deterministic tests |

## Version Compatibility

| Component | Minimum | Maximum | Tested |
|-----------|---------|---------|--------|
| Python | 3.10 | 3.13 | 3.12 |
| ServiceNow | Utah | Australia | Australia |
| Jinja2 | 3.1 | 3.x | 3.1.4 |
| Pydantic | 2.0 | 2.x | 2.7 |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| REST API rate limiting | Medium | Exponential backoff + retry |
| PDI hibernation | High | Status check before every run |
| GitHub PAT expiration | High | Cron pre-check + archive fallback |
| Dependency version conflict | Low | pin in pyproject.toml |
| honcho.db corruption | Medium | Backup before every write |
