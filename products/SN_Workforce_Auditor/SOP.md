# SN Workforce Auditor — Standard Operating Procedure

## 1. Purpose
Audit ServiceNow Autonomous Workforce resolution claims to verify actual vs. reported metrics for the Australian community. The vendor claims 90%+ resolution; this SOP ensures independent, reproducible verification.

## 2. Scope
Applies to all ServiceNow instances using Autonomous Workforce modules within Australia.

## 3. Responsibilities
- Auditor: Execute audits, produce reports, file discrepancy tickets.
- Data Custodian: Provide read-only API access and export historical resolution logs.
- Compliance Officer: Review findings and escalate systemic issues.

## 4. Policy
- AGPL-3.0 licensed. All audit logic is open and reproducible.
- Copyright: Vladimir Kapustin.
- No production data is modified; read-only access only.
- All findings are logged with timestamps and traceability.

## 5. Procedure

### 5.1 Pre-Audit
1. Obtain read-only API credentials scoped to `sn_workforce`, `task`, `sys_audit`.
2. Verify Python 3.10+ and run `pip install -e .` from `products/SN_Workforce_Auditor/`.
3. Confirm network reachability to the ServiceNow instance.

### 5.2 Run Audit
1. Execute `python src/auditor.py --instance <inst> --user <user> --password <pass>`.
2. The auditor will:
   a. Fetch closed/cancelled workforce tasks for the review window.
   b. Cross-reference claimed resolutions against `sys_audit` state changes.
   c. Flag tasks where resolution was reverted, re-opened, or reassigned.
   d. Compute actual resolution rate (resolved_by_bot / total_closed).
3. Results are emitted as structured JSON; discrepancies are written to `discrepancies.json`.

### 5.3 Review
1. Compare actual resolution rate against claimed 90%+.
2. For each discrepancy, inspect root cause:
   - Re-opened after bot closure.
   - Re-assigned to human after bot claimed resolution.
   - Task cancelled rather than resolved.
3. Categorize severity: Minor (<2% variance), Moderate (2-5%), Critical (>5%).

### 5.4 Reporting
1. Generate `audit_report_<YYYY-MM-DD>.json`.
2. Email report to Compliance Officer.
3. File incident tickets for Critical discrepancies.

## 6. Quality Assurance
- Re-run audit on a previous window; expect variance <0.5% to ensure consistency.
- Update test suite (`tests/test_auditor.py`) with any new edge cases discovered.

## 7. Version Control
- All code changes are committed under git in `products/SN_Workforce_Auditor/.
- AGPL-3.0. Copyright: Vladimir Kapustin.
