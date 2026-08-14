# DemoSeed — Test Suite SOP

## Overview

This document defines the Standard Operating Procedure for testing DemoSeed. All tests must pass before any release. The test suite covers 50 scenarios across 10 functional areas.

## Test Environment

- **Runtime**: Node.js with ServiceNow mock runtime (GlideRecord, GlideDateTime, gs, Class, sn_generative_ai)
- **Test File**: `tests/test_demoseed.js`
- **Execution**: `node tests/test_demoseed.js`
- **Exit Code**: 0 = all pass, 1 = one or more failures

## Test Scenarios

### T01-T05: Dashboard Scanner

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T01 | scanDashboards returns manifest with dashboards | Seeded PA dashboard data | manifest.dashboards.length > 0, name = 'itsm_overview' | Positive |
| T02 | scanDashboards includes indicators | Seeded PA indicator data | manifest.indicators['ind001'] exists, type = 'count' | Positive |
| T03 | scanDashboards includes breakdowns | Seeded PA breakdown data | manifest.indicators['ind001'].breakdowns.length > 0 | Positive |
| T04 | scanDashboards includes source tables | Seeded PA source data | manifest.source_tables['incident'] exists | Positive |
| T05 | getIndicatorSources returns table names | indicator sys_id = 'ind001' | Returns array containing 'incident' | Positive |

### T06-T10: Data Generator

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T06 | generate creates batch and returns batch_id | profile='prof001', volume=10, days=7 | result.batch_id exists, total_records > 0 | Positive |
| T07 | generate populates incident table | profile='prof001', volume=10, days=7 | GlideRecord._store['incident'] has records with short_description and priority | Positive |
| T08 | generate populates change_request table | profile='prof001', volume=10, days=7 | GlideRecord._store['change_request'] has records | Positive |
| T09 | generate creates audit trail | profile='prof001', volume=10, days=7 | x_demoseed_audit has batch header + detail entries | Positive |
| T10 | generate respects production guard | Production=true, no override | Returns error object | Negative |

### T11-T15: Distribution Profiles

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T11 | _getPriority returns valid values | 100 iterations | All values in ['1','2','3','4'] | Positive |
| T12 | _getCategory returns valid values | 100 iterations | All values in ['hardware','software','network','access','other'] | Positive |
| T13 | _getRiskLevel returns valid values | 100 iterations | All values in ['low','moderate','high','critical'] | Positive |
| T14 | _getRandomDate returns date within range | 50 iterations, 7-day range | All dates >= start, <= end | Positive |
| T15 | _getRandomChoice returns from choice list | table='incident', field='priority' | Value in ['1','2','3','4'] | Positive |

### T16-T20: Data Wiper

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T16 | wipeBatch removes generated records | Generate then wipe by batch_id | wiped_count > 0 | Positive |
| T17 | wipeBatch marks audit entries as wiped | Generate then wipe | Audit entries have wiped='true' | Positive |
| T18 | getWipePreview returns counts | Generate then preview | total_records > 0, by_table['incident'] > 0 | Positive |
| T19 | wipeAll removes all DemoSeed data | Generate then wipeAll | wiped_count > 0 | Positive |
| T20 | wipeByDateRange removes records in range | Generate then wipe by date range | wiped_count > 0 | Positive |

### T21-T25: Refresh Scheduler

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T21 | refreshDaily processes active profiles | Active profile exists | profiles_processed > 0, total_new_records > 0 | Positive |
| T22 | _simulateAging closes old incidents | 5 old incidents (30+ days) | Old incidents have state='7' | Positive |
| T23 | shouldStop returns true for expired profile | Profile with stop:2020-01-01 | Returns true | Positive |
| T24 | shouldStop returns false for active profile | Profile without stop date | Returns false | Positive |
| T25 | refreshDaily skips auto-stopped profiles | One active + one stopped profile | profiles_processed = 1 | Positive |

