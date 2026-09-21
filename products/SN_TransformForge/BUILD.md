# ServiceNow Build — TransformForge (`sn_transform_forge`)

**RUN_ID:** 20260921_050121_8588
**Date:** 2026-09-21
**Role:** Senior ServiceNow Developer
**Stage:** 03 — Build
**Author:** Vladimir Kapustin

---

## Summary

TransformForge is a scoped ServiceNow application (`x_sntf`) that ingests a source-file sample (CSV header + rows) and a target table name, reads the target's schema via `sys_dictionary`/`sys_choice`/`sys_db_object`/`sys_index`, and auto-proposes a complete transform map — field mappings, coalesce keys, choice wiring, and transform-script suggestions — emitting a reviewable, import-ready payload. The deterministic generation path is pure computation; record generation is review-gated and never writes to `sys_transform_map`/`_entry`/`_script` directly.

**Design file consumed:** `02_design.md` (TransformForge, 7 features, MVP scope). The full AI stack described in the design (Now Assist ambiguous-match resolution, AI Agent Studio "Migration Copilot", Generative AI Controller BYOK rationale) is a **v1.2–v1.3 phase** per the design's own MVP sequence — the MVP scope (v1.0) is the deterministic Source Parser + Schema Fingerprint + Matcher + Coalesce + Preview + Generator, which this build fully delivers.

---

## Consolidation Decisions

The design specified 4 custom tables and a multi-module component set. Enforced limits (max 2 tables, 2 Script Includes, 2 REST endpoints) required consolidation **before** code.

### Table Consolidation (4 → 2)

| Design Table | Purpose | Consolidated Into | Strategy |
|---|---|---|---|
| `sn_tf_job` | generation-run header | `x_sntf_transform_job` | kept (parent) |
| `sn_tf_mapping` | proposed field mapping | `x_sntf_transform_mapping` | kept (child) |
| `sn_tf_choice_map` | source↔target choice pairing per field | → `choice_map_json` on mapping | JSON column absorption |
| `sn_tf_orphan` | orphaned source values | → `orphans_json` on mapping | JSON column absorption |

Choice-map and orphan data are always accessed with their parent mapping (one source column → one target field), so JSON absorption is the correct strategy. The `preview_payload` JSON column on the job additionally carries the full engine output (including choice wiring and scripts) for the review UI.

### Script Include Consolidation (→ 2)

| Design Component | Merged Into | Responsibility |
|---|---|---|
| Source Parser | `TransformForgeEngine` | `parseSource()` |
| Schema Fingerprint Builder | `TransformForgeEngine` | `buildSchemaFingerprint()` |
| Fuzzy Matcher | `TransformForgeEngine` | `match()` |
| Coalesce Recommender | `TransformForgeEngine` | `recommendCoalesce()` |
| Choice Auto-Wiring | `TransformForgeEngine` | `wireChoices()` |
| Transform Script Suggester | `TransformForgeEngine` | `suggestScripts()` |
| Generator & Export | `TransformForgeGenerator` | `generate()` / `exportMapPayload()` |

**Two responsibilities, two SIs:** `TransformForgeEngine` = pure deterministic computation (never writes to scoped tables, never mutates platform records). `TransformForgeGenerator` = persistence + payload emission (writes jobs/mappings, emits the reviewable map). This is a clean boundary — the engine is fully unit-testable without a live instance, and the generator is the only side-effecting component.

### REST Endpoint Consolidation (→ 2)

| Design Surface | Endpoint | Pattern |
|---|---|---|
| Generate / Export (write) | `POST /api/x_sntf/v1/execute` | action-dispatch on `action` body param (`generate` / `export`) |
| Preview / status / listing (read) | `GET /api/x_sntf/v1/status` | query-param dispatch (`job_sys_id`, `limit`) |

---

## Artifact Inventory

| Type | Name | File |
|---|---|---|
| Scoped app manifest | TransformForge (`x_sntf`) | `sys_app.xml` |
| Script Include | `TransformForgeEngine` | `scripts/TransformForgeEngine.js` |
| Script Include | `TransformForgeGenerator` | `scripts/TransformForgeGenerator.js` |
| REST endpoint | `POST /execute` | `rest/post_execute.js` |
| REST endpoint | `GET /status` | `rest/get_status.js` |
| Table | `x_sntf_transform_job` | `tables/transform_job.xml` |
| Table | `x_sntf_transform_mapping` | `tables/transform_mapping.xml` |
| Roles | `x_sntf.admin` / `.mapper` / `.viewer` | in `sys_app.xml` |
| Cross-scope privileges | `sys_dictionary`, `sys_choice`, `sys_db_object`, `sys_index` (read) | in `sys_app.xml` |
| Business rule | `TF Validate Target Table` (before insert, abort if empty) | `br/business_rules.xml` |
| Scheduled job | `TransformForge Housekeeping` (daily 03:00, 90-day retention) | `br/business_rules.xml` |
| ACLs | read/write/create/delete per table + REST execute | `acl/acl_definitions.xml` |

---

## Feature Coverage Matrix

