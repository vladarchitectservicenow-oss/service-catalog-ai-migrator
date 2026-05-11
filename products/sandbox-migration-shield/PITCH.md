# 5-Minute Pitch — Sandbox Migration Shield

> **For:** CTOs, Platform Owners, ServiceNow Practice Leads  
> **Goal:** Secure pilot commitment or purchase order

---

## Minute 0–1: The Hook 🪝

**"Your ServiceNow instance has a ticking time bomb. And ServiceNow didn't give you a way to defuse it."**

KB2944435 — the server-side JavaScript sandbox replacement — is rolling out NOW. Phase 1: notification. Phase 2: mandatory review. Phase 3: **your scripts get BLOCKED**.

7,700 enterprise customers. 500 to 5,000 scripts each. **Zero built-in migration tools.**

I'm going to show you how to go from panic to compliance in under 10 minutes.

---

## Minute 1–2: The Pain 🤕

> *"This is going to break a lot of stuff for no real reason."* — 306 upvotes on Reddit

Here's what your team is facing right now:
- Manually reviewing scripts across 6 different tables — sys_script, sys_script_include, UI policies, dictionary defaults, business rules, client scripts
- Spending 15–45 minutes per script rewriting inline logic
- No audit trail for scripts that can't be migrated — SOX/HIPAA compliance risk
- Every patch and hotfix introduces NEW scripts to review

This is a 200–500 hour problem. Per instance. And the clock is ticking.

---

## Minute 2–3: The Solution 🛠️

Sandbox Migration Shield — a ServiceNow scoped app (`x_snc_sms`) that does four things:

1. **Scans everything** — 6 tables, all scripts, 2 minutes. Knows exactly which scripts will be blocked and why.
2. **Migrates with one click** — extracts inline JavaScript, creates a secure Script Include, previews the result before committing.
3. **Documents exemptions** — full business justification, approval workflow, annual review reminders. Audit-ready.
4. **Predicts upgrade impact** — before you apply a patch, you see exactly which NEW scripts would break.

*[Optional: Live demo — log into dev362840, click "Run Scan", show dashboard with 78% readiness score, migrate one script in 3 clicks]*

---

## Minute 3–4: The Market 📊

**TAM:** $200–400M. 7,700 enterprise customers × $25K average.

**Timing:** 
- Phase 3 enforcement window: 3–6 months
- Z Patch 9: this week
- Australia release: accelerating sandbox changes

**Competition:** None. ServiceNow built no migration tool. Consulting firms charge $200K+ for manual work. We're first to market with an automated solution.

**Why us:** Deep ServiceNow expertise. Already validated against real PDI (dev362840). Community demand is exploding — the Reddit thread has 306 upvotes and 71 comments.

---

## Minute 4–5: The Ask 💰

We're offering three tiers:

| Tier | Price | Target |
|------|-------|--------|
| Starter | $15K/yr | <1,000 scripts |
| Professional | $35K/yr | <5,000 scripts |
| Enterprise | $45K/yr | Unlimited + managed migration |

**What I need from you:**
- Pilot on ONE instance (we'll scan it live, 2 minutes)
- If it finds value → purchase Professional tier
- If it doesn't → you owe nothing

**Questions?**
