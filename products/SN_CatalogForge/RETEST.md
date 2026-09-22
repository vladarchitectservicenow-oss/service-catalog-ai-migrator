# ServiceNow Retest — CatalogForge (`x_sncf`)

**RUN_ID:** 20260922_050107_8619
**Date:** 2026-09-22
**Role:** QA Quick Validation Agent
**Stage:** 05 — Retest (post-fix validation)
**Author:** Vladimir Kapustin

---

## Status: PASS

---

## Verification (real execution)

| Check | Result |
|---|---|
| `node --check` × 5 JS files (Engine, Writer, get_status, post_execute, smoke_test) | ✅ all OK |
| XML well-formedness × 5 (sys_app, acl, br, 2 tables) | ✅ all OK |
| Node mock smoke test (23 assertions) | ✅ 23/23 PASSED, exit 0 |
| Copyright `Vladimir Kapustin` + AGPL-3.0 SPDX | ✅ intact |

---

## Fix Verification (10/10 confirmed in source)

### HIGH

- **H-1** ✅ `_writePolicies` (Writer 315–347) now creates `sys_ui_policy` against `table='sc_cat_item'` with `catalog_item`=item sys_id, and a `sys_ui_policy_action` child (`visible=true`, `mandatory` derived from `pol.type`). `_buildCondition` (349–360) handles single + array `one_of` values via `^OR`. Policies are no longer inert.
- **H-2** ✅ `_writeChoices` (Writer 301) keys `sys_choice.name` = `item_option_new`, `element` = variable name.
- **H-3** ✅ `preview_json` `max_length` 4000 → 4,000,000 (catalog_forge_draft.xml:187); `MAX_PREVIEW_CHARS` guard (Writer 21, 38–40) returns `GRAPH_TOO_LARGE` instead of silent truncation.

### MEDIUM

- **M-1** ✅ REST execute ACL (acl_definitions.xml:147–164) is scripted — allows `x_sncf.admin` / `.mapper` / `.viewer`.
- **M-2** ✅ `commit()` role gate (Writer 113–115) returns `FORBIDDEN` without `x_sncf.admin`; `post_execute.js` `approve` (47–54) enforces `x_sncf.admin` + HTTP 403.
- **M-3** ✅ `_loadChoiceOverrides` (Writer 390–402) queries `x_sncf_choice_override` active rows; `propose()` passes DB overrides into `engine.propose(rawIntake, dbOverrides)` (Writer 34); Engine `_mergeOverrides` (430–447) merges into `seedChoices`.
- **M-4** ✅ `_writeItem` (Writer 213–233) instantiates `sc_cat_item_producer` directly when `type==='record_producer'`, sets `table` from `flow.target_table` (default `incident`).

### LOW

- **L-1** ✅ `_fingerprint` (Engine 514–537) now includes choice values, policy target/type/condition_field/operator/value, variable-set membership, flow kind/target_table.
- **L-2** ✅ `NAME_TYPE_MAP.amount` → `{ type: 'decimal' }` (Engine 54); `_mapType` maps `decimal` → `decimal`.
- **L-3** ✅ Dead `this._gs` removed; `exportBundle` simplified (no double re-parse); `get_status.js` unreachable `UNKNOWN_ACTION` branch removed.

---

## Critical Errors

None.

---

## Note (non-blocking, informational only)

`preview_json` `max_length` of 4,000,000 is large for a standard ServiceNow string field. On a live instance, very large single-string columns should ideally use a field type suited to large text (or an attachment/CLOB alternative). This is a deployment-tuning concern, not a syntax or critical-logic error, and does not block the pass for this stage — but worth validating against the target instance during push (06).
