# SOP: SN Flow Designer Documenter (ID 16)
License: AGPL-3.0 | Copyright © 2026 Vladimir Kapustin
Purpose: Auto-document Flow Designer custom actions and flows by scanning instance tables and generating Markdown + JSON docs.

## Test Suite (10 tests)
1. fetch_custom_actions — mock sys_hub_action_type_definition
2. fetch_flows — mock sys_hub_flow
3. extract_inputs — parse input vars
4. extract_outputs — parse output vars
5. generate_markdown — MD contains action names and variables
6. generate_json — JSON structure valid
7. empty_flow_handling — no flows = empty section
8. missing_description_warning — flag actions without description
9. cli_invocation — end-to-end CLI
10. batch_documentation — document >1 action at once
