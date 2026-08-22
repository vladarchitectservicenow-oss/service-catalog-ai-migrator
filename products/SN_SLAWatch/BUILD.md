# SLAWatch — Build Summary

**RUN_ID:** 20260822_050037_8479
**Author:** Vladimir Kapustin
**License:** AGPL-3.0
**Scope:** `x_sn_slawatch`

---

## 1. Consolidation Decisions

The design specified **6 Script Includes** and **4 tables**, exceeding the enforced limits (max 2 SIs, max 2 tables, max 2 REST endpoints). Consolidated before writing any code.

### Script Includes: 6 → 2

| Design SI | Absorbed Into | Strategy |
|-----------|---------------|----------|
| `SlaWatchConditionIntegrity` | → `SlaWatchEngine._scanConditionIntegrity()` | Private method |
| `SlaWatchOrphanCoverage` | → `SlaWatchEngine._detectOrphansAndCoverage()` | Private method |
| `SlaWatchScheduleDrift` | → `SlaWatchEngine._detectScheduleDrift()` | Private method |
| `SlaWatchLiveness` | → `SlaWatchEngine._checkLiveness()` | Private method |
| `SlaWatchScorer` | → `SlaWatchEngine._computeBreachRiskScores()` | Private method |
| `SlaWatchReport` | → `SlaWatchReport` (kept) | Reporting layer |

**Rationale:** All five detectors operate on the same data (SLA definitions, `sys_dictionary`, schedules, `task_sla` attachment log) and share the same lifecycle (all run during a scan). They became private methods on a single `SlaWatchEngine` class. The reporting layer (`SlaWatchReport`) is a distinct responsibility — persistence, digest, and optional AI narrative — and is called independently of the scan, so it stays separate.

### Tables: 4 → 2

| Design Table | Absorbed Into | Strategy |
|--------------|---------------|----------|
| `x_sn_slawatch_finding` | (kept) | Primary findings table |
| `x_sn_slawatch_scan` | (kept) | Scan/audit-trail table |
| `x_sn_slawatch_score` | → `x_sn_slawatch_finding` (category=`score`) | Polymorphic category field |
| `x_sn_slawatch_schedule_baseline` | → `x_sn_slawatch_scan.baseline_json` | JSON column absorption |

**Rationale:**
- **Score records** are findings with `category='score'` and the numeric score stored in `detail`. The `category` choice field already partitions findings (condition_integrity, orphan, coverage, schedule_drift, liveness, score), so a separate score table was redundant.
- **Schedule baselines** are a `{sla_sys_id: fingerprint}` map stored as JSON on the most recent scan record (`baseline_json`). Baselines are always read/written alongside a scan, never queried independently, and fit comfortably in a 4000-char string field.

### REST Endpoints: 2 (within limit)

| Design Endpoint | Consolidated Into | Dispatch |
|----------------|-------------------|----------|
| Scan trigger | → `POST /execute` | `action: "scan"` |
| Digest | → `POST /execute` | `action: "digest"` |
| Executive summary | → `POST /execute` | `action: "summary"` |
| AI narrative | → `POST /execute` | `action: "narrative"` |
| Status/findings | → `GET /status` | `?scan_sys_id=`, `?category=`, `?severity=` |

---

## 2. Artifact Inventory

| Artifact | Path | Count |
|----------|------|-------|
| Scoped app manifest | `sys_app.xml` | 1 (combined, 42.5 KB) |
| Script Includes | `scripts/SlaWatchEngine.js`, `scripts/SlaWatchReport.js` | 2 |
| Custom tables | `tables/x_sn_slawatch_finding.xml`, `tables/x_sn_slawatch_scan.xml` | 2 |
| REST endpoints | `rest/post_execute.js`, `rest/get_status.js` | 2 |
| ACLs | `acl/acl_definitions.xml` | 6 ACLs + 2 roles |
| Scheduled job | `br/scheduled_job.xml` | 1 (daily scan) |

### Script Includes

| SI | Responsibility | Key methods |
|----|---------------|-------------|
| `SlaWatchEngine` | Deterministic detection engine | `runFullScan()`, `_scanConditionIntegrity()`, `_detectOrphansAndCoverage()`, `_detectScheduleDrift()`, `_checkLiveness()`, `_computeBreachRiskScores()` |
| `SlaWatchReport` | Persistence + digest + AI narrative | `persistFindings()`, `getRankedDigest()`, `getExecutiveSummary()`, `getBreachImpactNarrative()` |

### Tables

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `x_sn_slawatch_finding` | Findings (condition integrity, orphan, coverage, drift, liveness, score) | `scan` (ref), `sla` (ref contract_sla), `sla_name`, `sla_table`, `category` (choice), `severity` (choice), `message`, `field`, `field_value`, `detail`, `status` (choice) |
| `x_sn_slawatch_scan` | Scan/audit-trail records | `scan_type` (choice), `status` (choice), `started_at`, `completed_at`, `sla_count`, `finding_count`, `high_risk_count`, `summary_json`, `baseline_json` |

