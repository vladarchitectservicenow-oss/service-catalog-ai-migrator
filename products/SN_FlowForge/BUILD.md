# FlowForge (`sn_flow_forge`) — Build Summary

RUN_ID: `20260923_050035_3096` · Author: Vladimir Kapustin · License: AGPL-3.0-only

## 1. Result

Production scoped-app build for **FlowForge** (`x_snff`) — a deterministic Flow
Designer generator that turns a plain-English description or structured FlowSpec
into complete, importable `sys_hub_flow` / `sys_hub_flow_version` /
`sys_hub_flow_logic` records with correct-by-construction spoke references.

**Status: COMPLETE.** All artifacts written, manifest verified byte-identical to
standalone sources, deterministic engine smoke-tested (12/12 PASS), all XML
well-formed.

## 2. Consolidation Decisions

The design specified 6 features plus an optional BYOK front-end. The enforced
limits (max 2 Script Includes, 2 tables, 2 REST endpoints) required the
following consolidation:

| Design element | Before | After | Strategy |
|----------------|--------|-------|----------|
| Script Includes | 5 components implied (Catalog Resolver, Generator Core, Preview/Validator, Update-Set exporter, Table-API writer) | **2** | Merge by responsibility: `FlowForgeEngine` (parse + resolve + generate + validate + preview — all pure) and `FlowForgeWriter` (persist + commit + export + config — all write-side). |
| Tables | 3 candidate (draft, config, audit log) | **2** | JSON column absorption: the generated graph, spec, and preview are stored as JSON columns (`spec_json`, `graph_json`, `preview`) on the draft table. No separate audit table — commit provenance is recorded on the draft row itself. |
| REST endpoints | 4+ candidate (propose, commit, export, status, catalog) | **2** | Action-dispatch: `POST /execute` with `action` body param (`propose`/`commit`/`export`); `GET /status` with `mode` query param (`draft`/`preview`/`catalog`). |

The optional 7th feature (BYOK LLM front-end) is **phase-deferred** to a
`llm_enabled` / `llm_provider` config flag — the deterministic core runs with no
model at all, which is the design's stated non-negotiable guardrail.

## 3. Artifact Inventory

| Type | Name | File |
|------|------|------|
| Scope | `x_snff` FlowForge | `sys_app.xml` |
| Script Include | `FlowForgeEngine` (pure generator core) | `scripts/FlowForgeEngine.js` |
| Script Include | `FlowForgeWriter` (persistence/commit/export) | `scripts/FlowForgeWriter.js` |
| REST endpoint | `POST /execute` (propose/commit/export) | `rest/post_execute.js` |
| REST endpoint | `GET /status` (draft/preview/catalog) | `rest/get_status.js` |
| Table | `x_snff_flow_forge_draft` (13 fields) | `tables/flow_forge_draft.xml` |
| Table | `x_snff_flow_forge_config` (4 fields, singleton) | `tables/flow_forge_config.xml` |
| ACL | 9 record ACLs + 2 REST-execute ACLs | `acl/acl_definitions.xml` |
| Business Rule | 2 before-insert rules (defaults + dedup) | `br/business_rules.xml` |
| Roles | `x_snff.admin` / `x_snff.mapper` / `x_snff.viewer` | inline in `sys_app.xml` |
| Cross-scope | 4 privileges (flow tables) | inline in `sys_app.xml` |
| Smoke test | deterministic engine (12 cases) | `smoke_test.js` |

## 4. Feature Coverage Matrix

| # | Design feature | Status |
|---|----------------|--------|
| 1 | NL → Spec → Flow pipeline | ✅ Implemented (spec parser + normalizer; LLM normalization is phase-deferred behind config flag) |
| 2 | Spoke/Action Catalog Resolver | ✅ Implemented (`ACTION_CATALOG` + `resolveAction`, binding to `sys_hub_action_type_snapshot` in writer) |
| 3 | Correct-by-construction `sys_hub_flow` emitter | ✅ Implemented (`generateFlow` + `_insertFlow*`/`_buildUpdateSetXml`) |
| 4 | Dry-run preview + validation | ✅ Implemented (`renderPreview` + `validateGraph`, unbound-pill warnings) |
| 5 | Dual import path | ✅ Implemented (`exportUpdateSetXml` + `commit` Table API) |
| 6 | Companion CLI (`ffc`) | ⚠️ Not in scoped app (it is an offline Python CLI, out of scope for the ServiceNow artifact; documented as external) |

## 5. Quality Notes

- **Determinism guardrail honored:** the LLM never writes records. `FlowForgeEngine`
  is pure computation; only `FlowForgeWriter` persists. Every flow is a pure
  function of its FlowSpec.
- **Correct-by-construction references:** every step is resolved against the
  catalog *before* any record is emitted; unknown action tokens produce
  `UNKNOWN_ACTION` validation errors, never a hallucinated reference.
- **ES5/Rhino compatibility:** no arrow functions, `let`/`const`, template
  literals, `Object.values`/`entries`, or `for...of` anywhere in the SIs.
- **Read-only vs write separation:** `POST /execute` is the only write surface;
  `GET /status` has zero write side effects.
- **Guarded inserts:** all `insert()` calls in the writer are inside the commit
  try/catch; the engine performs no DB access.
- **Authorization:** `commit` action requires `x_snff.admin`; `propose`/`export`
  require `x_snff.mapper`. ACLs are role-gated, no unconditional `answer=true`.
- **Security:** no hardcoded credentials. LLM provider is a BYOK config value,
  never a stored secret.
- **Manifest integrity:** `sys_app.xml` (1,723 lines) assembled programmatically
  from the standalone `.js` files — all 4 CDATA blocks byte-match their sources
  (verified), so no codebase drift is possible.

## 6. File Tree

```
03_build/
├── sys_app.xml                     # combined manifest (scope, roles, privileges, SIs, REST, tables)
├── smoke_test.js                   # deterministic engine smoke test (12/12 PASS)
├── scripts/
│   ├── FlowForgeEngine.js          # pure generator core (23 KB)
│   └── FlowForgeWriter.js          # persistence/commit/export (16 KB)
├── rest/
│   ├── post_execute.js             # POST /execute (action dispatch)
│   └── get_status.js               # GET /status (read-only reports)
├── tables/
│   ├── flow_forge_draft.xml        # x_snff_flow_forge_draft
│   └── flow_forge_config.xml       # x_snff_flow_forge_config
├── acl/
│   └── acl_definitions.xml         # 9 record ACLs + 2 REST-execute ACLs
└── br/
    └── business_rules.xml          # 2 before-insert business rules
```

## 7. Verification Evidence

- Smoke test: `node smoke_test.js` → `SMOKE TEST: ALL PASS` (12 assertions).
- CDATA byte-match: `FlowForgeEngine`, `FlowForgeWriter`, `execute`, `status` all
  identical between standalone `.js` and manifest CDATA.
- XML well-formedness: all 5 XML files parse cleanly via `xml.dom.minidom`.
- Copyright headers: all 5 `.js` files carry the AGPL-3.0 header with full name
  "Vladimir Kapustin".
- REST `setBody` uses `JSON.stringify` on both endpoints.
- Unknown action/mode returns HTTP 400 on both endpoints.
