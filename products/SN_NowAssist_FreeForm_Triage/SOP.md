# SOP: SN NowAssist FreeForm Triage (ID 14)
License: AGPL-3.0 | Copyright © 2026 Vladimir Kapustin
Purpose: Convert free-form Slack/Teams DMs (e.g. "the thing is broken") into structured ServiceNow catalog items via keyword extraction and confidence scoring.

## Test Suite (10 tests)
| # | Test | Description |
|---|------|-------------|
| 1 | test_parsing_keyword_extraction | Extract keywords from free-form text |
| 2 | test_catalog_match | Match keywords to catalog categories |
| 3 | test_confidence_scoring | Score match confidence 0-1 |
| 4 | test_low_confidence_flag | Flag <0.5 for human review |
| 5 | test_catalog_item_creation | Mock POST to sc_request |
| 6 | test_empty_input | Handle empty/whitespace input gracefully |
| 7 | test_shortcuts_expansion | Expand "VPN" -> "VPN Access Request" |
| 8 | test_multi_category_disambiguation | Pick best category when >1 match |
| 9 | test_cli_run | End-to-end CLI invocation |
| 10 | test_json_report | Validate JSON output structure |
