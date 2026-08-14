# DemoSeed — Dependency Report

## Platform Dependencies

### ServiceNow Version
- **Minimum**: Utah (Q1 2023)
- **Target**: Utah through Australia (2026)
- **Tested**: Washington DC, Vancouver

### Required Plugins

| Plugin ID | Name | Required | Notes |
|-----------|------|----------|-------|
| com.snc.generative_ai | Generative AI Controller | Optional | AI description generation, narrative, quality validation. Falls back to templates if unavailable. |
| com.snc.pa | Performance Analytics | Required | Core dependency — PA dashboards, indicators, breakdowns, sources |

### OOTB Tables Accessed (Cross-Scope)

| Table | Access Type | Purpose |
|-------|-------------|---------|
| incident | Read/Write | Primary target for demo data generation |
| change_request | Read/Write | Change management demo data |
| change_task | Read/Write | Change task demo data |
| sc_request | Read/Write | Service catalog request demo data |
| sc_req_item | Read/Write | Catalog item demo data |
| sys_user_group | Read | Assignment group randomization |
| sys_user | Read | Caller/requester randomization |
| sys_choice | Read | Choice value randomization |
| sc_cat_item | Read | Catalog item reference |
| sys_pa_dashboards | Read | Dashboard scanning |
| pa_indicators | Read | Indicator discovery |
| pa_breakdowns | Read | Breakdown discovery |
| pa_indicator_sources | Read | Source table discovery |
| sys_dictionary | Read | Field schema inspection for mapper |

### Custom Tables

| Table | Scope | Purpose |
|-------|-------|---------|
| x_demoseed_config | x_demoseed | Polymorphic config: profiles, snapshots, AI prompts, field mappings |
| x_demoseed_audit | x_demoseed | Generation audit trail and wipe tracking |

### System Properties

| Property | Default | Purpose |
|----------|---------|---------|
| x_demoseed.override_prod | false | Allow generation on production instances |
| x_demoseed.ai_enabled | false | Enable AI-powered description generation |
| x_demoseed.default_volume | 500 | Default records per table |
| x_demoseed.default_date_range_days | 90 | Default date range |

### Script Includes

| Name | Scope | Lines | Purpose |
|------|-------|-------|---------|
| DemoSeedCore | x_demoseed | 886 | Core engine: scanner, generator, distributions, wiper, audit |
| DemoSeedHelper | x_demoseed | 548 | Support: scheduler, snapshots, AI, field mapper, quality |

### REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/x_demoseed/v1/execute | POST | Action dispatch: generate, wipe, refresh, snapshots, mappings, AI |
| /api/x_demoseed/v1/status | GET | Query: batch status, wipe preview, snapshots, profiles, manifest, field suggestions |

### Business Rules

| Name | Table | Trigger | Purpose |
|------|-------|---------|---------|
| br_auto_wipe | x_demoseed_config | Before delete | Cascade wipe when profile is deleted |
| br_validate_batch | x_demoseed_audit | Before insert | Validate batch_id uniqueness and required fields |

### Scheduled Jobs

| Name | Schedule | Purpose |
|------|----------|---------|
| DemoSeed Daily Refresh | Daily | Run refreshDaily() for all active profiles |

### ACLs

| Table | Operation | Role |
|-------|-----------|------|
| x_demoseed_config | read | x_demoseed.user |
| x_demoseed_config | create/write/delete | x_demoseed.admin |
| x_demoseed_audit | read | x_demoseed.user |
| x_demoseed_audit | create/write/delete | x_demoseed.admin |
| REST execute | execute | x_demoseed.user |
| REST status | execute | x_demoseed.user |

### External Dependencies
- **None**: No external APIs, no third-party services. AI features use ServiceNow's built-in Generative AI Controller (BYOK model).
