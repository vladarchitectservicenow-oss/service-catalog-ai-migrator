# DemoSeed — Risk Report

## Risk Register

### R01: Production Data Corruption
- **Severity**: P0 (Critical)
- **Category**: Data Integrity
- **Description**: Accidental generation of synthetic data on a production instance could pollute real data, skew reports, and trigger false alerts.
- **Mitigation**: Production guard (`_isProduction()`) blocks generation unless `x_demoseed.override_prod=true` is explicitly set. Guard checked at entry point of `generate()`.
- **Residual Risk**: Low — requires explicit admin override.

### R02: Performance Degradation from Bulk Inserts
- **Severity**: P1 (High)
- **Category**: Performance
- **Description**: Generating 500+ records per table across multiple tables can cause transaction log growth, index fragmentation, and temporary performance impact.
- **Mitigation**: Records generated sequentially (not in batch). Audit trail provides visibility. Volume configurable per profile.
- **Residual Risk**: Medium — large volumes on under-provisioned instances may cause slowdowns.

### R03: Orphaned Audit Records After Manual Deletion
- **Severity**: P2 (Medium)
- **Category**: Data Integrity
- **Description**: If generated records are deleted outside DemoSeed (e.g., via list view delete), audit entries remain with `wiped=false`, causing wipe operations to attempt deletion of non-existent records.
- **Mitigation**: Wipe operations use `targetGr.get(recordSysId)` before delete — gracefully skips missing records. Audit entries updated to `wiped=true` on successful wipe.
- **Residual Risk**: Low — handled gracefully.

### R04: AI Feature Dependency on Plugin Availability
- **Severity**: P2 (Medium)
- **Category**: Feature Availability
- **Description**: AI description generation, narrative, and quality validation depend on Generative AI Controller plugin. If plugin is not activated or BYOK model not configured, AI features are unavailable.
- **Mitigation**: All AI methods check `x_demoseed.ai_enabled` property and fall back to template-based generation. AI calls wrapped in try/catch with graceful degradation.
- **Residual Risk**: Low — templates provide acceptable fallback.

### R05: Snapshot Data Size Limits
- **Severity**: P2 (Medium)
- **Category**: Storage
- **Description**: Snapshot data stored as JSON string in `x_demoseed_config.snapshot_data` field. Large batches (10K+ records) could produce JSON exceeding field size limits.
- **Mitigation**: Snapshot stores metadata (batch IDs, counts, profile reference), not individual record data. Restore regenerates from profile parameters.
- **Residual Risk**: Low — snapshot data is metadata-only.

### R06: Cross-Scope Access Denial
- **Severity**: P1 (High)
- **Category**: Security/Configuration
- **Description**: GlideRecord queries against OOTB tables (incident, change_request, etc.) require cross-scope access privileges. Without them, queries return zero results silently.
- **Mitigation**: Cross-scope access records defined in sys_app.xml for all 14 OOTB tables. READ access for querying, WRITE access for insert/update/delete.
- **Residual Risk**: Medium — requires correct cross-scope privilege configuration during installation.

### R07: Concurrent Batch Conflicts
- **Severity**: P2 (Medium)
- **Category**: Concurrency
- **Description**: Multiple simultaneous generate calls could create overlapping audit entries or exceed instance capacity.
- **Mitigation**: Each generate call creates a unique batch_id via `gs.generateGUID()`. No shared state between instances. Instance capacity managed by admin through volume settings.
- **Residual Risk**: Low — batch isolation prevents data conflicts.

### R08: Scheduled Job Overlap with Manual Generation
- **Severity**: P3 (Low)
- **Category**: Operations
- **Description**: Daily refresh scheduled job could overlap with manual generation, causing double-counting or performance contention.
- **Mitigation**: Refresh generates small daily volumes (volume/30). Manual generation is typically ad-hoc. No locking mechanism needed for demo data.
- **Residual Risk**: Low — impact is cosmetic (extra demo data).

### R09: Field Mapper Schema Drift
- **Severity**: P3 (Low)
- **Category**: Maintenance
- **Description**: If target table schema changes (fields added/removed/renamed), existing field mappings become stale and generation may fail or produce incorrect data.
- **Mitigation**: `suggestMappings()` dynamically reads `sys_dictionary` to detect current schema. `applyMapping()` creates new mappings. Stale mappings produce empty values (graceful).
- **Residual Risk**: Low — requires admin to re-run mapper after schema changes.

### R10: Wipe Operation on Shared Tables
- **Severity**: P1 (High)
- **Category**: Data Integrity
- **Description**: Wipe operations delete records from OOTB tables (incident, change_request, etc.). If non-DemoSeed records share these tables, accidental wipe could remove real data.
- **Mitigation**: Wipe only targets records tracked in `x_demoseed_audit` with matching `record_sys_id`. Non-DemoSeed records are never touched. `getWipePreview()` shows exactly what will be deleted before execution.
- **Residual Risk**: Low — audit-trail-gated deletion.

### R11: ES5 Compatibility in Rhino Engine
- **Severity**: P2 (Medium)
- **Category**: Compatibility
- **Description**: ServiceNow Rhino engine supports ES5 only. Modern JS features (arrow functions, let/const, template literals, Array.find, Object.keys on non-plain objects) cause runtime errors.
- **Mitigation**: All source code verified ES5-compatible. Tests run under Node.js with ES5-level mocks. No ES6+ features in production code.
- **Residual Risk**: Low — verified by test suite.

### R12: AI Prompt Injection
- **Severity**: P3 (Low)
- **Category**: Security
- **Description**: AI prompts stored in `x_demoseed_config` could be modified by malicious admin to inject harmful content or exfiltrate data via GenAI responses.
- **Mitigation**: AI prompts only editable by `x_demoseed.admin` role. GenAI calls use instance-local BYOK model — no data leaves the instance.
- **Residual Risk**: Low — admin-gated and instance-local.
