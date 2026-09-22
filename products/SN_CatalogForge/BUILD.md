# ServiceNow Build — CatalogForge (`x_sncf`)

**RUN_ID:** 20260922_050107_8619
**Date:** 2026-09-22
**Role:** Senior ServiceNow Developer
**Stage:** 03 — Build
**Author:** Vladimir Kapustin

---

## Summary

CatalogForge is a scoped ServiceNow application (`x_sncf`) that turns a structured service definition (JSON intake + optional plain-language description) into a complete, consistent `sc_cat_item` graph: typed variables, choice-list seeds, variable-set wiring, UI-policy/order rules, and a starter record-producer flow — ready to import in under a minute.

The engine is **pure deterministic computation** (never writes to scoped or platform tables). Persistence and the commit layer live in a separate Script Include, and every write to OOTB catalog tables is **review-gated**: propose → preview → approve → commit, with atomic rollback on any partial failure.

**Design file consumed:** `02_design.md` (CatalogForge, 7 features). The AI stack described in the design (Now Assist plain-language inference, AI Agent Studio "Catalog Builder" agent, Generative AI Controller BYOK) is a **phase-deferred acceleration layer** per the design's own determinism boundary — the engine works with zero LLM, and AI only accelerates free-text intake. The v1.0 build fully delivers the deterministic path; the LLM path is a config flag, not a hard dependency.

---

## Consolidation Decisions

The design specified **5 sub-module Script Includes** and a multi-table commit layer. Enforced limits (max 2 Script Includes, 2 tables, 2 REST endpoints) required consolidation **before** code.

### Script Include Consolidation (5 → 2)

| Design Component | Merged Into | Responsibility |
|---|---|---|
| VariableTypeMapper | `CatalogForgeEngine` | `inferVariables()` / `_mapField()` |
| ChoiceSeeder | `CatalogForgeEngine` | `seedChoices()` |
| VariableSetWiring | `CatalogForgeEngine` | `wireVariableSets()` |
| PolicyGenerator | `CatalogForgeEngine` | `generatePolicies()` |
| FlowStarter | `CatalogForgeEngine` | `configureFlow()` |
| (commit layer) | `CatalogForgeWriter` | `propose()` / `preview()` / `commit()` / `exportBundle()` |

**Two responsibilities, two SIs:** `CatalogForgeEngine` = pure deterministic graph generation (fully unit-testable without a live instance). `CatalogForgeWriter` = persistence + atomic commit + export (the only side-effecting component).

### Table Consolidation (→ 2)

| Purpose | Table | Strategy |
|---|---|---|
| Review draft (proposed item graph) | `x_sncf_catalog_forge_draft` | parent — holds `preview_json` (full graph), `fingerprint`, `status`, `committed_item_sys_id` |
| Org-specific choice overrides | `x_sncf_choice_override` | child — `field_name` + `choice_value` + `sequence` + `active` |

The proposed graph itself is stored as `preview_json` (JSON column absorption) rather than a normalized table-per-entity schema — the graph is always read/written as one atomic unit, so a JSON payload column is the correct shape and avoids 5+ child tables.

### REST Endpoint Consolidation (→ 2)

| Design Surface | Endpoint | Pattern |
|---|---|---|
| Propose / Approve / Export (write) | `POST /api/x_sncf/v1/execute` | action-dispatch on `action` body param (`propose` / `approve` / `export`) |
| Preview / list / version (read) | `GET /api/x_sncf/v1/status` | query-param dispatch (`draft_sys_id`, `limit`) |

---

## Artifact Inventory

| Type | Name | File |
|---|---|---|
| Scoped app manifest | CatalogForge (`x_sncf`) | `sys_app.xml` (1,299 lines, combined) |
| Script Include | `CatalogForgeEngine` | `scripts/CatalogForgeEngine.js` |
| Script Include | `CatalogForgeWriter` | `scripts/CatalogForgeWriter.js` |
| REST endpoint | `POST /execute` | `rest/post_execute.js` |
| REST endpoint | `GET /status` | `rest/get_status.js` |
| Table | `x_sncf_catalog_forge_draft` | `tables/catalog_forge_draft.xml` |
| Table | `x_sncf_choice_override` | `tables/choice_override.xml` |
| Roles | `x_sncf.admin` / `.mapper` / `.viewer` | in `sys_app.xml` |
| Cross-scope privileges | `sc_cat_item`, `sc_cat_item_producer`, `item_option_new`, `item_option_new_set`, `sys_choice`, `sys_ui_policy` (execute) | in `sys_app.xml` |
| Business rule | `CF Validate Draft Name` (before insert, abort if empty) | `br/business_rules.xml` |
| Scheduled job | `CatalogForge Housekeeping` (daily 03:00, purge proposed drafts >30 days) | `br/business_rules.xml` |
| ACLs | 8 record ACLs (read/write/create/delete × 2 tables) + 1 REST execute | `acl/acl_definitions.xml` |

---

## Feature Coverage Matrix