### REST Endpoints

| Endpoint | Method | Dispatch | Returns |
|----------|--------|----------|---------|
| `/api/x_sn_slawatch/execute` | POST | `action` body param | scan/digest/summary/narrative results |
| `/api/x_sn_slawatch/status` | GET | query params | scan detail + filtered findings |

### Cross-Scope Privileges (6)

| Target | Type | Operation |
|--------|------|-----------|
| `contract_sla` | table | read |
| `task_sla` | table | read |
| `sys_dictionary` | table | read |
| `cmn_schedule` | table | read |
| `cmn_schedule_span` | table | read |
| `sn_generative_ai` | scriptable | execute |

### Roles (2)

| Role | Purpose |
|------|---------|
| `x_sn_slawatch.user` | Read findings + scans, read status endpoint |
| `x_sn_slawatch.admin` | Write findings + scans, execute REST endpoints |

---

## 3. Feature Coverage Matrix

| Design Feature | Status | Implementation |
|----------------|--------|----------------|
| 1. Condition Integrity Scanner | ✅ Implemented | `_scanConditionIntegrity()` — parses start/pause/stop/reset conditions, cross-references fields against `sys_dictionary` |
| 2. Orphan & Coverage Detector | ✅ Implemented | `_detectOrphansAndCoverage()` — orphan SLAs + SLA-less task tables |
| 3. Schedule Drift Monitor | ✅ Implemented | `_detectScheduleDrift()` — schedule fingerprint vs stored baseline |
| 4. Attachment Liveness Check | ✅ Implemented | `_checkLiveness()` — never-attached + stale-attachment detection |
| 5. Breach-Risk Scoring Engine | ✅ Implemented | `_computeBreachRiskScores()` — composite 0-100 score, severity-weighted |
| 6. Scheduled Digest & Dashboard | ✅ Implemented | `getRankedDigest()` + `getExecutiveSummary()` + daily scheduled job |
| 7. Remediation Workbench | ⚠️ Partial | Findings table with status (open/resolved/ignored) + audit trail; "export as update set" deferred (no auto-apply, human-in-the-loop gate preserved) |

**AI Usage (optional, BYOK):** `getBreachImpactNarrative()` attempts Now Assist via `sn_generative_ai.GenerativeAI` with a deterministic fallback. AI is never load-bearing — all detection is pure GlideRecord logic.

---

## 4. Quality Notes

- **Read-only policy:** SLAWatch never modifies `contract_sla`, `task_sla`, or schedules. The only write path is to its own scoped tables (`finding`, `scan`). Remediation is human-approved; no auto-apply.
- **Deterministic core:** All five detectors are pure GlideRecord/Table-API logic — reproducible and auditable. No LLM in the critical path.
- **Delta scanning:** `runFullScan('delta', ...)` uses the high-water-mark baseline stored in `baseline_json`; full scans re-analyze the entire estate.
- **Security:** 6 ACLs (read/write per table + execute per endpoint), 2 role-gated roles, 6 cross-scope privileges. No hardcoded credentials.
- **Error handling:** All `insert()` calls wrapped in try/catch; REST endpoints return HTTP 400 for unknown actions with a valid-actions list.
- **Copyright:** All `.js` files carry the AGPL-3.0 header with full name "Vladimir Kapustin".

### Verification Results

| Check | Result |
|-------|--------|
| XML well-formedness (5 files) | ✅ All OK |
| JS syntax (`node --check`) | ✅ 4/4 OK |
| CDATA byte-match (4 blocks) | ✅ All MATCH |
| Copyright headers | ✅ 4/4 present |
| `JSON.stringify` on `setBody` | ✅ present |
| `try/catch` around inserts | ✅ present |
| REST 400 default case | ✅ `post_execute.js` (GET uses if/else, correct) |

---

## 5. File Tree

```
03_build/
├── sys_app.xml                          # Combined manifest (scope, roles, SIs, cross-scope, REST, scheduled job)
├── tables/
│   ├── x_sn_slawatch_finding.xml        # Findings table + dictionary + choices
│   └── x_sn_slawatch_scan.xml           # Scan table + dictionary + choices
├── scripts/
│   ├── SlaWatchEngine.js                # Detection engine (5 detectors + scorer)
│   └── SlaWatchReport.js                # Reporting layer (persist, digest, summary, AI narrative)
├── rest/
│   ├── post_execute.js                  # POST /execute (action dispatch)
│   └── get_status.js                    # GET /status (read-only reporting)
├── acl/
│   └── acl_definitions.xml              # 6 ACLs + 2 roles
└── br/
    └── scheduled_job.xml                # Daily SLA estate scan
```
