# DemoSeed — Edge Cases

## Overview

Edge cases test boundary conditions, unexpected inputs, and failure modes. These cases complement the standard test suite by probing the limits of the system.

## Edge Case Scenarios

### E01: Zero Volume Generation
- **Area**: Data Generator
- **Input**: volume=0, profile with target_tables=['incident']
- **Expected**: total_records=0, batch created with status='complete', no errors
- **Rationale**: Zero volume is valid — admin may want to test batch creation without data

### E02: Negative Date Range
- **Area**: Data Generator
- **Input**: date_range_days=-30
- **Expected**: startDate is after endDate, _getRandomDate may produce dates outside intuitive range, but no crash
- **Rationale**: Negative date range is invalid input but should not crash

### E03: Empty Profile Name
- **Area**: Snapshot Manager
- **Input**: saveSnapshot('', 'description')
- **Expected**: Snapshot created with empty name, sys_id returned
- **Rationale**: Empty name is unusual but not invalid — system should handle gracefully

### E04: Snapshot with No Data
- **Area**: Snapshot Manager
- **Input**: saveSnapshot() before any generation
- **Expected**: Snapshot created with total_records=0, empty batches array
- **Rationale**: Empty snapshots are valid — captures "clean slate" state

### E05: Restore from Corrupted Snapshot
- **Area**: Snapshot Manager
- **Input**: Snapshot with snapshot_data='{invalid json'
- **Expected**: Returns error 'Invalid snapshot data'
- **Rationale**: Corrupted data should produce clear error, not crash

### E06: Wipe with Mixed Record States
- **Area**: Data Wiper
- **Input**: Some audit entries already wiped=true, some wiped=false
- **Expected**: Only wiped=false entries are processed, wiped=true entries skipped
- **Rationale**: Partial wipes from prior operations should not cause double-delete attempts

### E07: Field Mapper on Non-Existent Table
- **Area**: Field Mapper
- **Input**: suggestMappings('nonexistent_table') with no sys_dictionary entries
- **Expected**: Returns empty array, no crash
- **Rationale**: Unknown tables should return empty suggestions

### E08: AI Prompt with Special Characters
- **Area**: AI Features
- **Input**: AI prompt text containing {, }, ", \n, unicode characters
- **Expected**: Prompt stored and retrieved correctly, replacements work
- **Rationale**: Prompt templates may contain JSON-like structures or special chars

### E09: Concurrent Wipe and Generate
- **Area**: Concurrency
- **Input**: Generate batch, then wipe same batch while generation is conceptually in progress
- **Expected**: Wipe targets only records with matching batch_id, no cross-batch interference
- **Rationale**: Operations on different batches should not interfere

### E10: Profile with All Table Types
- **Area**: Data Generator
- **Input**: Profile with target_tables=['incident','change_request','change_task','sc_request','sc_req_item']
- **Expected**: All 5 table types populated, each with correct field structure
- **Rationale**: Maximum table diversity in single batch

### E11: Refresh with No Active Profiles
- **Area**: Refresh Scheduler
- **Input**: No active profiles in x_demoseed_config
- **Expected**: profiles_processed=0, total_new_records=0, no errors
- **Rationale**: Empty state is valid — nothing to refresh

### E12: XML Export with Special Characters in Data
- **Area**: Snapshot Manager
- **Input**: Snapshot with name containing <, >, &, "
- **Expected**: XML output has properly escaped characters (&lt;, &gt;, &amp;, &quot;)
- **Rationale**: XML injection prevention via _xmlEscape()

### E13: getWipePreview with No Data
- **Area**: Data Wiper
- **Input**: getWipePreview() before any generation
- **Expected**: total_records=0, by_table={}
- **Rationale**: Empty preview is valid

### E14: generateField with Unknown Type
- **Area**: Field Mapper
- **Input**: generateField('incident', 'test', 'unknown_type')
- **Expected**: Returns empty string (default case in _generateFieldValue switch)
- **Rationale**: Unknown generation types should not crash

### E15: Dashboard Scanner with No Dashboards
- **Area**: Dashboard Scanner
- **Input**: Empty sys_pa_dashboards store
- **Expected**: manifest.dashboards=[], manifest.indicators={}, manifest.source_tables={}
- **Rationale**: Empty PA environment is valid
