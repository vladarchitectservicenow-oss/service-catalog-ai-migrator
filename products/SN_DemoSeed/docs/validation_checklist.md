# DemoSeed — Validation Checklist

## Legend

| Code | Category |
|------|----------|
| D | Documentation |
| T | Testing |
| R | Requirements |
| L | Legal/License |
| S | Security |
| G | Git/Release |
| F | Functional |

## Checklist

### Documentation (D)

- [ ] D01: README.md exists and is ≥2000 words
- [ ] D02: README.md includes Mermaid architecture diagram
- [ ] D03: README.md includes ROI analysis section
- [ ] D04: README.md includes Troubleshooting section
- [ ] D05: README.md includes Installation instructions
- [ ] D06: README.md includes Configuration section
- [ ] D07: README.md includes API Reference section
- [ ] D08: architecture_summary.md exists with ≥50 lines
- [ ] D09: architecture_summary.md includes component diagram
- [ ] D10: architecture_summary.md includes data flow description
- [ ] D11: architecture_summary.md includes table schemas
- [ ] D12: architecture_summary.md includes performance characteristics
- [ ] D13: architecture_summary.md includes security model
- [ ] D14: dependency_report.md exists with ≥50 lines
- [ ] D15: dependency_report.md lists all OOTB table dependencies
- [ ] D16: dependency_report.md lists all plugin dependencies
- [ ] D17: dependency_report.md lists all system properties
- [ ] D18: dependency_report.md lists all Script Includes
- [ ] D19: dependency_report.md lists all REST endpoints
- [ ] D20: dependency_report.md lists all ACLs
- [ ] D21: risk_report.md exists with ≥10 risk entries
- [ ] D22: risk_report.md includes severity tags (P0-P3)
- [ ] D23: risk_report.md includes mitigation for each risk
- [ ] D24: risk_report.md includes residual risk assessment
- [ ] D25: execution_plan.md exists with ≥50 lines
- [ ] D26: execution_plan.md includes phase breakdown with status
- [ ] D27: execution_plan.md includes task-level detail
- [ ] D28: execution_plan.md includes dependency graph
- [ ] D29: test_suite_SOP.md exists with ≥10 scenarios
- [ ] D30: test_suite_SOP.md includes T01-T50 test IDs
- [ ] D31: test_suite_SOP.md includes pass criteria
- [ ] D32: regression_cases.md exists with ≥8 cases (R01-R12)
- [ ] D33: edge_cases.md exists with ≥5 cases (E01-E15)
- [ ] D34: validation_checklist.md exists with ≥60 items (this file)

### Testing (T)

- [ ] T01: All 50 unit tests pass (node tests/test_demoseed.js)
- [ ] T02: Test exit code is 0
- [ ] T03: Dashboard Scanner tests pass (T01-T05)
- [ ] T04: Data Generator tests pass (T06-T10)
- [ ] T05: Distribution Profile tests pass (T11-T15)
- [ ] T06: Data Wiper tests pass (T16-T20)
- [ ] T07: Refresh Scheduler tests pass (T21-T25)
- [ ] T08: Snapshot Manager tests pass (T26-T30)
- [ ] T09: Field Mapper tests pass (T31-T35)
- [ ] T10: AI Feature tests pass (T36-T40)
- [ ] T11: Edge Case tests pass (T41-T45)
- [ ] T12: REST Endpoint tests pass (T46-T50)
- [ ] T13: Production guard test passes (T10)
- [ ] T14: No unhandled exceptions in test output
- [ ] T15: Mock stores properly reset between tests

### Requirements (R)

- [ ] R01: Scoped app scope is x_demoseed
- [ ] R02: Maximum 2 Script Includes (DemoSeedCore, DemoSeedHelper)
- [ ] R03: Maximum 2 REST endpoints (POST execute, GET status)
- [ ] R04: Maximum 2 custom tables (x_demoseed_config, x_demoseed_audit)
- [ ] R05: All code is ES5-compatible (Rhino engine)
- [ ] R06: No arrow functions in source code
- [ ] R07: No let/const declarations in source code
- [ ] R08: No template literals in source code
- [ ] R09: Production guard on all generation paths
- [ ] R10: AI features have template fallbacks
- [ ] R11: All GlideRecord insert() calls wrapped in try/catch
- [ ] R12: All GlideRecord update() calls wrapped in try/catch
- [ ] R13: REST endpoints return proper HTTP status codes (200, 400, 500)
- [ ] R14: REST endpoints return JSON (not raw objects)
- [ ] R15: response.setBody() receives JSON.stringify() output

### Legal/License (L)

- [ ] L01: LICENSE file exists at product root
- [ ] L02: LICENSE contains 'Copyright (C) 2026 Vladimir Kapustin'
- [ ] L03: LICENSE is AGPL-3.0 (full text, not SPDX-only)
- [ ] L04: All .js files have copyright header
- [ ] L05: Copyright header uses '(C)' uppercase
- [ ] L06: Copyright header uses full name 'Vladimir Kapustin'
- [ ] L07: Copyright header includes SPDX-License-Identifier: AGPL-3.0
- [ ] L08: No file uses 'Vladimir K.' or 'V.K.' abbreviation
- [ ] L09: sys_app.xml includes copyright in XML comment
- [ ] L10: No hardcoded credentials in source code

### Security (S)

- [ ] S01: Production guard checks glide.installation.production
- [ ] S02: Production guard checks x_demoseed.override_prod property
- [ ] S03: ACLs defined for x_demoseed_config (read/create/write/delete)
- [ ] S04: ACLs defined for x_demoseed_audit (read/create/write/delete)
- [ ] S05: REST endpoint ACLs defined (execute)
- [ ] S06: Cross-scope access defined for all 14 OOTB tables
- [ ] S07: No hardcoded passwords or tokens
- [ ] S08: AI prompts only editable by x_demoseed.admin
- [ ] S09: Wipe operations are audit-trail-gated
- [ ] S10: No sensitive data in error messages

### Git/Release (G)

- [ ] G01: All files committed to git
- [ ] G02: Commit message follows conventional format
- [ ] G03: Push to umbrella repo successful
- [ ] G04: DONE.marker created
- [ ] G05: Pipeline progress updated
- [ ] G06: No .pipeline/ or __pycache__/ in commit
- [ ] G07: No honcho.db in commit
- [ ] G08: .gitignore exists and excludes build artifacts

### Functional (F)

- [ ] F01: Dashboard scanner returns correct manifest structure
- [ ] F02: Data generator creates records in all target tables
- [ ] F03: Distribution profiles produce realistic distributions
- [ ] F04: Data wiper removes only tracked records
- [ ] F05: Refresh scheduler processes active profiles
- [ ] F06: Aging simulation closes old incidents
- [ ] F07: Snapshot save captures current state
- [ ] F08: Snapshot restore reproduces state
- [ ] F09: Snapshot XML export is well-formed
- [ ] F10: Field mapper reads sys_dictionary correctly
- [ ] F11: Field mapper creates config records
- [ ] F12: AI descriptions fall back to templates
- [ ] F13: AI narrative falls back to templates
- [ ] F14: Quality validation detects clustering
- [ ] F15: Quality validation detects distribution anomalies
- [ ] F16: REST execute dispatches all 11 actions
- [ ] F17: REST status returns all 7 query types
- [ ] F18: Unknown REST actions return 400 with valid_actions
- [ ] F19: Batch isolation prevents cross-batch interference
- [ ] F20: Wipe preview matches actual wipe count
