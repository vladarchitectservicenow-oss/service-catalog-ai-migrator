# SOP: SN CSA Exam Drift Detector (ID 15)
License: AGPL-3.0 | Copyright © 2026 Vladimir Kapustin
Purpose: Compare current instance feature set against CSA exam syllabus to detect drift between releases.

## Test Suite (10 tests)
1. fetch_instance_version — mock sys_properties
2. load_syllabus — embedded JSON syllabus loads
3. detect_added_features — instance has feature absent in syllabus
4. detect_removed_features — syllabus has feature absent in instance
5. score_drift — compute drift percentage
6. report_generation — JSON + MD reports
7. filter_by_category — filter by exam domain
8. empty_syllabus_fallback — missing syllabus json
9. cli_invocation — end-to-end CLI
10. multiple_releases — Zurich vs Australia syllabus support
