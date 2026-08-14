# DemoSeed — Architecture Summary

## Product Overview

**DemoSeed** is a ServiceNow scoped application (scope: `x_demoseed`) that generates realistic synthetic data for Performance Analytics dashboards. It enables one-click demo mode population of PA indicators with believable records, complete with data wiping, refresh scheduling, snapshot management, and AI-enhanced description generation.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      REST API Layer                          │
│  POST /api/x_demoseed/v1/execute  │  GET /api/x_demoseed/v1/status │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
┌──────────────▼──────────────────────▼───────────────────────┐
│                   Script Includes                            │
│  ┌─────────────────────┐  ┌─────────────────────────────┐   │
│  │   DemoSeedCore      │  │     DemoSeedHelper          │   │
│  │  - Dashboard Scanner│  │  - Refresh Scheduler        │   │
│  │  - Data Generator   │  │  - Snapshot Manager         │   │
│  │  - Distribution      │  │  - AI Description Generator │   │
│  │    Profiles          │  │  - Field Mapper             │   │
│  │  - Data Wiper        │  │  - Quality Validator        │   │
│  │  - Audit Trail       │  │  - Aging Simulation         │   │
│  └─────────┬───────────┘  └──────────────┬──────────────┘   │
└────────────┼──────────────────────────────┼──────────────────┘
             │                              │
┌────────────▼──────────────────────────────▼──────────────────┐
│                     Data Layer                                │
│  ┌──────────────────┐  ┌────────────────────────────────┐    │
│  │ x_demoseed_config │  │     x_demoseed_audit           │    │
│  │ - Profiles        │  │  - Batch headers               │    │
│  │ - Snapshots       │  │  - Per-record audit entries    │    │
│  │ - AI Prompts      │  │  - Wipe tracking               │    │
│  │ - Field Mappings  │  │                                │    │
│  └──────────────────┘  └────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User configures profile → x_demoseed_config (profile_type, target_tables, volume, date_range)
2. POST /execute?action=generate → DemoSeedCore.generate()
   a. Production guard check
   b. Load profile from x_demoseed_config
   c. Create batch header in x_demoseed_audit
   d. For each target table:
      - Generate records with realistic distributions
      - Insert into target table (incident, change_request, etc.)
      - Create audit entry in x_demoseed_audit
   e. Update batch header with completion status
3. GET /status?batch_id=X → Query x_demoseed_audit for batch details
4. Scheduled job → DemoSeedHelper.refreshDaily()
   a. Iterate active profiles
   b. Generate daily incremental volume
   c. Simulate aging (close old incidents)
5. Snapshot flow: saveSnapshot → x_demoseed_config (config_type=snapshot) → restoreSnapshot → regenerate
```

### Table Schemas

**x_demoseed_config** — Polymorphic config table
| Field | Type | Purpose |
|-------|------|---------|
| name | string | Profile/snapshot/prompt/mapping name |
| config_type | choice | profile, snapshot, ai_prompt, field_map |
| profile_type | choice | ITSM, CSM, HR, SecOps, Custom |
| target_tables | string (JSON) | JSON array of target table names |
| volume | integer | Records per table per generation |
| date_range_days | integer | Date range for generated records |
| snapshot_data | string (JSON) | Serialized snapshot state |
| record_count | integer | Records in snapshot |
| prompt_text | string | AI prompt template text |
| table_name | string | Target table for field mapping |
| field_name | string | Field name for mapping |
| generation_type | string | choice, reference, date, numeric, boolean, string |
| weight_json | string (JSON) | Weight distribution for choice/numeric |
| active | boolean | Active flag |
| description | string | Description or auto-stop date (stop:YYYY-MM-DD) |

**x_demoseed_audit** — Generation audit trail
| Field | Type | Purpose |
|-------|------|---------|
| batch_id | string | UUID linking records to a generation batch |
| target_table | string | Table where record was created |
| record_sys_id | string | sys_id of generated record |
| status | choice | running, complete, failed, wiped |
| total_records | integer | Total records in batch (header only) |
| tables_processed | string (JSON) | Tables processed (header only) |
| started_on | glide_date_time | Batch start time |
| completed_on | glide_date_time | Batch completion time |
| error_log | string (JSON) | Error details |
| wiped | boolean | Whether record has been wiped |
| is_batch_header | boolean | Distinguishes header from detail rows |
| profile_id | string | Reference to config profile |

### Performance Characteristics

- **Dashboard Scanner**: O(D × I × B × S) where D=dashboards, I=indicators, B=breakdowns, S=sources. Typical: 5 dashboards × 10 indicators × 3 breakdowns × 2 sources = 300 GlideRecord queries.
- **Data Generator**: O(V × T) where V=volume, T=tables. 500 records × 3 tables = 1500 inserts. Each insert includes audit trail write.
- **Data Wiper**: O(N) where N=audit entries. Batch delete with audit update per record.
- **Refresh Scheduler**: O(P × V/30) per day. 5 profiles × 16 records = 80 inserts daily.
- **Memory**: Config table stores JSON blobs (snapshot_data up to ~50KB for large batches).

### Security Model

- **Production Guard**: `_isProduction()` checks `glide.installation.production` and `x_demoseed.override_prod` system property before any generation.
- **ACLs**: Role-based access on x_demoseed_config and x_demoseed_audit tables. REST endpoints require authenticated user.
- **Cross-scope**: Requires access to OOTB tables (incident, change_request, sc_request, sc_req_item, change_task, sys_user_group, sys_user, sys_choice, sc_cat_item, sys_pa_dashboards, pa_indicators, pa_breakdowns, pa_indicator_sources, sys_dictionary).
- **Plugin Dependency**: Generative AI Controller (`com.snc.generative_ai`) for AI features (optional — falls back to templates).

### Compatibility

- **Target**: ServiceNow Utah through Australia releases
- **Rhino ES5**: All JavaScript is ES5-compatible (no arrow functions, no let/const, no template literals in source files)
- **Scoped App**: Scope `x_demoseed`, all tables and code within scope
