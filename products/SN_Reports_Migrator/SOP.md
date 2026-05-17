# SN Reports Migrator — Standard Operating Procedure

**Version:** 1.0.0  
**Effective Date:** 2026-05-16  
**Classification:** Internal Use  
**License:** AGPL-3.0  
**Copyright:** Vladimir Kapustin  

## 1. Purpose
This document defines the standard operating procedure (SOP) for migrating deprecated ServiceNow Core UI Reports to Next Experience (UI Builder / Dashboard) compatible report definitions using the SN Reports Migrator.

## 2. Scope
Applies to all ServiceNow instances in the Australian environment where Core UI Reports are still in use and require migration before decommissioning.

## 3. Prerequisites
- SN Reports Migrator Python package installed (`src/migrator.py`).
- Exported Core UI Reports in JSON or XML format from the source instance.
- Target instance running a supported ServiceNow release with Next Experience enabled.
- Valid credentials and import privileges on both source and target instances.
- `python3` and `pytest` installed for local validation.

## 4. Roles & Responsibilities
| Role | Responsibility |
|------|----------------|
| ServiceNow Admin | Export legacy reports; validate migration output; import into target instance. |
| Migration Lead | Coordinate migration batches; review logs; escalate exceptions. |
| QA / SRE | Run unit tests (`pytest tests/test_migrator.py`) prior to each migration run. |

## 5. Procedure
### 5.1 Export Legacy Reports
1. Log in to the source ServiceNow instance as an admin.
2. Navigate to **System Definition > Export Sets** or use background scripts to extract Core UI Report definitions (`sys_report`).
3. Export as JSON. Ensure the export includes at minimum:
   - `sys_id`  
   - `title`  
   - `table`  
   - `type` (legacy report type)  
   - `filter`, `group_by`, `aggregation`, `order_by`  
   - `schedule` and `recipient` fields if applicable.
4. Save the exported file to the `data/` directory alongside this migrator.

### 5.2 Pre-migration Validation
1. Open a terminal in the product root directory.
2. Execute the test suite:
   ```bash
   python3 -m pytest tests/test_migrator.py -v
   ```
3. Confirm all 10 tests pass before proceeding. If any test fails, halt the migration and remediate.

### 5.3 Run Migration
1. Import the exported JSON into your migration script:
   ```python
   from src.migrator import batch_migrate, export_json

   reports = load_my_export("data/exported_reports.json")
   migrated = batch_migrate(reports)
   export_json(migrated, "output/migrated_reports.json")
   ```
2. The migrator performs the following:
   - Maps legacy report types to Next Experience report types.
   - Transforms query filters into encoded query strings where required.
   - Translates groupings and aggregations.
   - Preserves scheduling metadata where structurally compatible.
3. Review the generated migration log for warnings (e.g., unsupported chart types mapped to a default).

### 5.4 Post-migration Validation
1. Run `validate_migration()` against a sample of original-vs-migrated records to confirm:
   - `table` field is preserved.
   - Report type is mapped to a valid Next Experience equivalent.
   - Critical metadata fields are non-empty.
2. Address any validation failures before importing into the target instance.

### 5.5 Import to Target Instance
1. Use ServiceNow Import Sets, REST API (`/api/now/table/sys_report`), or Update Sets to load the migrated definitions.
2. Perform a smoke test by opening a sample of migrated reports in the Next Experience UI.
3. Decommission legacy Core UI Reports only after sign-off from the business owner.

## 6. Risk & Mitigation
| Risk | Mitigation |
|------|------------|
| Unsupported report type | Fallback to a standard list report with a logged warning. |
| Corrupt export data | Validate JSON schema prior to migration; abort on parse errors. |
| Missing target fields | Post-migration validation catches empty critical fields. |
| Schedule incompatibility | Schedules are retained as metadata; test manually post-import. |
| Data loss | Always perform migration in a sub-production instance first; keep backups. |

## 7. References
- ServiceNow Product Documentation: Reports and Dashboards
- ServiceNow Core UI Deprecation Notice (Australian region advisory)
- SN Reports Migrator source code: `src/migrator.py`
- Unit tests: `tests/test_migrator.py`
