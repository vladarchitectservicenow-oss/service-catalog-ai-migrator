# DemoSeed — Regression Cases

## Overview

Regression cases verify that existing functionality is not broken by code changes. These cases must be run after any modification to DemoSeedCore, DemoSeedHelper, REST endpoints, or table schemas.

## Regression Test Cases

### R01: Dashboard Scanner — Full Manifest
- **Area**: Dashboard Scanner
- **Test**: Generate a full manifest from seeded PA data and verify all components
- **Steps**:
  1. Seed PA dashboards, indicators, breakdowns, sources
  2. Call `scanDashboards()` with no filter
  3. Verify dashboards array is non-empty
  4. Verify indicators object has expected keys
  5. Verify breakdowns are attached to correct indicators
  6. Verify source_tables mapping is correct
- **Expected**: All PA components correctly mapped in manifest

### R02: Data Generator — All Table Types
- **Area**: Data Generator
- **Test**: Generate data for all supported table types in one batch
- **Steps**:
  1. Create profile with target_tables=['incident','change_request','change_task']
  2. Call `generate('prof001', 20, 30)`
  3. Verify incident records have short_description, priority, category, state
  4. Verify change_request records have type, risk, state, start_date, end_date
  5. Verify change_task records have short_description, state, assignment_group
- **Expected**: All three table types populated with correct field values

### R03: Data Wiper — Full Cycle
- **Area**: Data Wiper
- **Test**: Generate → Wipe → Verify cleanup
- **Steps**:
  1. Generate 50 records across 3 tables
  2. Record pre-wipe counts per table
  3. Call `wipeAll()`
  4. Verify wiped_count matches generated count
  5. Verify audit entries marked wiped='true'
  6. Verify batch header status updated to 'wiped'
- **Expected**: All generated records removed, audit trail updated

### R04: Snapshot — Save and Restore
- **Area**: Snapshot Manager
- **Test**: Full snapshot lifecycle
- **Steps**:
  1. Generate 30 records
  2. Save snapshot with name and description
  3. Wipe all data
  4. Restore from snapshot
  5. Verify record count matches original
  6. Export snapshot as XML and verify structure
- **Expected**: Snapshot captures state, restore reproduces it

### R05: Refresh Scheduler — Multi-Profile
- **Area**: Refresh Scheduler
- **Test**: Daily refresh with multiple active profiles
- **Steps**:
  1. Seed 3 active profiles (ITSM, CSM, HR)
  2. Call `refreshDaily()`
  3. Verify profiles_processed = 3
  4. Verify total_new_records > 0
  5. Verify each profile's target tables received records
- **Expected**: All active profiles processed, records generated

### R06: Production Guard — All Entry Points
- **Area**: Security
- **Test**: Verify production guard blocks all generation paths
- **Steps**:
  1. Set `glide.installation.production = 'true'`
  2. Call `generate()` — verify error returned
  3. Call `refreshDaily()` — verify no records generated (guard in generate())
  4. Set `x_demoseed.override_prod = 'true'`
  5. Call `generate()` — verify succeeds
- **Expected**: Guard blocks unless explicitly overridden

### R07: Field Mapper — Schema Change Resilience
- **Area**: Field Mapper
- **Test**: Mapper handles schema changes gracefully
- **Steps**:
  1. Seed sys_dictionary with 5 fields for custom table
  2. Call `suggestMappings('x_custom_table')`
  3. Verify 5 suggestions returned
  4. Remove 2 fields from sys_dictionary (simulate schema change)
  5. Call `suggestMappings('x_custom_table')` again
  6. Verify only 3 suggestions returned
- **Expected**: Mapper reflects current schema, not cached state

### R08: AI Fallback — All Methods
- **Area**: AI Features
- **Test**: All AI methods fall back to templates when AI disabled
- **Steps**:
  1. Set `x_demoseed.ai_enabled = 'false'`
  2. Call `generateDescriptions('incident', 5)` — verify 5 template descriptions
  3. Call `generateDemoNarrative({...})` — verify template narrative
  4. Call `validateDataQuality([...])` — verify basic quality check
  5. Set `x_demoseed.ai_enabled = 'true'` (no prompt configured)
  6. Repeat all three calls — verify still returns results (template fallback)
- **Expected**: All methods return valid results regardless of AI availability

### R09: REST Endpoints — Error Handling
- **Area**: REST API
- **Test**: All error paths return proper HTTP status and JSON
- **Steps**:
  1. POST /execute with action='invalid' — verify 400 with valid_actions list
  2. POST /execute with missing required params — verify graceful handling
  3. GET /status with nonexistent batch_id — verify batch.error returned
  4. GET /status with no params — verify empty result with queried_at timestamp
- **Expected**: All errors return structured JSON, never crash

### R10: Concurrent Operations — Isolation
- **Area**: Concurrency
- **Test**: Multiple generate calls produce isolated batches
- **Steps**:
  1. Call `generate('prof001', 10, 7)` — capture batch_id_1
  2. Call `generate('prof001', 10, 7)` — capture batch_id_2
  3. Verify batch_id_1 !== batch_id_2
  4. Verify both batches have independent audit entries
  5. Wipe batch_id_1 only
  6. Verify batch_id_2 records still exist
- **Expected**: Batches are fully isolated

### R11: Wipe Preview Accuracy
- **Area**: Data Wiper
- **Test**: Wipe preview matches actual wipe count
- **Steps**:
  1. Generate 25 records
  2. Call `getWipePreview(batch_id)` — capture preview count
  3. Call `wipeBatch(batch_id)` — capture actual wiped_count
  4. Verify preview.total_records === actual wiped_count
- **Expected**: Preview accurately predicts wipe count

### R12: Large Volume Generation
- **Area**: Performance
- **Test**: Generator handles larger volumes without errors
- **Steps**:
  1. Create profile with volume=200
  2. Call `generate('prof001', 200, 30)`
  3. Verify total_records approximately 600 (200 × 3 tables)
  4. Verify no errors in result.errors
  5. Verify batch header shows status='complete'
- **Expected**: Large volumes complete without errors
