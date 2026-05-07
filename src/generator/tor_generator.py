"""Terms of Reference generator — produces a project charter / TOR document."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import AnalysisResult


class TorGenerator:
    """Generate Terms of Reference markdown from analysis results."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("tor.md.j2")

    def generate(self, analysis_result: AnalysisResult) -> str:
        """Render the TOR document as markdown text."""
        discovery = analysis_result.discovery

        # Build bottleneck summary
        bottlenecks = [
            {
                "workflow_name": b.workflow_name,
                "bottleneck_type": b.bottleneck_type,
                "severity": b.severity,
                "affected_requests": b.affected_requests,
            }
            for b in analysis_result.bottlenecks
        ]

        # Calculate total manual steps from health analysis
        total_manual_steps = sum(wf.manual_step_count for wf in analysis_result.workflow_health)

        # Compute aggregate metrics from history
        history = discovery.history
        sla_compliant = len([h for h in history if h.sla_breaches == 0])
        avg_sla_compliance = (sla_compliant / len(history) * 100) if history else None
        avg_fulfillment = (
            sum(h.avg_fulfillment_hours for h in history if h.avg_fulfillment_hours is not None) / len(history)
            if history else None
        )

        if not discovery.catalog_items and not discovery.workflows:
            return "# Terms of Reference\n\nNo catalog items or workflows discovered.  Cannot generate TOR."

        return self._template.render(
            instance_url=discovery.instance_url,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            total_items=len(discovery.catalog_items),
            total_workflows=len(discovery.workflows),
            total_scripts=len(discovery.script_includes),
            total_business_rules=len(discovery.business_rules),
            total_integrations=len(discovery.integrations),
            total_history=len(history),
            bottlenecks=bottlenecks,
            total_manual_steps=total_manual_steps,
            avg_sla_compliance=avg_sla_compliance,
            avg_fulfillment_hours=avg_fulfillment,
        )
