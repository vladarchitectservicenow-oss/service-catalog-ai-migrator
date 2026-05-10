# Product Requirements Document — Sandbox Migration Shield

## Problem Statement

> *"This is going to be a lot of work that was unforeseen... This is going to break a lot of stuff for no real reason... They didn't provide any migration tool."*
> — r/servicenow, 25 upvotes, 23 comments

ServiceNow KB2944435 introduces a phased replacement of the server-side JavaScript sandbox:

- **Phase 1 (complete):** Notification — instance admins informed of upcoming changes
- **Phase 2 (in progress):** Mandatory review — scripts flagged, administrators must review
- **Phase 3 (imminent):** **Enforcement** — incompatible scripts are **BLOCKED** at runtime unless migrated or exempted

There is **no built-in migration tool**. Enterprise instances may have 500–5,000+ scripts across `sys_script`, `sys_script_include`, `sys_script_client`, `sys_ui_policy`, `sys_dictionary` (default values, calculated fields), Business Rules, and UI Actions. Manual review is impractical at scale.

## User Personas

### Persona 1: Alex — Platform Owner
- **Role:** Director of ServiceNow Platform for a Fortune 500 company
- **Instance:** 3,200 scripts, Zurich patch 7, planning Australia upgrade Q3 2026
- **Pain:** Needs a comprehensive readiness report for CISO before upgrade approval. Cannot afford blocked scripts in production.
- **Goal:** One dashboard showing migration status, risk level, and compliance posture.

### Persona 2: Maria — ServiceNow Admin
- **Role:** Senior ServiceNow Administrator, 2-person platform team
- **Instance:** 900 scripts, Xanadu patch 3
- **Pain:** Drowning in manual script review. Each script requires reading code, determining compatibility, rewriting — she estimates 6 months of part-time work.
- **Goal:** Automated scanner + one-click migration for 80%+ of flagged scripts.

### Persona 3: James — Compliance Architect
- **Role:** CIS-certified architect responsible for audit compliance
- **Instance:** Government client, strict SOX requirements
- **Pain:** Exemptions must be documented with business justification, approval chain, and annual review triggers. No tooling exists.
- **Goal:** Exemption Registry with full audit trail and automated annual review reminders.

## User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | Platform Owner | See a dashboard with overall migration readiness score | I can report status to leadership | P0 |
| US-02 | Admin | Run an automated scan of ALL script tables | I don't manually hunt through 5+ tables | P0 |
| US-03 | Admin | See each script classified by severity (BLOCKING/WARNING/COMPATIBLE) | I know what to fix first | P0 |
| US-04 | Admin | One-click migrate inline logic to a Script Include | I don't rewrite code by hand | P0 |
| US-05 | Admin | Preview what the migration will produce before committing | I can validate correctness | P1 |
| US-06 | Admin | See the Upgrade Impact Predictor showing new scripts that would be blocked | I plan upgrades with confidence | P1 |
| US-07 | Compliance Architect | Create documented exemptions with business justification | I satisfy audit requirements | P0 |
| US-08 | Compliance Architect | See full audit trail of all migrations and exemptions | I pass SOX/HIPAA audits | P1 |
| US-09 | Admin | Roll back a migration if it introduces a bug | I have a safety net | P1 |
| US-10 | Platform Owner | Receive weekly automated scan reports by email | I stay informed without logging in | P2 |
| US-11 | Admin | Filter scripts by table, severity, status | I focus on what matters | P1 |
| US-12 | All | Export migration report as PDF for executive review | I can present to leadership | P2 |

## Functional Requirements

### FR-01: Automated Script Scanner
- Scan tables: `sys_script`, `sys_script_include`, `sys_script_client`, `sys_ui_policy`, `sys_ui_action`, `sys_dictionary` (default_value, calculation), Business Rules, UI Policies
- Classification: **BLOCKING** (will be blocked by Phase 3), **WARNING** (needs review, may break), **COMPATIBLE** (safe), **EXEMPT**
- Scan duration must be <2 minutes for instances with <5,000 scripts
- Results stored in custom table `x_snc_sms_scan_result`

### FR-02: Migration Engine
- Extract inline JavaScript from script fields
- Generate a new `sys_script_include` record with proper name, description, API name
- Replace original script field with a call to the new Script Include
- Preserve all context: `current`, `previous`, `g_scratchpad`, `g_form`
- Preview mode: show the generated Script Include code and replacement call BEFORE executing
- Rollback: restore original script and delete generated Script Include

### FR-03: Exemption Registry
- Create exemption record in `x_snc_sms_exemption`
- Required fields: script reference, business justification (min 50 chars), approver (reference to `sys_user`), expiration date
- Approval workflow: submit → manager approval → recorded
- Annual review: scheduled job notifies exemption owner 30 days before expiration
- Exempt scripts excluded from readiness score calculation

### FR-04: Upgrade Impact Predictor
- Compare current `sys_update_set` contents against known KB2944435 blocking patterns
- Show: "If you upgrade today, N new scripts would be flagged"
- Run as part of pre-upgrade checklist

### FR-05: Readiness Dashboard
- Widgets: overall readiness score (0-100%), script breakdown by severity pie chart, trend line (week-over-week), top 10 blocking scripts
- Filter by: application scope, table, assigned group
- Export as PDF

## Non-Functional Requirements

| Category | Requirement |
|----------|------------|
| Performance | Scan <2 min for 5K scripts; dashboard loads <3s |
| Security | Scoped app with explicit ACLs; no cross-scope access without REST API auth |
| Reliability | Rollback mechanism tested; zero data loss guarantee |
| Usability | First-time scan completed in <3 clicks |
| Compatibility | Works on Zurich, Xanadu, Yokohama, Australia; Service Portal + Workspace |
| Audit | All mutations logged to `x_snc_sms_audit_log` |

## Scope

### MVP (v1.0)
- FR-01: Scanner (all tables, severity classification)
- FR-03: Exemption Registry (manual creation, basic approval)
- FR-05: Readiness Dashboard (score, pie chart, top-10 list)
- US-01, US-02, US-03, US-07, US-11

### v1.1
- FR-02: Migration Engine (inline extraction + Script Include generation, preview mode, rollback)
- US-04, US-05, US-09

### v1.2
- FR-04: Upgrade Impact Predictor
- US-06

### v2.0
- FR-01 (enhanced): Scheduled weekly scans + email reports
- FR-03 (enhanced): Automated approval workflow + annual review reminders
- PDF export, multi-instance federation
- US-08, US-10, US-12

## Success Metrics

### North Star Metric
**Migration Readiness Score** — % of blocking scripts that have been migrated or exempted.

### KPIs
1. **Scan completion rate:** 100% (all script tables covered in every scan)
2. **Time-to-migrate:** Average <30 seconds per script (vs ~15 minutes manual)
3. **Audit compliance:** 100% of exemptions have documented justification and approval
4. **User adoption:** >80% of instance admins run at least weekly scans
5. **Zero-blocked-in-production:** No customer reports unexpected script blocking after using the tool
