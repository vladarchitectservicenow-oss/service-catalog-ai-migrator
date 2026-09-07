# ApprovalRelay — Build Summary

**RUN_ID:** 20260907_050030_6857
**Product:** ApprovalRelay (`x_sn_approval_relay`) — Stalled & Orphaned Approval Detector with Auto-Remediation
**Scope:** `x_sn_approval_relay`
**License:** AGPL-3.0-only
**Author:** Vladimir Kapustin

---

## 1. Build Result

Production-ready scoped application built from `02_design.md`. Deterministic stalled-approval scanner, five-bucket stall classifier, configurable auto-remediation, threshold alerting with cooldown dedup, REST API, scheduled job, ACLs, and cross-scope privileges. No placeholders.

## 2. Consolidation Decisions

The design specified **4 custom tables**, exceeding the enforced limit of 2. Two were consolidated:

| Design Table | Resolution | Strategy |
|--------------|-----------|----------|
| `x_sn_approval_relay_stall` | **Kept** | Primary stall/classification table |
| `x_sn_approval_relay_alert` | **Kept** | Alert/incident table |
| `x_sn_approval_relay_config` | **→ system properties** | `gs.getProperty('x_sn_approval_relay.*')` — no table needed |
| `x_sn_approval_relay_audit` | **→ stall table fields** | `remediation_action` / `remediation_actor` / `remediation_detail` columns on the stall record |

## 3. Config Properties (all with safe defaults)

| Property | Default | Purpose |
|----------|---------|---------|
| `x_sn_approval_relay.stall_hours` | 48 | Stalled-approval age threshold |
| `x_sn_approval_relay.away_login_hours` | 72 | Away threshold (stale last login) |
| `x_sn_approval_relay.orphaned_enabled` | true | Enable orphaned-approver detection |
| `x_sn_approval_relay.no_delegation_enabled` | true | Enable no-delegation detection |
| `x_sn_approval_relay.dead_group_enabled` | true | Enable dead-group detection |
| `x_sn_approval_relay.dead_end_enabled` | true | Enable dead-end-chain detection |
| `x_sn_approval_relay.silent_enabled` | true | Enable silent-approver detection |
| `x_sn_approval_relay.reassign_enabled` | false | Auto-reassign to manager (destructive, off) |
| `x_sn_approval_relay.escalate_enabled` | false | Auto-escalate to assignee (destructive, off) |
| `x_sn_approval_relay.prompt_enabled` | true | One-click delegation prompt |
| `x_sn_approval_relay.create_incident` | true | Auto-create incident on critical stall |
| `x_sn_approval_relay.notify_users` | (empty) | Comma-separated notification recipients |
| `x_sn_approval_relay.alert_cooldown_minutes` | 60 | Alert dedup cooldown |

## 4. Artifact Inventory

| Type | Count | Artifacts |
|------|-------|-----------|
| Script Includes | 2 | `ApprovalRelayEngine`, `ApprovalRelayRemediate` |
| Custom tables | 2 | `x_sn_approval_relay_stall`, `x_sn_approval_relay_alert` |
| REST endpoints | 2 | `GET /stalls`, `POST /execute` |
| Scheduled job | 1 | `ApprovalRelay Stall Scan` (daily) |
| Roles | 2 | `x_sn_approval_relay.admin`, `x_sn_approval_relay.user` |
| Cross-scope privileges | 9 | 7 read + 2 write (incident, sysapproval_approver) |
| ACLs | 7 | 4 record + 2 REST endpoint + 1 incident create |
| Events | 3 | `alert`, `escalation`, `delegation_prompt` |

## 5. Feature Coverage Matrix

