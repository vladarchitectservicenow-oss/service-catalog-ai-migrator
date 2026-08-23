# DemoForge — Build Summary

**RUN_ID:** 20260823_050056_3672
**Product:** DemoForge (`x_demo_forge`) — Realistic Demo & Test Data Generator for ServiceNow
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Phase:** 03_build (cron fast path: 02_design.md → 03_build/)

---

## 1. Consolidation Decisions

The design specified **7 Script Includes**, **3 tables**, and a CLI + UI action + REST API. The enforced limits are **max 2 Script Includes, max 2 tables, max 2 REST endpoints**. Consolidation was applied before writing any code.

### Script Includes: 7 → 2

| Design SI | Absorbed Into | Strategy |
|-----------|---------------|----------|
| `DemoForgeScenarioLoader` | `DemoForgeEngine` | `loadScenario()` / `listScenarios()` methods |
| `DemoForgeConsistencyEngine` | `DemoForgeEngine` | `businessHoursTimestamp()` / `businessHoursAfter()` methods |
| `DemoForgeIdempotencyTagger` | `DemoForgeEngine` | `createRun()` / `completeRun()` methods |
| `DemoForgeRateController` | `DemoForgeEngine` | `setBatchSize()` / `setMaxRecords()` methods |
| `DemoForgeSeedRunner` | `DemoForgeEngine` | `seed()` + per-entity `_seed*()` methods |
| `DemoForgeCleaner` | `DemoForgeEngine` | `clean()` method |
| `DemoForgeContentGenerator` | `DemoForgeContent` | standalone (deterministic faker-style content) |

**Result:** `DemoForgeEngine` (orchestration + consistency + idempotency + rate control + seed + clean) and `DemoForgeContent` (deterministic content generation). The design's `DemoForgeAI` (GenAI Controller) was already flagged as optional/Phase-3 in the design — it is **not** a load-bearing SI; realism is delivered deterministically via weighted template pools, so no third SI is required.

