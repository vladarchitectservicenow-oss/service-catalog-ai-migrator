# UI/UX Design — Sandbox Migration Shield

## Design System

- **Framework:** Service Portal (AngularJS widgets) + UI Builder for Workspace variant
- **Theme:** ServiceNow standard (polaris) with custom accent color for branding
- **Responsive:** Desktop-first (1680px optimal), tablet-compatible (1024px)

---

## Screen 1: Main Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  SANDBOX MIGRATION SHIELD                          [⚙️ Settings] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│   │   READINESS  │  │   SCRIPTS    │  │   ACTIONS    │          │
│   │    SCORE     │  │   SCANNED    │  │   NEEDED     │          │
│   │              │  │              │  │              │          │
│   │     78%      │  │    3,247     │  │     142      │          │
│   │   ▲ +5% WoW  │  │              │  │              │          │
│   └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│   ┌─────────────────────────────────────────────┐               │
│   │           SCRIPT SEVERITY BREAKDOWN          │               │
│   │                                              │               │
│   │   BLOCKING:    ████████████  142  (4.4%)    │               │
│   │   WARNING:     ████████       98  (3.0%)    │               │
│   │   COMPATIBLE:  ███████████████████████████  2,850  │       │
│   │   EXEMPT:      ██             45  (1.4%)    │               │
│   │   MIGRATED:    ███           112  (3.4%)    │               │
│   │                                              │               │
│   └─────────────────────────────────────────────┘               │
│                                                                  │
│   ┌─────────────────────────────────────────────┐               │
│   │           TREND (WEEK-OVER-WEEK)             │               │
│   │   📈 Blocking scripts: 198 → 142 (▼28%)     │               │
│   │   📈 Migrated:         56 → 112 (▲100%)     │               │
│   └─────────────────────────────────────────────┘               │
│                                                                  │
│   [🔄 RUN NEW SCAN]   [📊 EXPORT PDF]   [📧 SEND REPORT]        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Screen 2: Scan Results Table

```
┌─────────────────────────────────────────────────────────────────┐
│  SCAN RESULTS          [Back to Dashboard]    [Filter: ▾]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Search: [________________________]  Severity: [ALL ▾]          │
│   Table: [ALL ▾]  Status: [ALL ▾]                                │
│                                                                  │
│   ┌──────┬──────────────┬──────────┬──────────┬──────────┐      │
│   │ SEV  │ SCRIPT NAME  │ TABLE    │ ISSUE    │ STATUS   │      │
│   ├──────┼──────────────┼──────────┼──────────┼──────────┤      │
│   │ 🔴   │ closeTaskBR  │sys_script│ KB-001   │ NEW      │[→]│  │
│   │ 🔴   │ calcPriority │sys_dict  │ KB-004   │ NEW      │[→]│  │
│   │ 🟡   │ approvalUI   │sys_ui_act│ KB-003   │ REVIEW   │[→]│  │
│   │ 🟢   │ getUserData  │sys_scr_i │ -        │ SAFE     │    │  │
│   │ ⚪   │ legacyFunc   │sys_script│ KB-003   │ EXEMPT   │[→]│  │
│   │ 🟣   │ migrateMe    │sys_script│ KB-001   │ MIGRATED │[→]│  │
│   └──────┴──────────────┴──────────┴──────────┴──────────┘      │
│                                                                  │
│   Showing 1-50 of 352 results                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Screen 3: Script Detail + Migration Preview

```
┌─────────────────────────────────────────────────────────────────┐
│  SCRIPT DETAIL: closeTaskBR                      [< Back to List] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────┐                   │
│   │  DETAILS                                 │                   │
│   │  ─────────────────────────────────────   │                   │
│   │  Table:      sys_script                  │                   │
│   │  Name:       Close Task Business Rule    │                   │
│   │  Severity:   🔴 BLOCKING                 │                   │
│   │  Issue:      KB2944435-001               │                   │
│   │  Status:     NEW                         │                   │
│   │                                          │                   │
│   │  ISSUE DESCRIPTION                       │                   │
│   │  Java package access (Packages.java)     │                   │
│   │  blocked in new sandbox (Phase 3)        │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                  │
│   ┌─────────────────────────────────────────┐                   │
│   │  SOURCE CODE                             │                   │
│   │  ─────────────────────────────────────   │                   │
│   │  var StringWriter = Packages.java.io.    │                   │
│   │    StringWriter;  // ← BLOCKED           │                   │
│   │  var sw = new StringWriter();            │                   │
│   │  current.work_notes = sw.toString();     │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                  │
│   ┌─────────────────────────────────────────┐                   │
│   │  MIGRATION PREVIEW                       │                   │
│   │  ─────────────────────────────────────   │                   │
│   │  Script Include Name: CloseTaskBR_Migrated│                  │
│   │  API Name: x_snc_sms.CloseTaskBR_Migrated│                  │
│   │                                          │                   │
│   │  ┌ Generated Script Include ──────────┐  │                   │
│   │  │ var CloseTaskBR_Migrated = Class.  │  │                   │
│   │  │ create();                          │  │                   │
│   │  │ CloseTaskBR_Migrated.prototype = { │  │                   │
│   │  │   execute: function(current) {     │  │                   │
│   │  │     var sw = new GlideStringUtil() │  │                   │
│   │  │       .getStringWriter();          │  │                   │
│   │  │     current.work_notes =           │  │                   │
│   │  │       sw.toString();               │  │                   │
│   │  │   }                                │  │                   │
│   │  │ };                                 │  │                   │
│   │  └────────────────────────────────────┘  │                   │
│   │                                          │                   │
│   │  ┌ Replacement Call ──────────────────┐  │                   │
│   │  │ new x_snc_sms.CloseTaskBR_Migrated()│  │                   │
│   │  │   .execute(current);                │  │                   │
│   │  └────────────────────────────────────┘  │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                  │
│   [✅ EXECUTE MIGRATION]  [💾 EXEMPT]  [❌ CANCEL]              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Screen 4: Exemption Form

