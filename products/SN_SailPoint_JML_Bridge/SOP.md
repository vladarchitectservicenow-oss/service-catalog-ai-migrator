# SOP: SN SailPoint JML Bridge (ID 18)
License: AGPL-3.0 | Copyright © 2026 Vladimir Kapustin
Purpose: Bridge ServiceNow HR/JML events to SailPoint IdentityIQ/Now for automated access lifecycle.

## Test Suite (10 tests)
1. parse_hr_event — parse sys_user changes
2. fetch_active_user_roles — REST fetch user roles
3. map_to_sailpoint_roles — role mapping config
4. create_identity_request — mock SailPoint API call
5. handle_join_event — new user -> provision
6. handle_move_event — department change -> re-provision
7. handle_leave_event — disable user + revoke access
8. audit_trail_generation — JSON audit log
9. cli_invocation — end-to-end CLI
10. error_handling — failed API -> retry once
