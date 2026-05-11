# Live Demo Script — Workflow Cost Optimizer

## Pre-Demo Setup
- [ ] Instance awake, logged in as admin, `x_snc_wco` installed
- [ ] 5-10 catalog items with varied channel patterns pre-profiled
- [ ] Pricing models seeded for Now Assist ($15/transaction), Moveworks ($9/transaction), Slack AI ($7/transaction)

## Demo Flow (7 min)

### Step 1: Scan & Dashboard (1.5 min)
**Click:** "Run Workflow Scan" → profiles complete → dashboard
**Say:** "127 workflows profiled. Current annual AI spend if everything runs on Now Assist: $216,000. Now watch what happens when we optimize."
**See:** Dashboard with $216K current spend, tiered platform costs

### Step 2: Cost Comparison Deep-Dive (1.5 min)
**Click:** "Password Reset" workflow
**Say:** "450 requests/month, 65% come through Slack. Now Assist: $5.20/ticket. Slack AI: $3.00/ticket. Annual difference: $11,880 — on ONE workflow. Multiply by 72 Slack-native workflows..."
**See:** Comparison table with cost-per-ticket for each platform, best option highlighted

### Step 3: Compliance Auto-Check (1 min)
**Click:** "VPN Access" workflow
**Say:** "This one requires GDPR compliance. Slack AI doesn't have it. So despite being cheaper, it's flagged — compliance violation. The Optimal Routing Engine handles these constraints automatically."
**See:** 🚫 icon on non-compliant platforms, green check on compliant ones

### Step 4: Optimal Routing (1.5 min)
**Click:** "Optimize Routing"
**Say:** "Here's the map. 45 compliance-heavy workflows stay on Now Assist. 72 simple, high-volume Slack-native workflows go to Slack AI. 10 remain manual. New annual spend: $151,000. That's $65,000 saved — 30% reduction."
**See:** 3-tier routing map with cost breakdown per tier

### Step 5: Budget Mode (1 min)
**Click:** Budget → enter $80,000 → re-optimize
**Say:** "What if you only have $80K? The engine reprioritizes — keeps highest-impact workflows, drops the rest. 92% coverage within budget. You know exactly what you're trading off."
**See:** Coverage chart with budget slider, "92% coverage at $80K"

### Step 6: ROI Projection & Export (30 sec)
**Click:** "ROI" → "Export PDF"
**Say:** "3-year projection. Month 3 break-even. Cumulative savings: $165K by Year 3. One click — board-ready report. Questions?"

## "Oh Shit" Moments
| Problem | Response |
|---------|----------|
| No pricing data | Pre-seed pricing models — never demo without them |
| All workflows same platform | "This instance is homogenous — typical for smaller deployments. Let me show a pre-built comparison dataset." |
| Budget constraint too low | "The engine shows minimum viable budget: $50K to cover essential workflows." |

## Post-Demo Q&A
- **"Where do the pricing numbers come from?"** → "Seeded from public vendor pricing + configurable. We update quarterly. You can adjust anytime."
- **"What about Microsoft Teams AI?"** → "Teams AI is a supported platform. Same comparison methodology. We're platform-agnostic."
- **"Does this actually save money or just move it around?"** → "Real savings. You're routing low-complexity, high-volume workflows to lower-cost platforms while keeping compliance-critical ones on Now Assist."
