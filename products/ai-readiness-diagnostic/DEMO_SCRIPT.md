# Live Demo Script — AI Readiness Diagnostic

## Pre-Demo Setup
- [ ] Instance awake, logged in as admin, `x_snc_ard` installed
- [ ] 3-5 broken workflows pre-created (missing owner, inactive approver, empty flow)
- [ ] CMDB at ~40% completeness (realistic demo)
- [ ] 5-10 KB articles with known gaps

## Demo Flow (7 min)

### Step 1: Dashboard & First Diagnostic (1.5 min)
**Click:** "Run Diagnostic" → progress bar → dashboard
**Say:** "In 90 seconds, we've analyzed 340 workflows, your CMDB, and knowledge base. Readiness Score: 62%. Green is good — red is what will break Otto."
**See:** 62% gauge, 23 critical issues, CMDB at 48% ⚠️

### Step 2: Workflow Health Deep-Dive (1.5 min)
**Click:** "Workflow Health" → sort by score
**Say:** "VPN Provisioning — score 38/100. 8 issues. Why? Missing owner, inactive approver who left the company 6 months ago, and it completes silently even when it fails. Otto would run this broken workflow 10x faster — same failures, more tickets."
**See:** Filtered list, red scores, issue details

### Step 3: CMDB Health (1 min)
**Click:** "CMDB Health" → per-class breakdown
**Say:** "Completeness at 48%. That means Otto can't find 52% of your assets. 'Reset Bob's laptop password' — Otto queries the CMDB, finds nothing, escalates to a human. AI value: zero."
**See:** Completeness bars, red "AI Impact: HIGH" flags

### Step 4: AI Simulator (1.5 min)
**Click:** "Simulate AI" → results
**Say:** "This is the money shot. We dry-ran Otto against all 340 workflows with your actual instance data. 182 PASS. 91 WARNING — Otto works but needs human help. 67 FAIL — Otto can't complete at all. Top failure: CI_NOT_FOUND, 34 workflows. Fix your CMDB, you fix 34 AI failures at once."
**See:** Pass/Warning/Fail bars, failure patterns ranked

### Step 5: Roadmap (1 min)
**Click:** "Generate Roadmap"
**Say:** "Here's your prioritized fix plan. 12 quick wins — fixes under 2 hours that unblock 20+ AI workflows. Phase 1: 30-day critical fixes. Phase 2: 90-day improvements. Total: ~180 hours. Compare that to a 12-month failed pilot."
**See:** 3-phase roadmap with effort estimates

### Step 6: Export & Next Steps (30 sec)
**Click:** "Export PDF"
**Say:** "One click — executive-ready report. Send this to your CIO. Then come back in 30 days, run the diagnostic again, and watch your readiness score climb. Questions?"

## "Oh Shit" Moments
| Problem | Response |
|---------|----------|
| Empty instance | Pre-create demo data — never scan a blank instance live |
| Scan takes >3 min | "Larger instances need a moment. We're analyzing every workflow and CI relationship." |
| Simulator shows all PASS | "Great news — your instance is ready! Let's talk about the Cost Optimizer to maximize ROI." |

## Post-Demo Q&A
- **"How is this different from AI Control Tower?"** → "Control Tower monitors AI AFTER deployment. We diagnose readiness BEFORE. Complementary tools."
- **"Our CMDB is a mess — we know that."** → "The diagnostic tells you WHICH parts are blocking AI, not just 'it's a mess.' Prioritized, actionable, quantified."
