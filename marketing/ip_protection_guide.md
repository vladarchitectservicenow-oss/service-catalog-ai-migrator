# IP Protection Guide — ServiceNow AI Migration Architect

## How to Protect Your Code: Legal and Technical Measures

You've open-sourced your project on GitHub and want to announce it on LinkedIn. The question: how do you prevent a developer from using your code for free for their client, or a company from copying it, tweaking a few lines, and passing it off as their own product?

The answer is a combination of legal protection (license) and technical measures (proof of authorship, immutable artifacts).

---

## 1. Legal Protection — Why AGPL-3.0

### What is AGPL-3.0

**GNU Affero General Public License v3.0** is the strongest copyleft license. Call it the "nuclear option" of open-source protection. Key differences from MIT/Apache/GPL:

| Scenario | MIT | GPL-3.0 | AGPL-3.0 |
|---|---|---|---|
| Someone forks and uses internally | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| Someone forks, changes 2 lines, sells as their SaaS | ✅ Allowed | ❌ Not allowed | ❌ Not allowed |
| Someone builds a SaaS on your code (users via web) | ✅ Allowed | ✅ Allowed (loophole!) | ❌ Not allowed |
| Someone forks — MUST open-source under same license | No | Yes (on distribution) | Yes (on ANY network use) |

### Why AGPL, Not Just GPL

GPL-3.0 only requires source disclosure upon **distribution**. If a company takes your code, runs it on their server, and sells it as SaaS — users interact via web, code is never distributed. This is the "GPL loophole."

**AGPL-3.0 closes this loophole**: if someone uses your code to provide services over a network (SaaS, web service), they MUST provide the source code to all users of that service. This makes covert commercial use impossible.

### What Your License Specifically Prohibits

The README and LICENSE state clearly:

- ❌ Prohibited from use in commercial products and SaaS without a paid license
- ❌ Prohibited from selling or distributing as part of proprietary software
- ⚠️ All derivative works MUST be open-sourced under AGPL-3.0
- ⚠️ Commercial use requires a separate paid license from you

### Protection Hierarchy

1. **AGPL-3.0** = baseline protection. Copying + commercial use without paid license = violation.
2. **Commercial license mention in README** = explicit notice. A company cannot claim "we didn't know."
3. **Copyright notice in every file** = proof of authorship.
4. **No CLA (Contributor License Agreement)** = nobody can relicense the project without you.

---

## 2. Technical Measures — Irreversible Proof of Authorship

Legal protection only works if you can prove the code is yours and was written before "they" copied it.

### GitHub as Evidence

- **Timestamped commits** — proof of creation time
- **Immutable Git history** — cannot be forged retroactively
- **LICENSE file in repo root** — from commit #1

### Strengthening: Distributed Timestamping

GitHub runs on a private server. Theoretically contestable. Additional measures:

1. **Anchor the repo hash in a blockchain** (e.g., via https://opentimestamps.org) — decentralized proof the code existed on a specific date. Free and immutable.

2. **Zenodo (CERN)** — upload your architecture description to Zenodo with a DOI. This provides a scientific timestamp and an independent third-party witness.

3. **Copyright registration** — in the US, register via copyright.gov ($45-65). Optional, but grants statutory damages (up to $150k) without proving actual harm.

### Watermarks in Code (Technical Fingerprint)

Don't plant obvious "easter eggs," but embed unique patterns that are hard to accidentally reproduce:

- Unique variable/class names in utility modules
- Specific JSON schema structures
- Unique IDs in test fixtures

If someone copies your code wholesale — these patterns remain and serve as evidence in a diff comparison.

---

## 3. What to Do If Your Code Is Stolen

### Scenario 1: A developer used your code for a client without a paid license

**Steps:**
1. Gather evidence: repo link, commit dates, code diff comparison
2. Send a formal notice to the violator's email demanding:
   - Cease and desist
   - Purchase a commercial license retroactively
3. If ignored — DMCA takedown via GitHub, complaint to their employer/client
4. Legal letter from an attorney demanding compensation

### Scenario 2: A company copied it, tweaked it, and claims it as their product

**Steps:**
1. Preserve evidence (product screenshots, Wayback Machine snapshots)
2. Perform forensic code analysis — find unique patterns from your code in their product
3. Send a formal legal notice via attorney:
   - AGPL-3.0 violation (did not open-source)
   - Copyright violation (did not credit authorship)
   - Demand compensation and cessation of use
4. If the company is large — rally community attention (Twitter/LinkedIn — "this company stole open-source code")
5. In parallel — DMCA takedown their repositories

### Scenario 3: A fork was made without attribution but complies with AGPL

**This is acceptable.** AGPL permits forks provided:
- Same license (AGPL-3.0)
- Copyright notice preserved
- Source code remains open

But if they sell it as SaaS — they must buy a paid license from you.

---

## 4. What Is NOT Protected

Honest answer — what the license does NOT cover:

- **The idea.** Someone can build an analog from scratch, inspired by your approach. This is legal.
- **The name.** Unless you register a trademark.
- **Design/architecture.** Software patents are slow, expensive, and don't always hold.
- **Small internal forks.** If someone forks and uses it internally — AGPL allows this (internal use). But if the company sells SaaS based on it — must buy a paid license.

---

## 5. Practical Checklist — What's Done and What to Add

### ✅ Done
- AGPL-3.0 LICENSE file in root
- License terms mentioned in README
- Commercial use requires paid license stated

### 🔧 Add to Code
- Copyright notice at the top of every .py file:
  ```python
  # Copyright (c) 2026 [Your Name]. All rights reserved.
  # Licensed under GNU AGPL-3.0. Commercial use requires a paid license.
  # See LICENSE file for details.
  ```
- `__init__.py` should contain version and copyright

### 🔧 Technical Measures
- Anchor repo hash via OpenTimestamps
- Upload description to Zenodo (get a DOI)
- Set up GitHub branch protection rules (prevent history rewriting)

### 🔧 For LinkedIn
- In your post: "Open source (AGPL-3.0) — commercial licensing available"
- This signals to serious companies: the code can be used legally via a paid license
- Small-time violators are deterred by AGPL terms

---

## 6. FAQ

**Q: If I'm the sole contributor to my project — do I lose any rights?**
A: No. You are the sole copyright holder (if you haven't accepted PRs from others). You can relicense at any time.

**Q: Should I accept outside PRs?**
A: Carefully. If you do — add a CLA (Contributor License Agreement) that transfers rights to you. Otherwise, every contributor becomes a co-owner of the copyright and can block relicensing.

**Q: Can ServiceNow itself copy my code?**
A: They could, BUT:
- Must comply with AGPL — open-source all derivatives
- Cannot build a proprietary product on it without a paid license from you
- Large companies are paranoid about open-source compliance — it's easier for them to buy a paid license or stay away

**Q: What if a client says "I'll just finish the fork myself"?**
A: Response: "You can, but then you must open-source under AGPL-3.0. And your fork won't receive updates from me without a paid license. A commercial license costs $X and includes support and updates."

---

*This guide was prepared based on intellectual property protection questions for open-source projects. AGPL-3.0 text: https://www.gnu.org/licenses/agpl-3.0.html*