```
┌─────────────────────────────────────────────────────────────────┐
│  REQUEST EXEMPTION: closeTaskBR                  [< Back]         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Script:           closeTaskBR (sys_script)                     │
│   Issue:            KB2944435-001 — Java package access          │
│                                                                  │
│   Business Justification: *                                      │
│   ┌─────────────────────────────────────────┐                   │
│   │ This script integrates with a legacy    │                   │
│   │ third-party Java library that has no    │                   │
│   │ JavaScript equivalent. Migration planned │                   │
│   │ for Q4 2026 when vendor releases new API.│                   │
│   └─────────────────────────────────────────┘                   │
│   Min 50 characters — 238/4000                                   │
│                                                                  │
│   Approver:          [John Smith (Manager) ▾]                    │
│                                                                  │
│   Expiration Date:   [📅 2027-05-10]                             │
│                                                                  │
│   ┌─────────────────────────────────────────┐                   │
│   │  ⚠️ Exempted scripts are excluded from   │                   │
│   │  readiness score and must be reviewed    │                   │
│   │  annually. Ensure justification is       │                   │
│   │  sufficient for audit purposes.          │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                  │
│   [✅ SUBMIT FOR APPROVAL]  [❌ CANCEL]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Flows

### Flow 1: First-Time User (Onboarding)
1. Install scoped app → Landing page: "Welcome to Sandbox Migration Shield"
2. Click "Run First Scan" → Progress bar (30-120 seconds) → Auto-redirect to Dashboard
3. Dashboard shows results → User clicks "Blocking" card → Drill-down to filtered list
4. User clicks first blocking script → Detail view with migration preview
5. User clicks "Execute Migration" → Confirmation modal → Success toast
6. Repeat 4-5 for next scripts or bulk-select multiple
7. Return to Dashboard → See readiness score updated

### Flow 2: Weekly Admin Routine
1. Admin receives Monday email: "Weekly Migration Report — Readiness: 78%"
2. Clicks link → Opens Dashboard
3. Reviews trend chart → Blocking scripts down, migrated up
4. Clicks "New This Week" filter → Sees 12 new scripts flagged after last patch
5. Migrates 8, exempts 4 → Done <10 minutes

### Flow 3: Compliance Audit
1. Architect logs in → Navigates to Exemption Registry
2. Filters: Status = APPROVED, Expiring < 30 days
3. Reviews each exemption → Clicks "Extend" or "Revoke"
4. Exports full audit log as PDF → Attaches to compliance submission

---

## Accessibility Considerations

- All interactive elements have ARIA labels
- Color is not the sole indicator of severity — icons (🔴🟡🟢) + text labels
- Keyboard navigation: Tab through filters, Enter to select, Escape to close modals
- Screen reader: `aria-live="polite"` for scan progress updates
- Contrast ratio: >4.5:1 for all text (meets WCAG AA)

## Mobile Responsiveness

- Dashboard cards stack vertically on <768px
- Table collapses to card view on mobile (one card per script)
- Migration preview hidden behind "Show Preview" toggle on small screens
- Primary actions (Run Scan, Export) remain visible as sticky bottom bar