| # | Design Feature | Status | Where |
|---|---|---|---|
| 1 | Schema Fingerprint Builder | ✅ Implemented | `buildSchemaFingerprint()` — reads `sys_dictionary` (name/label/type/max_len/mandatory/read-only/reference), `sys_choice` (choice values), `sys_index` (uniqueness/indexing), `sys_db_object` (table existence/label) |
| 2 | Column→Field Matcher (fuzzy scoring) | ✅ Implemented | `match()` — exact name (60), exact label (55), Levenshtein similarity (≤30), token overlap on label (≤25), type compatibility (≤15), choice-list overlap (≤20). Confidence: high ≥60, medium ≥35, low >0 |
| 3 | Coalesce Key Recommender | ✅ Implemented | `recommendCoalesce()` — unique → safe; indexed + id-adjacent + high-conf → recommend; indexed + high-card → recommend; `name` → explicit warning |
| 4 | Choice Mapping Auto-Wiring | ✅ Implemented | `wireChoices()` — matches source distinct values against `sys_choice` label/value, flags orphans |
| 5 | Transform Script Suggester | ✅ Implemented | `suggestScripts()` — low-confidence and date-coercion templates (review-only, never auto-applied) |
| 6 | Mapping Preview & Diff | ✅ Implemented (headless) | `preview()` returns the full reviewable matrix with confidence + candidates; exposed via `GET /status?job_sys_id=` |
| 7 | Generator & Export | ✅ Implemented | `generate()` (dry-run first) + `exportMapPayload()` (import-ready `transform_map`/entries/scripts structure) |
| — | Now Assist ambiguous-match resolution | ⏳ v1.2 (per design MVP sequence) | deferred, flagged in design |
| — | AI Agent Studio Migration Copilot | ⏳ v1.3 (per design MVP sequence) | deferred, flagged in design |
| — | Generative AI Controller BYOK rationale | ⏳ v1.2 (per design MVP sequence) | deferred, flagged in design |

---

## Quality Notes

- **Read-only policy (engine):** `TransformForgeEngine` is pure computation — no `insert`/`update`/`deleteRecord`, no cross-scope writes. Only `TransformForgeGenerator` persists, and every `insert()` is wrapped in `try/catch` (3 sites), logging to `gs.error` on failure.
- **Review-gated generation:** The generator never writes to `sys_transform_map`/`_entry`/`_script`. `generate()` supports `dry_run` (no persistence); `exportMapPayload()` returns a serializable structure the reviewer confirms before any platform record is touched. The human-in-the-loop gate is the preview.
- **Deterministic, reproducible:** Fuzzy scoring is a pure function of name/label/type/choice overlap. The schema fingerprint is a portable FNV-1a hash (not `GlideStringUtil.hashCode()`) so fingerprints are stable across instances. AI (deferred to v1.2+) sits beside — never in — the generation path.
- **ES5/Rhino-compatible:** no arrow functions, no `let`/`const`, no template literals, no `Object.values`, no `for...of`, no `.find()` (replaced with index loops). Verified with `node --check` on all 4 JS files.
- **Bounded queries:** sample parsing is capped (`sampleLimit` default 100 rows, 5 samples + 30 distinct values per column); choice reads capped at 200; job listing capped at 25 (REST caps at 100). No full-table scans on the critical path beyond the `sys_dictionary` fingerprint read (indexed by `name`).
- **Security:** 3 roles (`admin`/`mapper`/`viewer`); per-table read/write/create/delete ACLs (delete = admin only); REST endpoint ACL `execute` for `admin`/`mapper`; `delete_access=false` on both `sys_db_object` records. Cross-scope privileges are **read-only** on the 4 OOTB tables the engine queries.
- **No credential leakage:** no hardcoded passwords, tokens, or instance URLs anywhere in the source.

---

## Verification (build-time)

| Check | Result |
|---|---|
| XML well-formedness (5 files: `sys_app.xml`, 2 tables, ACLs, BRs) | ✅ all `OK` |
| JS syntax (`node --check` × 4) | ✅ all `OK` |
| Copyright headers (`Vladimir Kapustin` + AGPL-3.0 SPDX) | ✅ 4/4 |
| `setBody(JSON.stringify(...))` (no raw objects) | ✅ present in both REST endpoints |
| `try/catch` around `insert()` | ✅ 3 in generator |
| REST unknown-action → HTTP 400 | ✅ `default:` in `post_execute.js` |
| CDATA byte-match (combined manifest ↔ standalone sources) | ✅ ALL_MATCH (4 blocks) |
| Node.js mock-runtime smoke test (parser → fingerprint → match → coalesce → preview) | ✅ ALL PASSED |

Smoke-test highlights (real execution, not static):
- `parseSource` correctly inferred `email` column type with cardinality 1.0.
- `buildSchemaFingerprint` resolved 8 fields, flagged `email` as unique (from `sys_index`), resolved `department` reference → `cmn_department`.
- `match` scored `email → email` at high confidence and `first_name → first_name` exactly.
- `recommendCoalesce` recommended `email` as a coalesce key.
- Full `preview()` produced a stable fingerprint `fnv1a_b4bbcb1c`.

---

## File Tree

```
03_build/
├── sys_app.xml                         # combined manifest (scope, roles, SIs, REST, privileges)
├── scripts/
│   ├── TransformForgeEngine.js         # deterministic mapping engine
│   └── TransformForgeGenerator.js      # persistence + payload emission
├── rest/
│   ├── post_execute.js                 # POST /execute (generate | export)
│   └── get_status.js                   # GET /status (preview | listing)
├── tables/
│   ├── transform_job.xml               # x_sntf_transform_job
│   └── transform_mapping.xml           # x_sntf_transform_mapping
├── acl/
│   └── acl_definitions.xml             # 9 ACLs (8 record + 1 REST execute)
└── br/
    └── business_rules.xml              # 1 BR + 1 scheduled job
```
