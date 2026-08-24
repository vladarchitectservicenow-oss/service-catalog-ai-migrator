# ScriptInclude Medic — Build Summary

**RUN_ID:** 20260824_050023_5394
**Product:** ScriptInclude Medic
**Scope:** `x_snc_script_include_medic`
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Status:** BUILD COMPLETE

---

## 1. Design vs. Enforced Limits — Consolidation

The design (`02_design.md`) specified 9 Script Includes, 5 tables, and 7 detectors.
The build enforces **max 2 Script Includes, max 2 tables, max 2 REST endpoints**.
Everything was consolidated *before* code was written.

### Script Includes (9 → 2)

| Design SI | Absorbed Into | Rationale |
|-----------|---------------|-----------|
| `SimCallGraphBuilder` | → `SimMedicEngine` | Graph building + tokenization are core engine responsibilities. |
| `SimDeadCodeDetector` | → `SimMedicEngine` | Detector is a method (`detectDeadCode`). |
| `SimDuplicateDetector` | → `SimMedicEngine` | Detector is a method (`detectDuplicates`) + `_normalize`/`_similarity` helpers. |
| `SimNamingEnforcer` | → `SimMedicEngine` | Detector is a method (`enforceNaming`). |
| `SimDocScorer` | → `SimMedicEngine` | Detector is a method (`scoreDocs`). |
| `SimCycleDetector` | → `SimMedicEngine` | Detector is a method (`detectCycles`), DFS with graph coloring. |
| `SimOotbFlagger` | → `SimMedicEngine` | Detector is a method (`flagOotbReinvention`). |
| `SimHealthScorer` | → `SimMedicEngine` | Scoring is a method (`computeHealth`). |
| `SimScanRunner` | → `SimMedicRunner` | Orchestration, persistence, safe-list, incremental re-scan. |

**Result:** `SimMedicEngine` (deterministic analysis) + `SimMedicRunner` (orchestration/persistence).