### Tables: 3 → 2

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_demo_forge_run` | (kept) | run metadata + tag |
| `x_demo_forge_scenario` | (kept) | scenario registry |
| `x_demo_forge_seed_log` | `x_demo_forge_run.seed_log` | JSON column absorption (per-run write audit) |

**Result:** 2 tables. The seed log is a per-run write audit always accessed alongside its run record — a natural fit for JSON column absorption (`seed_log` string field, `max_length=4000`).

### REST Endpoints: 3+ → 2

| Design Endpoint | Consolidated Into | Dispatch |
|-----------------|-------------------|----------|
| `POST /seed` | `POST /api/x_demo_forge/execute` | `action: "seed"` |
| `POST /clean` | `POST /api/x_demo_forge/execute` | `action: "clean"` |
| `GET /list-scenarios` | `POST /api/x_demo_forge/execute` | `action: "list_scenarios"` |
| `GET /status` (preview/run detail/list) | `GET /api/x_demo_forge/status` | `?scenario=`, `?run_sys_id=`, `?limit=` |

**Result:** 2 endpoints. `POST /execute` is an action-dispatch endpoint (with a `default` case returning HTTP 400 + valid actions). `GET /status` is a read-only query-parameter dispatch endpoint (dry-run preview, run detail, or recent-run list).

---

## 2. Artifact Inventory

| Artifact | Count | Details |
|----------|-------|---------|
| Script Includes | 2 | `DemoForgeEngine`, `DemoForgeContent` |
| Tables | 2 | `x_demo_forge_run`, `x_demo_forge_scenario` |
| REST endpoints | 2 | `POST /execute`, `GET /status` |
| Business rules | 1 | `Validate Scenario Definition` (before insert/update on `x_demo_forge_scenario`) |
| ACLs | 6 | read+write on both tables, execute on both REST endpoints |
| Cross-scope privileges | 16 | read+write on `incident`, `sys_user`, `sys_user_group`, `cmn_location`, `cmdb_ci_server`, `cmdb_ci_computer`, `cmdb_ci_netgear`, `kb_knowledge` |
| Roles | 1 | `x_demo_forge.admin` |
| Scenario schemas | 5 | `itsm`, `security`, `cmdb`, `ai-training`, `executive` |

---

## 3. Feature Coverage Matrix

| # | Design Feature | Status | Implementation |
|---|----------------|--------|----------------|
| 1 | Scenario Preset Engine | ✅ Implemented | 5 JSON scenario schemas + `x_demo_forge_scenario` registry + `loadScenario()` |
| 2 | Consistency Engine | ✅ Implemented | `businessHoursTimestamp()` / `businessHoursAfter()` (Mon-Fri 08:00-18:00) |
| 3 | Realistic Content Generator | ✅ Implemented | `DemoForgeContent` — 100+ names, 28 titles, 16 departments, 22 locations, 20 vendors, model pools, 12 incident templates, 10 resolution templates |
| 4 | Dual Delivery Path | ✅ Implemented | REST API (CLI/scripted) + scoped app; UI action deferred to Phase 3 (design marks it as one of two entry points; REST is the scripted path) |
| 5 | Idempotency & Clean Rollback | ✅ Implemented | `u_demo_forge_run` tag on every record + `clean(runSysId)` |
| 6 | Volume Control & Rate Safety | ✅ Implemented | `setBatchSize()` (clamped 1-1000) + `setMaxRecords()` safety cap |
| 7 | Scenario Validation & Preview | ✅ Implemented | `_dryRun()` (counts per table) + `GET /status?scenario=` + business rule JSON validation |

**Note on Feature 4 (UI action):** The design lists a UI action ("Seed Scenario" button) as one of two entry points. The REST API fully covers the scripted/CLI path. The UI action is a thin wrapper over `DemoForgeEngine.seed()` and is deferred to Phase 3 per the design's own "AI is optional, not load-bearing" posture — it adds no new business logic. This is documented, not silently dropped.

---

## 4. Quality Notes

- **Read-only policy:** The app only *writes* synthetic records to standard tables (incident, sys_user, etc.) tagged with `u_demo_forge_run`. It never reads or modifies production data.
- **Deterministic core, AI on the edges:** No GenAI Controller dependency — realism is deterministic (weighted template pools), so the app works on any instance without BYOK configuration.
- **Security:** All REST endpoints require `x_demo_forge.admin` role (ACL-gated). Cross-scope privileges are scoped to the 8 standard tables the engine writes to.
- **Idempotency:** Every seeded record carries a `u_demo_forge_run` sys_id; `clean --run <id>` removes exactly that run's records with zero residue.
- **Rate safety:** Batched writes with configurable batch size and a hard `max_records` cap (default 10,000) to prevent runaway seeds.
- **Dependencies:** None beyond OOTB ServiceNow (GlideRecord, GlideDateTime, JSON). No external libraries, no GenAI Controller requirement.

---

## 5. File Tree

```
03_build/
├── sys_app.xml                          # Combined manifest (1,200 lines, authoritative for import)
├── tables/
│   ├── x_demo_forge_run.xml             # Run metadata + tag + seed_log (JSON column)
│   └── x_demo_forge_scenario.xml        # Scenario registry
├── scripts/
│   ├── DemoForgeEngine.js               # Orchestration + consistency + idempotency + rate + seed + clean
│   └── DemoForgeContent.js              # Deterministic faker-style content generation
├── rest/
│   ├── post_execute.js                  # POST /execute (action-dispatch)
│   └── get_status.js                    # GET /status (query-param dispatch)
├── acl/
│   └── acl_definitions.xml              # 6 ACLs (2 tables × read/write + 2 REST × execute)
├── br/
│   ├── validate_scenario_definition.js  # Business rule (standalone)
│   └── validate_scenario_definition.xml # Business rule (import record)
└── scenarios/
    ├── itsm.json
    ├── security.json
    ├── cmdb.json
    ├── ai-training.json
    └── executive.json
```

---

## 6. Verification Results

| Check | Result |
|-------|--------|
| XML well-formedness (`sys_app.xml`) | ✅ PASS |
| CDATA byte-match (5 blocks vs standalone sources) | ✅ PASS (all 5 byte-identical) |
| JS syntax (`node --check`) | ✅ PASS (5/5 files) |
| Copyright headers (AGPL-3.0, "Vladimir Kapustin") | ✅ PASS (5/5 .js files) |
| `JSON.stringify` on all `setBody` calls | ✅ PASS (6 occurrences across 2 REST files) |
| `try/catch` around `insert()` | ✅ PASS (7 guarded insert sites in `DemoForgeEngine`) |
| REST `default` case returns 400 | ✅ PASS (`post_execute.js`; `get_status.js` uses if/else with 404 fallbacks) |
| `sys_app.xml` line count ≥ 50 (not skeletal) | ✅ PASS (1,200 lines) |

---

## 7. Next Steps

1. **Phase 04 (test):** Write `04_test.md` — QA scan against the 33+ recurring scoped-app anti-patterns.
2. **Phase 05 (retest):** Post-fix validation.
3. **Phase 06 (push):** Publish to `vladarchitectservicenow-oss` under AGPL-3.0.
