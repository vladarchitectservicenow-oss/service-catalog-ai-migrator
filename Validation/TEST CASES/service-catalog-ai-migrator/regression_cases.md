# Regression Cases: service-catalog-ai-migrator

**Author:** Vladimir Kapustin
**License:** AGPL-3.0-only

## Regression Test Suite

These tests ensure that new changes do not break existing functionality. Run after every code change before merging.

### Core Regression

| ID | Test Case | Expected Behavior | Previous Failures |
|----|-----------|-------------------|-------------------|
| R01 | Idempotent scan execution | Two consecutive scans produce identical output JSON | None |
| R02 | Format consistency across runs | Report format (MD, JSON, CSV) unchanged between versions | None |
| R03 | Role assignment idempotency | Duplicate role assignment handled without error | None |
| R04 | Config persistence | Config values survive CLI restart | None |
| R05 | Template rendering stability | Same input data → same rendered output every time | None |
| R06 | CLI backward compatibility | Old CLI flags still work (deprecated, not removed) | None |

### Integration Regression

| ID | Test Case | Expected Behavior | Previous Failures |
|----|-----------|-------------------|-------------------|
| R07 | Full pipeline no-op | Pipeline with empty instance produces valid empty report | None |
| R08 | SN client response parsing | Response format changes handled by model validation | None |
| R09 | GitHub push auth flow | Token-based push works with both valid and expired tokens | May 2026: token masking |

### Performance Regression

| ID | Test Case | Threshold | Previous Readings |
|----|-----------|-----------|-------------------|
| R10 | Scan 100 records | < 5 seconds | N/A |
| R11 | Generate full TOR | < 3 seconds | N/A |
| R12 | Memory under load | < 500MB for 10k records | N/A |

## Run Protocol

```bash
# Full regression suite
pytest tests/ -v -k "regression" --timeout=60

# Quick smoke test (R01-R06 only)
pytest tests/ -v -k "R01 or R02 or R03 or R04 or R05 or R06"
```

## Failure Protocol

1. **Isolate:** Identify which commit introduced the regression
2. **Document:** Record in this file with date, commit SHA, and symptom
3. **Fix:** Patch source code, re-run regression suite
4. **Verify:** Full suite must pass before merge
5. **Gate:** 3 consecutive regression failures → rollback to last known good commit

## Historical Failures

| Date | Commit | Test | Symptom | Fix |
|------|--------|------|---------|-----|
| - | - | - | No regressions recorded yet | - |