### Tables (5 → 2)

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_snc_sim_scan` | `x_snc_sim_scan` | Run metadata (kept as-is). |
| `x_snc_sim_include_score` | → `x_snc_sim_finding` (type=`health`) | Polymorphic type field. |
| `x_snc_sim_duplicate` | → `x_snc_sim_finding` (type=`duplicate`) | Polymorphic type field. |
| `x_snc_sim_dead` | → `x_snc_sim_finding` (type=`dead_code`) | Polymorphic type field. |
| `x_snc_sim_cycle` | → `x_snc_sim_finding` (type=`cycle`) | Polymorphic type field. |

**Result:** `x_snc_sim_scan` + `x_snc_sim_finding` (polymorphic `type` choice field:
`dead_code`, `duplicate`, `naming`, `documentation`, `cycle`, `reinvention`, `health`).
The `target_name` field holds duplicate pairs (`A ↔ B`) and cycle paths (`A → B → A`);
`metric` holds similarity percentage and cycle length; `score` holds doc/health scores.

### REST Endpoints (2)

| Endpoint | Method | Path | Purpose |
|----------|--------|------|---------|
| Scan | POST | `/api/x_snc_script_include_medic/scan` | Run full/incremental scan; body `{incremental, entry_points}`. |
| Results | GET | `/api/x_snc_script_include_medic/results` | Read findings; query params `scan_id`, `type`, `limit`. |

---

## 2. Artifact Inventory

| Type | File(s) | Count |
|------|---------|-------|
| Script Includes | `scripts/SimMedicEngine.js`, `scripts/SimMedicRunner.js` | 2 |
| Tables | `tables/x_snc_sim_scan.xml`, `tables/x_snc_sim_finding.xml` | 2 |
| REST endpoints | `rest/scan.js`, `rest/results.js` | 2 |
| Scheduled job | `br/scheduled_scan.js` + `br/scheduled_scan.xml` | 1 |
| ACLs | `acl/acl_definitions.xml` (10 ACLs) | 10 |
| Combined manifest | `sys_app.xml` (1,423 lines, authoritative for import) | 1 |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Call-Graph Builder | ✅ Full | `SimMedicEngine.buildCallGraph()` — parses `sys_script_include` (defs) + `sys_script`, `sys_script_client`, `sys_ui_action`, `sys_ws_operation`, `sysauto_script`, `sys_hub_flow` (refs). |
| 2. Dead-Code Detector | ✅ Full | `detectDeadCode(entryPoints)` — zero inbound refs minus safe-list. |
| 3. Duplicate-Function Detector | ✅ Full | `detectDuplicates()` — Dice-coefficient bigram similarity, 0.85 threshold. |
| 4. Naming-Convention Enforcer | ✅ Full | `enforceNaming()` — PascalCase, reserved-name collision, snake_case/double-underscore. |
| 5. Documentation Scorer | ✅ Full | `scoreDocs()` — 0–100 per include, `@description`/`@param`/`@return`. |
| 6. Circular-Dependency Detector | ✅ Full | `detectCycles()` — DFS white/gray/black, exact cycle path. |
| 7. OOTB-Reinvention Flagger | ✅ Full | `flagOotbReinvention()` — 15 known platform utilities. |
| Health score (per-include + instance) | ✅ Full | `computeHealth()` — weighted penalties → 0–100. |
| Safe-list (entry points) | ✅ Full | `SimMedicRunner.loadEntryPoints()` — configurable system property `x_snc_sim.safe_list`. |
| Incremental re-scan | ✅ Full | `hasChangedSinceLastScan()` + `runScan(incremental)`. |
| AI remediation (Now Assist/GenAI) | ⚠️ Deterministic-first | AI layer is optional BYOK and *not* load-bearing; detection is 100% deterministic. Remediation drafting hooks documented, not bundled (keeps product sellable to security-conscious customers). |

---

## 4. Quality Notes

- **Read-only analysis** — the engine never modifies `sys_script_include` or any source table; it only writes its own scoped result tables.
- **Deterministic core** — call graph and all 7 detectors are pure logic (no LLM dependency); AI only upgrades remediation drafting.
- **Cross-scope privileges** — 7 read privileges declared for OOTB script tables (`sys_script_include`, `sys_script`, `sys_script_client`, `sys_ui_action`, `sys_ws_operation`, `sysauto_script`, `sys_hub_flow`).
- **Security** — 10 ACLs: read/write/create/delete on both tables (role-gated `x_snc_sim.medic_user` / `x_snc_sim.medic_admin` / `snc_internal` / `admin`), execute ACLs on both REST endpoints.
- **No placeholders** — no `TODO`, `FIXME`, or stub methods. Every detector is fully implemented.
- **Robust function extraction** — strips comments before parsing (prevents JSDoc example snippets from being read as code), anchors `};` at column 0, excludes JS keywords from method-name detection.
- **Guarded persistence** — all `insert()`/`update()` calls wrapped in try/catch with `gs.error` logging.
- **REST contract** — `response.setBody(JSON.stringify(...))` (no raw objects), 500 on exception, limit clamping (1–500).

---

## 5. File Tree

```
03_build/
├── sys_app.xml                       # combined authoritative manifest (1423 lines)
├── acl/
│   └── acl_definitions.xml           # 10 ACLs
├── br/
│   ├── scheduled_scan.js             # scheduled job script (standalone)
│   └── scheduled_scan.xml            # sysauto_script registration
├── rest/
│   ├── scan.js                       # POST /scan
│   └── results.js                    # GET /results
├── scripts/
│   ├── SimMedicEngine.js             # deterministic analysis engine (672 lines)
│   └── SimMedicRunner.js             # orchestration + persistence
└── tables/
    ├── x_snc_sim_scan.xml            # run metadata table
    └── x_snc_sim_finding.xml         # polymorphic finding table
```

## 6. Verification (all executed, real output)

- ✅ `node --check` — all 5 `.js` files pass syntax.
- ✅ XML well-formed — `sys_app.xml`, both tables, ACLs, scheduled job (xml.dom.minidom).
- ✅ CDATA byte-match — all 5 code blocks in `sys_app.xml` identical to standalone sources.
- ✅ Copyright headers — `Vladimir Kapustin` in all 5 `.js` files.
- ✅ Engine unit checks (Node mock runtime): duplicate similarity 0.91 > 0.85 threshold; OOTB reinvention detection; 21 methods extracted from `SimMedicEngine` cleanly; keyword pollution eliminated.
