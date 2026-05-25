# Test Suite SOP: service-catalog-ai-migrator

**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only
**Version:** 2.0
**Last Updated:** 2026-05-25

## Overview

This SOP defines the complete test suite for ServiceNow AI Catalog Migrator — the umbrella orchestrator that automates the full product development lifecycle: research → architecture → generation → testing → deployment → marketing for ServiceNow scoped applications.

## Test Environment

- **Python:** 3.12
- **Framework:** pytest 7.x with pytest-mock, responses, freezegun
- **Mock Targets:** ServiceNow REST API, GitHub API, honcho.db
- **CI:** GitHub Actions (optional)
- **Run command:** `pytest tests/ -v --tb=short`

## Scenarios (12 total)

### P0: Core Functionality (must pass)

| ID | Test | Module | Description |
|----|------|--------|-------------|
| T01 | test_cli_scan_basic | tests/test_cli.py | CLI scan command parses args and invokes client |
| T02 | test_sn_client_auth | tests/servicenow/test_client.py | REST client authenticates with Basic Auth |
| T03 | test_discovery_enumerate_tables | tests/servicenow/test_discovery.py | Discovery module lists all accessible tables |
| T04 | test_fetchers_paginate | tests/servicenow/test_fetchers.py | Fetcher pages through results with sysparm_offset |
| T05 | test_config_load_env | tests/test_config.py | Config reads credentials from environment variables |
| T06 | test_models_valid_data | tests/test_models.py | Pydantic models accept valid scan result data |

### P1: Robustness (should pass)

| ID | Test | Module | Description |
|----|------|--------|-------------|
| T07 | test_sn_client_auth_failure | tests/servicenow/test_client.py | 401 response raises appropriate exception |
| T08 | test_fetchers_empty_table | tests/servicenow/test_fetchers.py | Empty result set handled gracefully |
| T09 | test_generator_tor_output | tests/test_generators.py | TOR generator produces valid Markdown |
| T10 | test_analyzer_bottleneck_detection | tests/test_analyzers.py | Bottleneck finder identifies slow queries |

### P2: Edge Cases (nice to pass)

| ID | Test | Module | Description |
|----|------|--------|-------------|
| T11 | test_sn_client_timeout | tests/servicenow/test_client.py | Connection timeout raises retryable exception |
| T12 | test_discovery_missing_plugin | tests/servicenow/test_discovery.py | Missing plugin returns NOT_CONFIGURED, not FAIL |

## Execution Protocol

1. **Pre-flight:** Verify PDI is awake (optional — mock tests run regardless)
2. **Run:** `pytest tests/ -v --tb=short --timeout=30`
3. **Coverage target:** >= 80% line coverage
4. **Pass threshold:** 10/12 minimum (P0 must all pass, P1 3/4, P2 1/2)
5. **Failure action:** Fix source, re-run, max 3 retries per failure

## Mock Strategy

| External System | Mock Library | Reason |
|----------------|--------------|--------|
| ServiceNow REST API | `responses` | Avoid dependency on live PDI |
| GitHub API | `responses` | No network calls in CI |
| honcho.db | `pytest-mock` + tempfile | Isolated test DB |
| Time-dependent tests | `freezegun` | Deterministic timestamps |

## Reporting

Test results logged to `tests/execution_history/run_<timestamp>.log` with:
- Test name, status, duration
- Stack trace on failure
- Coverage summary
- Environment info (Python version, platform)

## Quality Gates

| Gate | Condition | Action if Fail |
|------|-----------|----------------|
| G0 | All P0 tests pass | CRITICAL — fix before proceeding |
| G1 | >= 80% coverage | Add missing tests |
| G2 | No flaky tests (3 consecutive runs) | Investigate and fix race conditions |
