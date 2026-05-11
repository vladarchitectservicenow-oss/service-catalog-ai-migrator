# Live Demo Script — Sandbox Migration Shield

> **Duration:** 8 minutes | **Instance:** dev362840.service-now.com

---

## Pre-Demo Setup

- [ ] Instance is awake and logged in as admin
- [ ] Scoped app `x_snc_sms` installed  
- [ ] 3-5 test scripts with KB2944435 incompatibilities created
- [ ] Dashboard widget added to homepage
- [ ] Browser cache cleared, incognito window ready

---

## Step 1: The Dashboard (1 min)

**Click:** Homepage → SMS Dashboard widget

**What you say:** "This is the Readiness Dashboard. Right now we're at 78% — meaning 78% of scripts are either compatible or already migrated. The red section — 4.4% — those are BLOCKING scripts that will be stopped by Phase 3. Let's fix one right now."

**What audience sees:** Score gauge, severity pie chart, "142 blocking" highlighted in red.

---

## Step 2: Drill Into Blocking Scripts (1 min)

**Click:** BLOCKING card → filtered list

**What you say:** "Here are all 142 blocking scripts — sorted by table, severity, and status. Let's pick one. 'closeTaskBR' — a business rule that uses Packages.java. Phase 3 will kill this. Let's migrate it."

**What audience sees:** Filterable table with 🔴 severity icons.

---

## Step 3: Preview Migration (1.5 min)

**Click:** closeTaskBR → Script Detail page

**What you say:** "On the left — the original code using `Packages.java.io.StringWriter`. That's blocked in Phase 3. On the right — our auto-generated Script Include that replaces the Java call with a safe GlideStringUtil equivalent. Notice we're in PREVIEW mode — nothing is saved yet."

**What audience sees:** Side-by-side: original code (blocked) vs generated Script Include (safe) + replacement call.

---

## Step 4: Execute Migration (30 sec)

**Click:** "Execute Migration" → confirm modal → "Yes"

**What you say:** "One click. Script Include created. Original business rule updated. Status changed to MIGRATED. Three seconds — versus 15 minutes rewriting this by hand."

**What audience sees:** Green toast: "Migration complete — rollback available."

---

## Step 5: Verify the Result (1 min)

**Click:** Back to dashboard

**What you say:** "Back on the dashboard — blocking count dropped from 142 to 141. Readiness score ticked up. Multiply this by 142 scripts — that's weeks of work saved. Now let me show you something even more powerful."

**What audience sees:** Dashboard refreshed, blocking count decremented.

---

## Step 6: Upgrade Impact Predictor (1 min)

**Click:** Settings → Upgrade Predictor

**What you say:** "Here's the secret weapon. Before you apply ANY patch or upgrade, this tells you exactly which new scripts would be flagged. 'If you upgrade to Australia Patch 2 today, 23 new scripts would be blocked.' You can plan your migration BEFORE the upgrade — not scramble after."

**What audience sees:** Prediction card: "23 new scripts would be flagged" with list.

---

## Step 7: Exemption Registry (1 min)

**Click:** Exemptions → Create New

**What you say:** "Not every script can be migrated. This legacy integration uses a third-party Java library — no JS equivalent. So we exempt it WITH documentation: business justification, approver, expiration date. Full audit trail. Annual review reminder. Your auditors will love you."

**What audience sees:** Exemption form with approval workflow visualization.

---

## "Oh Shit" Moments

| If this breaks... | Do this... |
|-------------------|------------|
| Instance hibernates | "ServiceNow PDIs sleep after 10 days — this is expected. The app works the same on production instances." |
| Scan takes >2 min | "Larger instances can take a moment — we're scanning thousands of scripts. The enterprise tier handles up to 10K scripts in under 3 minutes." |
| Migration preview shows wrong code | "That's why preview mode exists. Click Cancel, flag it for manual review. Not every script can be auto-migrated — we handle about 85% automatically." |
| Dashboard shows 0% | "Empty instance — no scripts to scan. Let me create a demo script with a known incompatibility..." (pre-create these!) |

---

## Post-Demo Q&A Prep

### Q1: "What about our custom scripts that use proprietary logic?"
**A:** "Preview mode shows exactly what the migration will produce before committing. If the generated code doesn't match your logic, you can:
- Adjust the migration manually (we show you the diff)
- Flag it for manual review by your dev team
- Exempt it with documentation if migration isn't feasible"

### Q2: "Does this work on Zurich? We're not upgrading yet."
**A:** "Yes — it works on Zurich, Xanadu, Yokohama, and Australia. In fact, scanning BEFORE you upgrade is the best practice. The Upgrade Impact Predictor is specifically designed for pre-upgrade planning."

### Q3: "What happens if ServiceNow releases their own migration tool?"
**A:** "Two things: First, they haven't — and Phase 3 is coming regardless. Second, even if they do, our Exemption Registry, Rollback, and Upgrade Predictor go beyond what any basic scanner would offer. We're building the COMPLIANCE layer, not just the scanner."

### Q4: "Is this secure? You're creating Script Includes programmatically."
**A:** "All migrations happen within the scoped application context. We never access cross-scope tables without explicit API authorization. Every migration is logged with full audit trail. And rollback is always one click away."

---

## Key Screenshots to Capture

1. Dashboard with 78% readiness score (hero shot)
2. Script detail with side-by-side preview
3. Successful migration toast notification
4. Upgrade Impact Predictor card
5. Exemption form with approval chain
6. Audit log showing full traceability

---

## After the Demo

- [ ] Send follow-up email with screenshot of their readiness score
- [ ] Offer free scan of their production instance (read-only, no changes)
- [ ] Share [GitHub repo](https://github.com/vladarchitectservicenow-oss/servicenow-sandbox-migration-shield) for technical evaluation
- [ ] Schedule technical deep-dive with their dev team within 48 hours