| # | Design Feature | Status | Implementation |
|---|----------------|--------|----------------|
| 1 | Stalled-Approval Scanner | ✅ Implemented | `scanStalled()` — GlideAggregate/GlideRecord on `sysapproval_approver` + `sysapproval_group`, `state=requested` + `sys_created_on` window |
| 2 | Five-Bucket Stall Classifier | ✅ Implemented | `classifyStall()` / `classifyGroupStall()` — orphaned / no-delegation / dead-group / dead-end-chain / silent-approver |
| 3 | Configurable Auto-Remediation | ✅ Implemented | `remediate()` — reassign / escalate / prompt, off-by-default for destructive actions |
| 4 | Stall Health Dashboard | ⚠️ Deferred | UI Builder surface is Phase 3 UI; REST + tables are the read surface |
| 5 | Threshold Alerting → Notification/Incident | ✅ Implemented | `raiseAlert()` — cooldown dedup, incident on critical buckets |
| 6 | Weekly Digest | ⚠️ Deferred | Scheduled report is Phase 3 UI; daily scan + alert tables are the data source |
| 7 | AI Triage Assistant | ⚠️ Deferred | Read-only explainer reads stalls/alerts; AI wiring is Phase 4 (Now Assist / AI Agent Studio) |

Features 4, 6, 7 are intentionally deferred per the design's own implementation plan (UI & AI are Phases 3–4). The deterministic detection/classification/remediation/alerting layer — the product's core — is fully built. The `evidence_json` column and `getStalls()`/`getStall()` read helpers are the AI-ready surface.

## 6. Quality Notes

- **Read-only policy:** The engine only *reads* OOTB tables (`sysapproval_approver`, `sysapproval_group`, `sys_user`, `sys_user_group`, `sys_user_grmember`, `sys_user_delegate`, `task`). It writes only to its own scoped tables, reassigns the approver on `sysapproval_approver` (write privilege declared), and creates incidents.
- **Incremental analysis:** All scans use `state=requested` + `sys_created_on` window filters — never `getRowCount()` on unfiltered tables.
- **Deterministic classification:** AI never classifies a stall or mutates approval state. Classification and remediation are pure GlideRecord/GlideAggregate logic.
- **Destructive-action safety:** Reassign and escalate are off-by-default (`false`); only the non-destructive delegation prompt is on by default. Every remediation is recorded on the stall record.
- **Alert-storm prevention:** Cooldown dedup by `approval + bucket` within a configurable window; requires ack before re-alert.
- **Security:** All `insert()`/`update()` calls wrapped in try/catch. REST endpoints return 400 for unknown actions, 404 for missing records, 500 for exceptions. `setBody()` always receives `JSON.stringify(...)`.
- **Dead-end safety:** A non-resolving approver/group reference maps to `dead_end_chain` (not a crash); a missing manager maps to a non-applied remediation with a logged detail.

## 7. File Tree

```
SN_ApprovalRelay/
├── sys_app.xml                          # Combined manifest (1409 lines, authoritative for import)
├── assemble.py                          # Deterministic manifest assembler (CDATA byte-match)
├── tables/
│   ├── x_sn_approval_relay_stall.xml    # sys_db_object + 12 sys_dictionary fields
│   └── x_sn_approval_relay_alert.xml    # sys_db_object + 9 sys_dictionary fields
├── scripts/
│   ├── ApprovalRelayEngine.js           # scan + 5-bucket classifier + persistence + read helpers
│   └── ApprovalRelayRemediate.js        # remediation + alerting + ack + audit-on-record
├── rest/
│   ├── stalls.js                        # GET /api/x_sn_approval_relay/stalls
│   └── execute.js                       # POST /api/x_sn_approval_relay/execute (scan|remediate|ack)
├── acl/
│   ├── acl_definitions.xml              # 5 record ACLs (read/write × 2 tables + incident create)
│   └── rest_acl_definitions.xml         # 2 REST endpoint execute ACLs
└── br/
    └── scheduled_job.xml                # daily stall scan job
```

## 8. Verification Results

| Check | Result |
|-------|--------|
| Copyright headers (4/4 .js files) | ✅ PASS |
| `JSON.stringify` on all `setBody` | ✅ PASS (12 occurrences) |
| try/catch around insert/update | ✅ PASS |
| REST default case returns 400 | ✅ PASS |
| JS syntax (`node --check`) | ✅ PASS (4/4) |
| XML well-formedness | ✅ PASS (6/6) |
| CDATA byte-match (manifest vs standalone) | ✅ PASS (5/5) |
| `sys_app.xml` line count | 1409 (not skeletal) |