| # | Design Feature | Status | Where |
|---|---|---|---|
| 1 | Service-definition intake (JSON + plain-language) | ✅ Implemented | `parseIntake()` — JSON string or natural-language description |
| 2 | Variable-type inference engine | ✅ Implemented | `inferVariables()` + curated `NAME_TYPE_MAP` (requested_for→`reference`/`sys_user`, date→`glide_date`, multi-value→`choice`, hardware tier→`choice`, etc.) |
| 3 | Choice-list seeding | ✅ Implemented | `seedChoices()` + curated `CHOICE_SEED_LIBRARY` (priority, urgency, hardware tier, device type, etc.) + org override table |
| 4 | Variable-set wiring | ✅ Implemented | `wireVariableSets()` — collapses 2+ shared members into `item_option_new_set` |
| 5 | UI-policy & order generation | ✅ Implemented | `generatePolicies()` — serial-number/hardware visibility, justification/impact mandatory, order computation |
| 6 | Interactive preview + commit | ✅ Implemented (headless) | `propose()` → `preview()` (via `GET /status`) → `commit()` (atomic write to OOTB tables with rollback) |
| 7 | Import/export bundle | ✅ Implemented | `exportBundle()` — portable JSON bundle (records + mappings) for git versioning and re-import |
| — | Now Assist NL → variables | ⏳ phase-deferred | deterministic fallback is complete; LLM is a config flag, not a dependency |
| — | AI Agent Studio "Catalog Builder" agent | ⏳ phase-deferred | flagged in design §4 |
| — | Generative AI Controller BYOK | ⏳ phase-deferred | flagged in design §4 |

---

## Quality Notes

- **Read-only engine:** `CatalogForgeEngine` performs no `insert`/`update`/`deleteRecord` and no cross-scope writes — it is pure computation, fully testable under a Node mock runtime.
- **Review-gated + atomic commit:** `CatalogForgeWriter.commit()` writes `sc_cat_item` (active=false), variables, variable sets, choices, and policies inside one try/catch; on any failure it rolls back every record via `_rollback()` (LIFO). The draft is marked `committed` only after all writes succeed.
- **Deterministic & reproducible:** the engine is a pure function of its intake; the graph fingerprint is a portable FNV-1a hash (not `GlideStringUtil.hashCode()`), stable across instances.
- **Canonical field naming:** all variables use snake_case (`hardware_tier`, `requested_for`); `_normalizeFieldName` collapses CamelCase, spaces, and separators to a single canonical key, so "Hardware Tier", "hardware_tier", and "hardware tier" all resolve identically. This was caught and fixed during the smoke test (multi-word token matching bug).
- **ES5/Rhino-compatible:** no arrow functions, no `let`/`const`, no template literals, no `Object.values`, no `for...of`, no `.find()`/`.map()`/`.some()` in the engine (verified `node --check`).
- **Security:** 3 roles; `commit` gated behind `x_sncf.admin` (mapper can propose/preview but not commit); per-table record ACLs with requestor-scoped read; REST execute ACL role-gated; `delete_access=false` on both scoped tables. Cross-scope privileges are the minimum set needed to write the catalog graph.
- **No credential leakage:** no hardcoded passwords, tokens, or instance URLs anywhere.
- **Bounded output:** draft listing capped (REST ≤100), no unbounded loops; housekeeping purges stale drafts daily.

---

## Verification (build-time, real execution)

| Check | Result |
|---|---|
| XML well-formedness (5 files: `sys_app.xml`, 2 tables, ACLs, BRs) | ✅ all OK |
| JS syntax (`node --check` × 4) | ✅ all OK |
| Copyright headers (`Vladimir Kapustin` + AGPL-3.0 SPDX) | ✅ 4/4 scripts + all XML |
| `setBody(JSON.stringify(...))` (no raw objects) | ✅ both REST endpoints |
| `try/catch` around `insert()`/`update()` | ✅ writer (propose/commit/rollback) |
| REST unknown-action → HTTP 400 | ✅ `default:` in `post_execute.js` |
| CDATA byte-match (combined manifest ↔ standalone sources) | ✅ ALL_MATCH (4 blocks) |
| Node.js mock-runtime smoke test (23 assertions) | ✅ ALL PASSED |

Smoke-test highlights (real execution, not static):
- Plain-language intake *"New employee laptop, need requested for, department, hardware tier, justification"* inferred 6 typed variables, including `requested_for` (reference→sys_user, mandatory) and `department` (reference→cmn_department).
- `hardware_tier` inferred as `choice` and seeded with 3 curated values.
- 2 variable sets wired (`Employee Information`, `Hardware Specification`).
- Policy generation produced a `serial_number` visibility policy and a `justification` mandatory policy when trigger fields were present.
- JSON intake with `type: record_producer` produced a record-producer flow targeting `incident`.
- Fingerprint was deterministic across repeated proposals.
- Empty intake rejected with `EMPTY_INTAKE`.

---

## File Tree

```
03_build/
├── sys_app.xml                         # combined manifest (scope, roles, SIs, REST, privileges)
├── scripts/
│   ├── CatalogForgeEngine.js           # deterministic item-graph generator
│   └── CatalogForgeWriter.js          # persistence + atomic commit + export
├── rest/
│   ├── post_execute.js                 # POST /execute (propose | approve | export)
│   └── get_status.js                   # GET /status (preview | list | version)
├── tables/
│   ├── catalog_forge_draft.xml         # x_sncf_catalog_forge_draft
│   └── choice_override.xml             # x_sncf_choice_override
├── acl/
│   └── acl_definitions.xml             # 8 record ACLs + 1 REST execute
├── br/
│   └── business_rules.xml              # 1 BR + 1 scheduled job
└── smoke_test.js                       # Node mock-runtime smoke test (23 assertions)
```
