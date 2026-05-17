# SOP: SN Upgrade Preview Validator (ID 13)

**Product:** ServiceNow Upgrade Preview Validator  
**Release:** ZURICH  
**License:** AGPL-3.0 | Copyright © 2026 Vladimir Kapustin  
**Purpose:** Automate validation of upgrade-preview skipped records by diffing against a known baseline and generating a human-readable delta report.

## 1. Scope
- Export skipped records from `sys_upgrade_history_log` via REST.
- Load a baseline snapshot (sys_update_xml from prior upgrade or exported update set).
- Compute delta: added / removed / modified / ambiguous skipped records.
- Generate JSON + Markdown report with per-record verdict.
- 10+ automated tests with REST mocks (no real instance auth required).

## 2. Test Suite (11 tests)

| # | Test | Description |
|---|------|-------------|
| 1 | `test_fetch_skipped_records` | Mock `/api/now/table/sys_upgrade_history_log` returns 3 skipped records. |
| 2 | `test_baseline_load` | Mock baseline JSON snapshot loads 3 expected records. |
| 3 | `test_delta_added` | Detects 1 new skipped record absent in baseline. |
| 4 | `test_delta_removed` | Detects 1 baseline record no longer skipped. |
| 5 | `test_delta_modified` | Detects 1 record where payload hash changed versus baseline. |
| 6 | `test_delta_hash_unchanged` | Identifies 1 record hash-identical to baseline (safe). |
| 7 | `test_report_markdown_output` | Report contains 'Status' table with added/modified/safe rows. |
| 8 | `test_report_json_structure` | JSON report includes `added`, `removed`, `modified`, `safe` arrays. |
| 9 | `test_filter_by_table` | CLI `--table sys_script` reduces output to only script records. |
| 10 | `test_empty_baseline` | Handles missing baseline gracefully (all skipped = new). |
| 11 | `test_cli_run` | End-to-end CLI invocation returns exit code 0 and writes to `--output`. |

## 3. Architecture
- `src/validator.py` — fetch, diff, report engine.
- `src/cli.py` — argparse wrapper, writes markdown + JSON.
- `tests/test_validator.py` — pytest self-contained mocks.

## 4. Acceptance Criteria
- All 11 tests PASS (`pytest -q`).
- CLI outputs valid JSON to `--output`.
- Copyright header present in every file.
