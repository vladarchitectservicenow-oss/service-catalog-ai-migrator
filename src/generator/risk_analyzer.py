"""Risk Register generator — identifies and scores migration risks."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import AnalysisResult, MigrationRoadmap, Risk, RiskRegister


class RiskAnalyzer:
    """Analyze migration risks and produce a rated risk register."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("risk_register.md.j2")

    def analyze(
        self,
        analysis_result: AnalysisResult,
        roadmap: MigrationRoadmap,
    ) -> RiskRegister:
        """Generate a risk register tailored to the analysis results and roadmap."""
        risks = self._generate_risks(analysis_result, roadmap)

        # Compute risk_score = likelihood × impact for each risk
        for risk in risks:
            risk.risk_score = risk.likelihood * risk.impact

        # Summary
        high_count = sum(1 for r in risks if r.risk_score >= 15)
        med_count = sum(1 for r in risks if 6 <= r.risk_score < 15)
        low_count = sum(1 for r in risks if r.risk_score < 6)

        summary = (
            f"Identified {len(risks)} risks: "
            f"{high_count} high (score ≥ 15), "
            f"{med_count} medium (6-14), "
            f"{low_count} low (< 6). "
            f"Top category: {self._top_category(risks)}."
        )

        return RiskRegister(risks=risks, summary=summary)

    def render(self, register: RiskRegister, analysis_result: AnalysisResult) -> str:
        """Render the risk register as markdown text."""
        # Category summary
        cat_map: dict[str, list[int]] = {}
        for r in register.risks:
            cat_map.setdefault(r.category, []).append(r.risk_score)
        category_summary = [
            {"category": cat, "count": len(scores), "avg_score": sum(scores) / len(scores)}
            for cat, scores in cat_map.items()
        ]

        # Top risks (score ≥ 12)
        top = sorted(register.risks, key=lambda r: r.risk_score, reverse=True)[:5]

        return self._template.render(
            instance_url=analysis_result.discovery.instance_url,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            summary=register.summary,
            risks=[r.model_dump() for r in register.risks],
            category_summary=category_summary,
            top_risks=[r.model_dump() for r in top],
        )

    # ------------------------------------------------------------------
    # Risk generation
    # ------------------------------------------------------------------

    def _generate_risks(self, analysis_result, roadmap) -> list[Risk]:
        """Build a curated list of 8-12 risks."""
        discovery = analysis_result.discovery

        risks: list[Risk] = [
            Risk(
                id="R01",
                category="technical",
                description="API rate limits restrict agent throughput during peak load",
                likelihood=3,
                impact=4,
                mitigation="Implement request batching, caching, and exponential backoff. "
                           "Negotiate higher rate limits with ServiceNow.",
                detection="Monitor API response headers for rate-limit counters. Alert at 80% threshold.",
                owner="Integration Architect",
            ),
            Risk(
                id="R02",
                category="security",
                description="Authentication token expiration causes agent failures",
                likelihood=3,
                impact=4,
                mitigation="Implement OAuth2 with automated refresh. Store tokens in secure vault. "
                           "Proactive refresh 5 minutes before expiry.",
                detection="Health check endpoint monitors token validity. Alert on auth failures.",
                owner="Security Officer",
            ),
            Risk(
                id="R03",
                category="technical",
                description="Agent hallucination produces incorrect fulfillment actions",
                likelihood=2,
                impact=5,
                mitigation="Constrained agent outputs with structured schemas. Human-in-the-loop "
                           "for all provisioning decisions. Guardrails on action parameters.",
                detection="Diff agent output against expected schema. Anomaly detection on actions.",
                owner="AI/ML Engineer",
            ),
            Risk(
                id="R04",
                category="operational",
                description="SLA degradation during migration due to parallel-run overhead",
                likelihood=3,
                impact=3,
                mitigation="Staged rollout with 2-week parallel run windows. Automated SLA monitoring "
                           "with auto-rollback triggers.",
                detection="Real-time SLA dashboard. Alert if SLA drops below 5% of baseline.",
                owner="Service Manager",
            ),
            Risk(
                id="R05",
                category="organizational",
                description="User resistance and low adoption of agent-driven catalog",
                likelihood=4,
                impact=3,
                mitigation="Early engagement with champions. Demonstrate Quick Wins. Comprehensive "
                           "training program before full rollout. Maintain portal access as fallback.",
                detection="User satisfaction surveys. Adoption metrics (agent vs portal usage).",
                owner="Change Manager",
            ),
            Risk(
                id="R06",
                category="organizational",
                description="Skill gaps — team lacks AI/agent operations expertise",
                likelihood=3,
                impact=3,
                mitigation="Hire or contract AI ops specialist. Training program for existing admins. "
                           "Vendor support agreement for first 6 months.",
                detection="Incident response time metrics. Knowledge check assessments.",
                owner="Engineering Manager",
            ),
            Risk(
                id="R07",
                category="data",
                description="Incomplete or stale catalog items cause incorrect agent behavior",
                likelihood=3,
                impact=4,
                mitigation="Pre-migration catalog audit and cleanup. Automated validation rules. "
                           "Agent confirms item validity before action.",
                detection="Catalog health dashboard. Item staleness alerts (> 90 days without update).",
                owner="ServiceNow Admin",
            ),
            Risk(
                id="R08",
                category="security",
                description="Audit trail gaps — agent decisions not fully logged",
                likelihood=2,
                impact=5,
                mitigation="Structured logging of every agent decision with rationale. Immutable audit log. "
                           "Regular compliance audits.",
                detection="Automated audit log completeness checks. Gap alerts.",
                owner="Security Officer",
            ),
            Risk(
                id="R09",
                category="technical",
                description="LLM inference latency exceeds SLA thresholds under load",
                likelihood=3,
                impact=3,
                mitigation="Deploy LLM with autoscaling. Cache common responses. Circuit breaker for "
                           "non-critical decisions. Local fallback model.",
                detection="Latency percentiles (p50, p95, p99) dashboard. Alert on p95 > 5s.",
                owner="Platform Engineer",
            ),
            Risk(
                id="R10",
                category="operational",
                description="Integration failures cascade across agent fleet",
                likelihood=2,
                impact=4,
                mitigation="Circuit breakers per integration. Bulkhead pattern — isolate agent groups. "
                           "Graceful degradation (queue requests, retry later).",
                detection="Integration health endpoint polling. Dependency graph alerting.",
                owner="SRE Lead",
            ),
        ]

        # Add conditional risks based on analysis
        if discovery.integrations:
            risks.append(
                Risk(
                    id="R11",
                    category="data",
                    description="Data migration errors when syncing catalog state to agent context store",
                    likelihood=4,
                    impact=2,
                    mitigation="Incremental sync with checksum validation. Dry-run before cutover. "
                               "Reconciliation reports.",
                    detection="Data integrity checks. Row-count comparisons between source and target.",
                    owner="Data Engineer",
                )
            )

        if len(analysis_result.bottlenecks) > 0:
            severity_count = sum(1 for b in analysis_result.bottlenecks if b.severity in ("critical", "high"))
            if severity_count > 0:
                risks.append(
                    Risk(
                        id="R12",
                        category="operational",
                        description=f"Existing {severity_count} critical/high bottlenecks remain unresolved "
                                    f"during migration, compounding agent handoff delays",
                        likelihood=3,
                        impact=4,
                        mitigation="Prioritize bottleneck resolution in Phase 0. Agent design accounts for "
                                   "known bottlenecks with timeout handling.",
                        detection="Bottleneck tracking dashboard. Agent escalation rate monitoring.",
                        owner="Process Owner",
                    )
                )

        # Trim to 12 max
        return risks[:12]

    @staticmethod
    def _top_category(risks: list[Risk]) -> str:
        from collections import Counter
        cnt = Counter(r.category for r in risks)
        return cnt.most_common(1)[0][0]
