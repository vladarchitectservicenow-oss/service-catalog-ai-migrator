# DemoSeed — Execution Plan

## Phase Overview

| Phase | Name | Status | Owner | Est. Effort |
|-------|------|--------|-------|-------------|
| 1 | Architecture & Design | ✅ Complete | Architect | 4h |
| 2 | Core Engine (DemoSeedCore) | ✅ Complete | Developer | 12h |
| 3 | Support Services (DemoSeedHelper) | ✅ Complete | Developer | 8h |
| 4 | REST API Layer | ✅ Complete | Developer | 4h |
| 5 | Business Rules & ACLs | ✅ Complete | Developer | 3h |
| 6 | Table Definitions | ✅ Complete | Developer | 2h |
| 7 | Unit Tests | ✅ Complete | QA | 6h |
| 8 | Documentation | 🔄 In Progress | Tech Writer | 4h |
| 9 | PDI Smoke Test | ⬜ Pending | QA | 2h |
| 10 | GitHub Release | ⬜ Pending | DevOps | 1h |

## Detailed Task Breakdown

### Phase 1: Architecture & Design ✅
- [x] Define table schemas (x_demoseed_config, x_demoseed_audit)
- [x] Design REST API contract (POST execute, GET status)
- [x] Define distribution profiles (priority, category, risk, state)
- [x] Design snapshot/restore flow
- [x] Design field mapper algorithm
- [x] Define AI integration points

### Phase 2: Core Engine (DemoSeedCore) ✅
- [x] Dashboard Scanner — scanDashboards(), getIndicatorSources(), buildManifest()
- [x] Data Generator — generate(), generateForTable()
- [x] Distribution Profiles — _getPriority(), _getCategory(), _getRiskLevel(), _getChangeState(), _getResolutionCode()
- [x] Date Generation — _getRandomDate() with weekday weighting
- [x] Reference Resolution — _getRandomReference(), _getAssignmentGroup(), _getRandomChoice()
- [x] Table-Specific Populators — _populateIncident(), _populateChangeRequest(), _populateCatalogItem(), _populateChangeTask(), _populateCustomRecord()
- [x] Field Value Generator — _generateFieldValue(), _weightedPick()
- [x] Title/Description Templates — _getIncidentTitle(), _getIncidentDescription(), _getChangeTitle(), _getChangeDescription(), _getCatalogTitle(), _getChangeTaskTitle()
- [x] Data Wiper — wipeBatch(), wipeByDateRange(), wipeAll(), getWipePreview()
- [x] Audit Trail — _auditRecord()
- [x] Production Guard — _isProduction()
- [x] Default Tables — _getDefaultTables()
- [x] Field Mappings Loader — _getFieldMappings()

### Phase 3: Support Services (DemoSeedHelper) ✅
- [x] Refresh Scheduler — refreshDaily(), _simulateAging(), shouldStop()
- [x] Snapshot Manager — saveSnapshot(), restoreSnapshot(), exportXML(), _collectSnapshotData(), _xmlEscape()
- [x] AI Description Generator — generateDescriptions(), generateDemoNarrative(), validateDataQuality()
- [x] AI Prompt Manager — _getAIPrompt()
- [x] Template Fallbacks — _templateDescriptions(), _templateNarrative(), _basicQualityCheck()
- [x] Field Mapper — suggestMappings(), applyMapping(), generateField()

### Phase 4: REST API Layer ✅
- [x] POST /execute — Action dispatch (generate, wipe_batch, wipe_range, wipe_all, refresh, save_snapshot, restore_snapshot, export_snapshot_xml, apply_field_mappings, generate_descriptions, generate_narrative, validate_quality)
- [x] GET /status — Query dispatch (batch status, wipe preview, snapshots list, snapshot detail, profiles list, dashboard manifest, field suggestions)
- [x] Error handling — 400 for unknown actions, 500 for internal errors
- [x] JSON response formatting