### T26-T30: Snapshot Manager

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T26 | saveSnapshot creates snapshot config record | Generate data, save snapshot | Returns sys_id, config_type='snapshot' | Positive |
| T27 | saveSnapshot stores record count | Generate data, save snapshot | record_count > 0 | Positive |
| T28 | restoreSnapshot regenerates data | Save snapshot, then restore | total_records > 0 | Positive |
| T29 | exportXML returns valid XML | Save snapshot, export | Starts with '<?xml', contains <DemoSeedSnapshot> | Positive |
| T30 | restoreSnapshot returns error for missing snapshot | snapshot_id='nonexistent' | result.error exists | Negative |

### T31-T35: Field Mapper

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T31 | suggestMappings returns suggestions for known table | Seeded sys_dictionary for x_custom_table | suggestions.length > 0, no sys_ fields | Positive |
| T32 | suggestMappings detects choice fields | Field with choice=4 | suggested_type = 'choice' | Positive |
| T33 | suggestMappings detects reference fields | Field with reference='sys_user' | suggested_type = 'reference' | Positive |
| T34 | applyMapping creates config records | 2 mappings for x_custom_table | created = 2, records in x_demoseed_config | Positive |
| T35 | generateField returns value for each type | All 6 types (choice, reference, date, numeric, boolean, string) | Non-null value for each | Positive |

### T36-T40: AI Features

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T36 | generateDescriptions returns templates when AI disabled | AI disabled, table='incident', count=5 | 5 descriptions, each > 10 chars | Positive |
| T37 | generateDescriptions falls back to templates on AI error | AI enabled but no prompt configured | Returns descriptions (template fallback) | Positive |
| T38 | generateDemoNarrative returns template when AI disabled | AI disabled, dashboard data | Contains 'Demo Data Summary' and 'Recommended talking points' | Positive |
| T39 | validateDataQuality detects time clustering | 20 records all at same hour | issues.length > 0 | Positive |
| T40 | validateDataQuality detects high P1 ratio | 20 records, 10 P1 | issues.length > 0 | Positive |

### T41-T45: Edge Cases

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T41 | generate with missing profile returns error | profile_id='nonexistent' | result.error exists | Negative |
| T42 | generate with empty target_tables uses defaults | Profile with target_tables='[]' | total_records > 0 (uses ITSM defaults) | Edge |
| T43 | wipeBatch with nonexistent batch returns zero | batch_id='nonexistent_batch' | wiped_count = 0 | Edge |
| T44 | generate handles table insert failures gracefully | Profile with nonexistent_table | total_records = 0, batch created, no crash | Edge |
| T45 | generate with specific dashboard filter works | dashboardSysIds=['dash001'] | manifest.dashboards.length = 1 | Positive |

### T46-T50: REST Endpoint Logic

| ID | Scenario | Input | Expected Output | Type |
|----|----------|-------|-----------------|------|
| T46 | POST execute generate action works | action='generate', profile_id='prof001' | batch_id exists, total_records > 0 | Positive |
| T47 | POST execute wipe_batch action works | Generate then wipe by batch_id | wiped_count > 0 | Positive |
| T48 | GET status batch query works | Query by batch_id | Batch header found, status='complete' | Positive |
| T49 | GET status wipe_preview works | Generate then preview | total_records > 0 | Positive |
| T50 | POST execute unknown action returns error info | action='invalid_action' | Default case exists with valid_actions array | Negative |

## Test Execution

```bash
cd products/SN_DemoSeed
node tests/test_demoseed.js
```

## Pass Criteria

- All 50 tests must pass
- Exit code must be 0
- No unhandled exceptions
- All mock stores properly reset between tests via setupTestData()

## Failure Response

1. Identify failing test by ID
2. Check mock data setup in setupTestData()
3. Verify source code logic matches expected behavior
4. Fix source code or test expectation
5. Re-run full suite
6. Document fix in execution history
