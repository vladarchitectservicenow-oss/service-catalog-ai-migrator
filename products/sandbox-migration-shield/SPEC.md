# Detailed Technical Specification — Sandbox Migration Shield

## Implementation Plan by User Story

---

### US-02 | US-03: Automated Scanner + Severity Classification

**Implementation:** `SandboxScanner` Script Include

**Files:**
- `src/script_includes/SandboxScanner.js`
- `src/scheduled_jobs/weekly_scan.js`

**Algorithm:**
```
1. Create scan_run record in x_snc_sms_scan_run (status: RUNNING)
2. For each target table [sys_script, sys_script_include, sys_script_client, 
   sys_ui_policy, sys_ui_action, sys_dictionary]:
   a. GlideRecord query: all active records
   b. For each record, extract script-containing fields (script, condition, 
      default_value, calculation, execute_function, ui_script)
   c. Run against KB2944435 pattern registry
   d. Classify: BLOCKING / WARNING / COMPATIBLE
   e. Write to x_snc_sms_scan_result referencing current scan_run
3. Update scan_run: completed_at, counts
4. Return summary
```

**KB2944435 Pattern Registry (extensible):**
```javascript
var PATTERNS = [
  {
    code: "KB2944435-001",
    regex: /\bPackages\.(java|javax)\b/,
    severity: "BLOCKING",
    message: "Java package access blocked in new sandbox"
  },
  {
    code: "KB2944435-002",
    regex: /\beval\s*\(/,
    severity: "BLOCKING",
    message: "eval() calls blocked in Phase 3"
  },
  {
    code: "KB2944435-003",
    regex: /\bgs\.(sleep|print|log)\s*\(/,
    severity: "WARNING",
    message: "Deprecated gs methods — use GlideSystem equivalents"
  },
  {
    code: "KB2944435-004",
    regex: /\bnew\s+Packages\b/,
    severity: "BLOCKING",
    message: "Package instantiation blocked"
  },
  {
    code: "KB2944435-005",
    regex: /\bGlideStringUtil\b/,
    severity: "WARNING",
    message: "Check GlideStringUtil compatibility — some methods deprecated"
  }
];
```

**Performance optimization:**
- Use `gr.setLimit(500)` with pagination for instances with >500 scripts per table
- Cache pattern regex compilation
- Use `gs.info()` for progress logging (not `gs.print()`)

---

### US-04 | US-05: One-Click Migration + Preview

**Implementation:** `MigrationEngine` Script Include

**Files:**
- `src/script_includes/MigrationEngine.js`

**Migration Flow:**
```
1. Receive scan_result_sys_id
2. Load scan_result record → get script_table, script_sys_id
3. GlideRecord get source script record
4. Extract the script content from the identified field
5. Generate Script Include name: sanitize(source_name) + "_Migrated"
6. Generate API name: "x_snc_sms." + camelCase(name)
7. Wrap extracted logic:
   - If inline expression → wrap in function(gr) { return (expression); }
   - If multi-line script → wrap in function(current, previous, g_scratchpad) { ... }
8. Generate replacement:
   - For sys_script.script: "new x_snc_sms.FunctionName().execute(current, previous);"
   - For sys_dictionary.default_value: "new x_snc_sms.FunctionName().getDefault(current);"
9. PREVIEW MODE: return { generated_script_include, replacement_call } — do NOT save
10. User confirms → EXECUTE: create sys_script_include, update source script field
11. Update scan_result: status = MIGRATED
12. Write audit_log entry
```

**Rollback:**
- Store `pre_migration_state` JSON in scan_result before migration
- Contains: original script content, original field name
- `rollback(scan_result_sys_id)`: restore original content, delete Script Include

---

### US-07: Exemption Registry

**Implementation:** `ExemptionManager` Script Include + Service Portal widget

**Files:**
- `src/script_includes/ExemptionManager.js`
- `src/ui/exemption_form.html`

**Create Exemption Flow:**
```
1. Receive: scan_result_sys_id, justification (min 50 chars), approver_sys_id, expiry_date
2. Validate: justification length, approver exists, expiry > today
3. Create x_snc_sms_exemption record: status = PENDING
4. Send notification to approver (sys_email + platform notification)
5. Update scan_result: status = EXEMPT (pending approval)
```

