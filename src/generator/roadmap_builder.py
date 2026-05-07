"""Migration Roadmap builder — phased rollout plan with prioritization."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import (
    AgentArchitecture,
    AnalysisResult,
    MigrationPhase,
    MigrationRoadmap,
)


class RoadmapBuilder:
    """Build a phased migration roadmap prioritized by readiness × volume."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("migration_plan.md.j2")

    def build(
        self,
        analysis_result: AnalysisResult,
        agent_architectures: list[AgentArchitecture],
    ) -> MigrationRoadmap:
        """Produce a MigrationRoadmap with phased rollout."""
        discovery = analysis_result.discovery

        if not analysis_result.workflow_health:
            return MigrationRoadmap(
                phases=[],
                total_duration_weeks=0,
                parallel_run_strategy="No workflows available for migration planning.",
            )

        # Sort workflows by readiness (high first) × request volume (most first)
        scored = self._score_workflows(analysis_result, agent_architectures)
        scored.sort(key=lambda x: x["sort_key"], reverse=True)

        high = [s for s in scored if s["readiness"] == "high"]
        medium = [s for s in scored if s["readiness"] == "medium"]
        low = [s for s in scored if s["readiness"] == "low"]

        phases: list[MigrationPhase] = []
        offset = 0

        # Phase 0: Foundation
        phases.append(MigrationPhase(
            name="Phase 0: Foundation",
            duration_weeks=2,
            description="Establish API access, monitoring dashboard, credential management, "
                        "and deploy agent runtime infrastructure.",
            workflows_included=[],
            success_criteria=[
                "API connectivity verified for all target endpoints",
                "Monitoring dashboard live with real-time metrics",
                "Agent runtime deployed and passing health checks",
                "Credential vault configured with automated rotation",
            ],
            rollback_plan="Disable agent runtime; revert to manual catalog. No impact on production.",
        ))
        offset += 2

        # Phase 1: Quick Wins (high readiness)
        qw_workflows = [s["name"] for s in high[:max(3, len(high))]]
        phases.append(MigrationPhase(
            name="Phase 1: Quick Wins",
            duration_weeks=4,
            description="Migrate high-readiness, high-volume workflows to demonstrate value "
                        "and build organizational confidence.",
            workflows_included=qw_workflows,
            success_criteria=[
                f"All {len(qw_workflows)} workflows operational under agent control",
                "Zero SLA regressions compared to baseline",
                "User satisfaction survey score ≥ 4.0/5.0",
                "Agent automation rate ≥ 70% for target workflows",
            ],
            rollback_plan="Per-workflow toggle to revert to manual fulfillment. Parallel run for 2 weeks before cutover.",
        ))
        offset += 4

        # Phase 2: Core Migration (medium readiness + remaining high)
        remaining_high = [s["name"] for s in high if s["name"] not in qw_workflows]
        core_workflows = remaining_high + [s["name"] for s in medium[:max(5, len(medium))]]
        phases.append(MigrationPhase(
            name="Phase 2: Core Migration",
            duration_weeks=8,
            description="Migrate medium-readiness workflows and remaining high-readiness items. "
                        "This phase covers the bulk of catalog volume.",
            workflows_included=core_workflows,
            success_criteria=[
                f"All {len(core_workflows)} workflows migrated and stable",
                "Overall SLA compliance ≥ 95%",
                "Agent automation rate ≥ 80% across migrated workflows",
                "No P1 incidents caused by agent decisions",
            ],
            rollback_plan="Workflow-level rollback available within 1 hour. Full phase rollback requires CAB approval.",
        ))
        offset += 8

        # Phase 3: Advanced (low readiness / complex)
        adv_workflows = [s["name"] for s in low[:max(3, len(low))]]
        phases.append(MigrationPhase(
            name="Phase 3: Advanced Workflows",
            duration_weeks=6,
            description="Tackle complex, low-readiness workflows with heavy human-in-the-loop "
                        "requirements and multi-step integrations.",
            workflows_included=adv_workflows if adv_workflows else ["(No low-readiness workflows identified)"],
            success_criteria=[
                f"All {len(adv_workflows) if adv_workflows else 0} complex workflows operational",
                "Human-in-the-loop checkpoints validated",
                "Escalation paths tested and confirmed",
                "All edge cases documented and handled",
            ],
            rollback_plan="Extended parallel run (4 weeks). Staged cutover with human oversight on every decision.",
        ))
        offset += 6

        # Phase 4: Optimization
        phases.append(MigrationPhase(
            name="Phase 4: Continuous Optimization",
            duration_weeks=0,  # ongoing
            description="Monitor agent performance, tune policies, expand coverage, "
                        "and incorporate user feedback into continuous improvement.",
            workflows_included=["All migrated workflows"],
            success_criteria=[
                "Agent automation rate ≥ 90%",
                "SLA compliance ≥ 99%",
                "Mean time to fulfill reduced by 50% from baseline",
                "Quarterly review cycle established",
            ],
            rollback_plan="Not applicable — optimization phase operates on stable agent fleet.",
        ))

        total_weeks = 2 + 4 + 8 + 6  # Phases 0-3 (Phase 4 ongoing)

        return MigrationRoadmap(
            phases=phases,
            total_duration_weeks=total_weeks,
            parallel_run_strategy=(
                "Each phase runs a 2-week parallel run where agents shadow human operators. "
                "Cutover occurs after success criteria are validated. "
                "Phases 1-3 may overlap by up to 2 weeks for resource smoothing."
            ),
        )

    def render(self, roadmap: MigrationRoadmap, analysis_result: AnalysisResult) -> str:
        """Render the migration plan as markdown text."""
        phases_for_template = []
        offset = 0
        for phase in roadmap.phases:
            key_deliverable = self._key_deliverable(phase)
            phases_for_template.append({
                "name": phase.name,
                "duration_weeks": phase.duration_weeks if phase.duration_weeks > 0 else "Ongoing",
                "description": phase.description,
                "workflows_included": phase.workflows_included,
                "success_criteria": phase.success_criteria,
                "rollback_plan": phase.rollback_plan,
                "start_offset": offset if phase.duration_weeks > 0 else "N/A",
                "key_deliverable": key_deliverable,
            })
            if phase.duration_weeks > 0:
                offset += phase.duration_weeks

        return self._template.render(
            instance_url=analysis_result.discovery.instance_url,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            total_duration_weeks=roadmap.total_duration_weeks,
            parallel_run_strategy=roadmap.parallel_run_strategy,
            phases=phases_for_template,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _score_workflows(self, analysis_result, agent_architectures) -> list[dict]:
        """Score workflows: readiness priority × request volume."""
        arch_map = {a.workflow_sys_id: a for a in agent_architectures}
        scored = []
        for wf in analysis_result.workflow_health:
            # Estimate request volume from history
            total_reqs = 0
            for h in analysis_result.discovery.history:
                if h.catalog_item_name and wf.workflow_name.lower() in h.catalog_item_name.lower():
                    total_reqs += h.total_requests
            # If no direct match, use workflow health position as rough proxy
            if total_reqs == 0:
                total_reqs = len(analysis_result.discovery.catalog_items) // max(1, len(analysis_result.workflow_health))

            readiness_order = {"high": 3, "medium": 2, "low": 1}
            sort_key = readiness_order.get(wf.automation_readiness, 0) * 1000 + total_reqs

            scored.append({
                "name": wf.workflow_name,
                "sys_id": wf.workflow_sys_id,
                "readiness": wf.automation_readiness,
                "total_requests": total_reqs,
                "sort_key": sort_key,
            })
        return scored

    @staticmethod
    def _key_deliverable(phase: MigrationPhase) -> str:
        if "Foundation" in phase.name:
            return "Agent runtime + monitoring"
        if "Quick" in phase.name:
            return "Demonstrated value + user confidence"
        if "Core" in phase.name:
            return "Bulk catalog migrated"
        if "Advanced" in phase.name:
            return "Complex workflows operational"
        return "Performance dashboard + improvement backlog"
