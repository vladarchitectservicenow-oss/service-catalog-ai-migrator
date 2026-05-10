# UI/UX Design — AI Readiness Diagnostic

## Screen 1: Executive Dashboard

```
┌───────────────────────────────────────────────────────────────────┐
│  AI READINESS DIAGNOSTIC                           [⚙️ Config]      │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │                    OVERALL AI READINESS                      │ │
│   │                                                              │ │
│   │                      ┌───────────┐                           │ │
│   │                      │    62%    │                           │ │
│   │                      │  NEEDS    │                           │ │
│   │                      │   WORK    │                           │ │
│   │                      └───────────┘                           │ │
│   │                                                              │ │
│   │   Workflow Health  ████████████░░░░░░  71%                   │ │
│   │   CMDB Health      ████████░░░░░░░░░░  48%  ⚠️ CRITICAL     │ │
│   │   KB Health        ██████████░░░░░░░░  65%                   │ │
│   │   Integration      ██████████████░░░░  82%                   │ │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│   ┌───────────────────────┐  ┌────────────────────────────────┐   │
│   │  🔴 CRITICAL ISSUES   │  │  📈 READINESS TREND            │   │
│   │                       │  │                                │   │
│   │  23 issues found      │  │  Week 1:  ██ 58%              │   │
│   │                       │  │  Week 2:  ██ 60%              │   │
│   │  Top blocker:         │  │  Week 3:  ██ 62% ▲            │   │
│   │  CMDB completeness    │  │                                │   │
│   │  at 48% — Otto        │  │  Target:   ████████ 85%       │   │
│   │  can't find 52% of    │  │                                │   │
│   │  enterprise assets    │  │                                │   │
│   └───────────────────────┘  └────────────────────────────────┘   │
│                                                                    │
│   [🔄 RUN DIAGNOSTIC]  [📊 EXPORT REPORT]  [🧪 SIMULATE AI]      │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## Screen 2: Workflow Health Detail

```
┌───────────────────────────────────────────────────────────────────┐
│  WORKFLOW HEALTH                    [All ▾] [Critical ▾] [Sort ▾] │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────┬─────────────────┬───────┬──────────┬────────────┐     │
│   │SCORE │ WORKFLOW        │ ISSUES│ AI IMPACT│ STATUS     │     │
│   ├──────┼─────────────────┼───────┼──────────┼────────────┤     │
│   │ 🔴45 │ Employee Onboard│   6   │  HIGH    │ NEW     [→]│     │
│   │ 🔴38 │ VPN Provisioning│   8   │  CRITICAL│ NEW     [→]│     │
│   │ 🟡65 │ Password Reset  │   3   │  MEDIUM  │ IN PROG [→]│     │
│   │ 🟢92 │ Software Install│   1   │  LOW     │ FIXED   [→]│     │
│   │ 🟡70 │ Access Revoke   │   2   │  MEDIUM  │ NEW     [→]│     │
│   └──────┴─────────────────┴───────┴──────────┴────────────┘     │
│                                                                    │
│   [EXPORT ALL]  [ASSIGN SELECTED]  [MARK AS FIXED]                │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## Screen 3: AI Simulation Results

```
┌───────────────────────────────────────────────────────────────────┐
│  AI AGENT SIMULATION              [Run New Simulation]             │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Simulating: 340 workflows against current instance state         │
│                                                                    │
│   ┌────────────────────────────────────────────────────────────┐  │
│   │  ✅ 182 PASS — Otto executes correctly                     │  │
│   │  ⚠️ 91 WARNING — Otto works but needs user input           │  │
│   │  ❌ 67 FAIL — Otto cannot complete (data missing)          │  │
│   └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│   Top Failure Patterns:                                            │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  1. CI_NOT_FOUND (34 failures)                            │    │
│   │     → CMDB missing 52% of assets. Fix: CMDB enrichment.   │    │
│   │                                                           │    │
│   │  2. KB_ARTICLE_MISSING (22 failures)                      │    │
│   │     → No knowledge article for common request types.      │    │
│   │                                                           │    │
│   │  3. INACTIVE_APPROVER (11 failures)                       │    │
│   │     → Approval flows reference departed employees.        │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## User Flows

### Onboarding Flow
1. Install → landing: "AI Readiness Diagnostic — Measure before you invest"
2. Click "Run First Diagnostic" → Progress with category-by-category status
3. Redirect to Dashboard → Readiness Score 62% with breakdown
4. "Biggest Blocker" card links to CMDB detail → shows per-class completeness
5. User clicks "Simulate AI" → sees 67 workflows would fail with Otto
6. User clicks "Generate Roadmap" → prioritized fix list with effort estimates

### Weekly Executive Check-in
1. VP opens Dashboard → sees 62% → 85% target line
2. Trend shows steady improvement (58→60→62)
3. Clicks "What changed?" → shows 12 workflows fixed this week
4. Exports PDF report for board presentation