### Phase 5: Business Rules & ACLs ✅
- [x] br_auto_wipe — Cascade wipe on profile delete
- [x] br_validate_batch — Batch ID uniqueness validation
- [x] ACLs — Read/Write/Create/Delete on x_demoseed_config and x_demoseed_audit
- [x] REST ACLs — Execute on both endpoints

### Phase 6: Table Definitions ✅
- [x] x_demoseed_config — Polymorphic config table with all fields
- [x] x_demoseed_audit — Audit trail table with all fields
- [x] sys_app.xml — Scoped app manifest with plugin dependencies

### Phase 7: Unit Tests ✅
- [x] T01-T05: Dashboard Scanner (5 tests)
- [x] T06-T10: Data Generator (5 tests)
- [x] T11-T15: Distribution Profiles (5 tests)
- [x] T16-T20: Data Wiper (5 tests)
- [x] T21-T25: Refresh Scheduler (5 tests)
- [x] T26-T30: Snapshot Manager (5 tests)
- [x] T31-T35: Field Mapper (5 tests)
- [x] T36-T40: AI Features (5 tests)
- [x] T41-T45: Edge Cases (5 tests)
- [x] T46-T50: REST Endpoint Logic (5 tests)
- **Total: 50 tests, all passing**

### Phase 8: Documentation 🔄
- [x] architecture_summary.md
- [x] dependency_report.md
- [x] risk_report.md
- [ ] execution_plan.md (this file)
- [ ] test_suite_SOP.md
- [ ] regression_cases.md
- [ ] edge_cases.md
- [ ] validation_checklist.md
- [ ] README.md (2000+ words)
- [ ] LICENSE

### Phase 9: PDI Smoke Test ⬜
- [ ] Install on PDI
- [ ] Create ITSM profile
- [ ] Run generate via REST
- [ ] Verify records in incident/change_request/change_task
- [ ] Run wipe
- [ ] Verify records removed
- [ ] Test snapshot save/restore
- [ ] Test field mapper

### Phase 10: GitHub Release ⬜
- [ ] Commit all files
- [ ] Push to umbrella repo
- [ ] Create DONE.marker
- [ ] Update pipeline progress

## Dependencies Between Phases

```
Phase 1 (Design)
  └─→ Phase 2 (Core Engine)
       └─→ Phase 3 (Support Services)
            └─→ Phase 4 (REST API)
                 └─→ Phase 5 (BR/ACLs)
                      └─→ Phase 6 (Tables)
                           └─→ Phase 7 (Tests)
                                └─→ Phase 8 (Docs)
                                     └─→ Phase 9 (Smoke Test)
                                          └─→ Phase 10 (Release)
```

## Risk Mitigation Timeline

| Risk | Mitigation Status | Verification |
|------|-------------------|-------------|
| R01: Production Corruption | ✅ Guard implemented | T10 test verifies |
| R02: Bulk Insert Performance | ✅ Volume configurable | Configurable per profile |
| R03: Orphaned Audit Records | ✅ Graceful skip | T16-T20 verify |
| R04: AI Plugin Dependency | ✅ Template fallback | T36-T40 verify |
| R05: Snapshot Size Limits | ✅ Metadata-only | T26-T30 verify |
| R06: Cross-Scope Access | ✅ Defined in sys_app.xml | PDI smoke test |
| R07: Concurrent Batches | ✅ GUID isolation | T06 verifies |
| R08: Scheduled Job Overlap | ✅ Low daily volume | T21-T25 verify |
| R09: Field Mapper Drift | ✅ Dynamic schema read | T31-T35 verify |
| R10: Wipe Shared Tables | ✅ Audit-trail-gated | T16-T20 verify |
| R11: ES5 Compatibility | ✅ Verified in tests | All 50 tests pass |
| R12: AI Prompt Injection | ✅ Admin-gated, local | Role-based ACLs |
