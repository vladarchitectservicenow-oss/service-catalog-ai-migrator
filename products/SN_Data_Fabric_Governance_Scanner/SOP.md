# SOP: SN Data Fabric Governance Scanner (ID 17)
License: AGPL-3.0 | Copyright © 2026 Vladimir Kapustin
Purpose: Scan CMDB/Data Fabric topology against autonomous governance benchmarks.

## Test Suite (10 tests)
1. fetch_cmdb_classes — mock cmdb_ci query
2. detect_orphan_records — records without parent class
3. detect_duplicates — duplicate name + class records
4. governance_score — calculate overall score 0-100
5. benchmark_comparison — against baseline thresholds
6. generate_md_report — markdown output
7. generate_json_report — json output
8. empty_cmdb_handling — empty results safe
9. filter_by_class — filter specific CI class
10. cli_invocation — end-to-end