**Approval Flow:**
```
1. Approver clicks link → PATCH REST API or UI action
2. Update exemption: status = APPROVED, approved_at = now
3. Update scan_result: status = EXEMPT
4. Exclude from readiness score calculation
5. Write audit_log
```

---

### US-01 | US-11: Readiness Dashboard

**Implementation:** Service Portal Widgets + GlideAjax

**Files:**
- `src/ui/dashboard_widget.html`

**Dashboard Data (GlideAjax endpoint):**
```javascript
// Server-side
getDashboardData: function() {
  var data = {};
  var gr = new GlideAggregate('x_snc_sms_scan_result');
  gr.addAggregate('COUNT');
  gr.groupBy('severity');
  gr.query();
  while (gr.next()) {
    data[gr.severity + ''] = gr.getAggregate('COUNT');
  }
  
  // Calculate readiness
  var total = data.BLOCKING + data.WARNING + data.COMPATIBLE;
  var migrated = this._countByStatus('MIGRATED');
  var exempted = this._countByStatus('EXEMPT');
  data.readiness_score = Math.round(((data.COMPATIBLE + migrated + exempted) / total) * 100);
  
  return JSON.stringify(data);
}
```

---

### US-06: Upgrade Impact Predictor

**Implementation:** Scheduled Script Execution

**Files:**
- `src/script_includes/UpgradePredictor.js`

**Algorithm:**
```
1. Query sys_update_set for pending/committed update sets
2. For each update set, extract sys_remote_update_set records → contains new/modified scripts
3. Diff: filter to script records NOT in current scan results
4. Run SandboxScanner on diff'ed records only
5. Report: "N new scripts would be flagged if you upgrade now"
6. Store prediction in x_snc_sms_upgrade_prediction
```

---

### US-10: Weekly Email Reports

**Implementation:** Scheduled Job + Email Notification

**Files:**
- `src/scheduled_jobs/weekly_report.js`

```
1. Run weekly on Monday 07:00
2. Query most recent scan_run
3. Build email body: readiness score, delta from last week, top blocking scripts
4. Send via gs.eventQueue('x_snc_sms.weekly.report', scan_run, recipients)
```

---

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| Scan times out (>2 min) | Auto-paginate, resume from last offset |
| Script Include name collision | Append numeric suffix: "_Migrated_2" |
| Migration preview generation fails | Log error to audit_log, return user-friendly message |
| Rollback fails | Alert admin, preserve backup data for manual recovery |
| REST API auth failure | Return 401 with WWW-Authenticate header |
| Missing approver | Return 400 with "Invalid approver" |
| Empty scan (no scripts found) | Return success with count=0, not an error |

## Logging and Monitoring

- **`x_snc_sms_audit_log`**: All mutations (SCAN, MIGRATE, EXEMPTION_*, ROLLBACK)
- **Platform syslog**: `gs.info()` for scan progress, `gs.warn()` for recoverable issues, `gs.error()` for failures
- **System Properties:**
  - `x_snc_sms.log_level`: DEBUG/INFO/WARN/ERROR (default: INFO)
  - `x_snc_sms.retention_days`: Auto-delete scan results older than N days (default: 90)

## Testing Strategy

### ATF Tests (Automated Test Framework)
1. **Scan smoke test:** Create test scripts with known patterns → run scanner → verify classification
2. **Migration test:** Create script → migrate → verify Script Include created, source updated
3. **Exemption test:** Create exemption → approve → verify status update
4. **Rollback test:** Migrate → rollback → verify original restored

### Manual Tests
1. Dashboard renders for instances with 0 scripts (empty state)
2. Dashboard renders for instances with 5,000+ scripts (performance)
3. PDF export produces valid PDF

### Unit Tests (Jasmine — ServiceNow ATF)
- SandboxScanner pattern matching accuracy (target: >95% detection)
- MigrationEngine name generation logic
- ExemptionManager expiry calculation
