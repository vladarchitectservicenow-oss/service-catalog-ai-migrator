# Sandbox Migration Shield

> **Tagline:** Don't let KB2944435 break your instance. Scan, migrate, and secure your server-side JavaScript — before ServiceNow blocks it.

## Elevator Pitch

ServiceNow KB2944435 is replacing the server-side JavaScript sandbox. Phase 3 will **block incompatible scripts** with no built-in migration tool. Sandbox Migration Shield automatically scans your entire instance, migrates inline logic to secure Script Includes, and provides an audit-ready exemption registry — turning months of manual panic into a one-click operation.

## Ideal Customer Profile (ICP)

- **Company size:** Enterprise (2,000+ employees)
- **Industry:** Any with significant ServiceNow footprint (financial services, healthcare, government, tech)
- **ServiceNow footprint:** Zurich, Xanadu, or Yokohama instances planning upgrade to Australia release
- **Key personas:** Platform Owner, ServiceNow Administrator, CIS-certified Architect, Upgrade Manager
- **Pain level:** High/urgent — KB2944435 Phase 3 enforcement is imminent

## Value Proposition

| Before | After |
|--------|-------|
| Manual script-by-script review across 5+ tables | Automated scan — 100% coverage in minutes |
| No way to know which scripts will be blocked before upgrade | Upgrade Impact Predictor shows blocking surface BEFORE you upgrade |
| Rewriting inline logic by hand, risking regressions | One-click migration extracts logic into Script Includes safely |
| No audit trail for exempted scripts — compliance risk | Exemption Registry with full business justification and approval chain |
| Panic during every patch/hotfix | Dashboard shows readiness score — always know where you stand |

### Quantified Impact

- **Time saved:** 200-500 engineering hours per instance (based on 1,000+ scripts)
- **Risk reduction:** Eliminates unplanned downtime from blocked scripts (avg cost: $50K-150K/hour for enterprise)
- **Compliance:** Full audit trail satisfies SOX, HIPAA, and internal audit requirements

## Competitive Landscape

| Competitor | Status | Why We Win |
|-----------|--------|------------|
| ServiceNow (built-in) | **Nothing provided** — KB2944435 has no migration tool | We are the only solution |
| Manual review (status quo) | Current approach | 10-20x faster, zero human error |
| Consulting firms (Deloitte, Accenture) | Offer manual migration services at $200K+ | Automated + repeatable at 1/10th cost |

## Monetization

- **Subscription:** $15,000–$45,000/year per instance (tiered by script count)
- **Managed migration service (upsell):** $50,000–$150,000 one-time for complex instances
- **TAM:** ~$200–400M (7,700 enterprise customers × $25K avg)

## Quick Links

- [PRD.md](./PRD.md) — Full Product Requirements Document
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Technical Architecture
- [SPEC.md](./SPEC.md) — Detailed Technical Specification
- [DESIGN.md](./DESIGN.md) — UI/UX Design
