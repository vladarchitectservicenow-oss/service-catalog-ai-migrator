# UI/UX Design — Workflow Cost Optimizer

## Screen 1: Decision Dashboard

```
┌───────────────────────────────────────────────────────────────────┐
│  WORKFLOW COST OPTIMIZER                     [⚙️ Pricing Models]   │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌───────────────────────┐  ┌──────────────────────────────┐     │
│   │  ANNUAL AI SPEND      │  │  POTENTIAL SAVINGS           │     │
│   │                       │  │                              │     │
│   │   $216,000            │  │   $65,000                     │     │
│   │   Current (100% SN)   │  │   With Optimized Routing     │     │
│   │                       │  │   ▼ 30% savings              │     │
│   └───────────────────────┘  └──────────────────────────────┘     │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  RECOMMENDED ROUTING MAP                                  │    │
│   │                                                           │    │
│   │  ┌─────────────────────────────────────────────────────┐  │    │
│   │  │  NOW ASSIST (45 workflows — $96K/yr)                 │  │    │
│   │  │  ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░   │  │    │
│   │  │  • Onboarding • Offboarding • VPN access             │  │    │
│   │  │  • Compliance ticket • Audit request                 │  │    │
│   │  ├─────────────────────────────────────────────────────┤  │    │
│   │  │  MOVEWORKS / SLACK AI (72 workflows — $42K/yr)      │  │    │
│   │  │  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  │    │
│   │  │  • Password reset • Software install • Email config  │  │    │
│   │  │  • Desk booking • "How do I..." queries              │  │    │
│   │  ├─────────────────────────────────────────────────────┤  │    │
│   │  │  MANUAL / KEEP (10 workflows — $13K/yr)             │  │    │
│   │  │  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  │    │
│   │  │  • Physical badge issue • Emergency escalation       │  │    │
│   │  └─────────────────────────────────────────────────────┘  │    │
│   └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│   [🔄 RE-SCAN WORKFLOWS]  [💾 EXPORT]  [📊 ROI DETAILS]          │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## Screen 2: Workflow Cost Comparison

```
┌───────────────────────────────────────────────────────────────────┐
│  COST COMPARISON — Password Reset         [< Back to Dashboard]   │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   Volume: 450 requests/month | Resolution: 3 min avg              │
│   Channel: 65% Slack, 25% Portal, 10% Email                       │
│                                                                    │
│   ┌─────────────┬────────────┬─────────────┬──────────────┐       │
│   │  PLATFORM   │ MONTHLY $  │ ANNUAL $    │ $ PER TICKET │       │
│   ├─────────────┼────────────┼─────────────┼──────────────┤       │
│   │ Now Assist  │  $2,340    │  $28,080    │    $5.20     │       │
│   │ Moveworks   │  $1,520    │  $18,240    │ ✅ $3.38    │       │
│   │ Slack AI    │  $1,350    │  $16,200    │ ✅ $3.00    │       │
│   │ Standalone  │  $1,800    │  $21,600    │    $4.00     │       │
│   └─────────────┴────────────┴─────────────┴──────────────┘       │
│                                                                    │
│   ┌────────────────────────────────────────────────────────────┐  │
│   │  ⚠️ COMPLIANCE CHECK                                       │  │
│   │  Data sensitivity: LOW — no compliance restrictions        │  │
│   │  All platforms are viable for this workflow                 │  │
│   └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│   RECOMMENDATION: Route to SLACK AI                               │
│   Reason: Lowest cost + users already submit via Slack            │
│                                                                    │
│   [APPLY RECOMMENDATION]  [OVERRIDE]                              │
└───────────────────────────────────────────────────────────────────┘
```

## Screen 3: ROI Projection

```
┌───────────────────────────────────────────────────────────────────┐
│  ROI PROJECTION                               [< Back]             │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌────────────────────────────────────────────────────────────┐  │
│   │                   3-YEAR PROJECTION                         │  │
│   │                                                             │  │
│   │   YEAR 1      YEAR 2      YEAR 3                           │  │
│   │   ┌────┐      ┌────┐      ┌────┐                           │  │
│   │   │    │      │    │      │    │                            │  │
│   │   │SN  │      │SN  │      │SN  │                            │  │
│   │   │$151│      │$158│      │$166│                            │  │
│   │   │ K  │      │ K  │      │ K  │                            │  │
│   │   └────┘      └────┘      └────┘                           │  │
│   │   ┌────┐      ┌────┐      ┌────┐                           │  │
│   │   │OPT │      │OPT │      │OPT │                            │  │
│   │   │$151│      │$130│      │$117│  ← savings grow as        │  │
│   │   │ K  │      │ K  │      │ K  │    more workflows migrate  │  │
│   │   └────┘      └────┘      └────┘                           │  │
│   │                                                             │  │
│   │   Cumulative savings: $55K (Year 1) → $165K (Year 3)      │  │
│   │   Break-even: Month 3                                       │  │
│   └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│   [ADJUST ASSUMPTIONS]  [EXPORT TO PDF]                            │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

## User Flows

### First-Time Evaluation
1. Install → landing "Know your AI cost before you commit"
2. Click "Scan Workflows" → Profiles all 127 catalog items + incident categories
3. Redirect to Dashboard → Shows $216K current annual AI spend
4. User clicks "Optimize" → Routing engine runs → shows 3-tier split
5. User explores individual workflow comparisons
6. Clicks "ROI Details" → 3-year projection
7. Exports PDF for budget proposal → Done

### Annual Renewal Review
1. Ops Director logs in quarterly
2. Dashboard shows costs drifted (vendor pricing changed)
3. Clicks "Update Pricing Models" → adjusts Moveworks rate (new contract)
4. Clicks "Re-optimize" → Routing adjusts — 8 workflows move to Moveworks
5. Saves updated routing map as new baseline
