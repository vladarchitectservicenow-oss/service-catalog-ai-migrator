"""Technical Specification generator — current vs target architecture with Mermaid diagrams."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import AnalysisResult


class SpecGenerator:
    """Generate Technical Specification markdown from analysis results."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("spec.md.j2")

    def generate(self, analysis_result: AnalysisResult) -> str:
        """Render the Technical Specification as markdown text."""
        discovery = analysis_result.discovery

        if not discovery.catalog_items and not discovery.workflows:
            return "# Technical Specification\n\nNo catalog items or workflows discovered. Cannot generate specification."

        return self._template.render(
            instance_url=discovery.instance_url,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            current_architecture_diagram=self._build_current_diagram(discovery, analysis_result),
            target_architecture_diagram=self._build_target_diagram(analysis_result),
            catalog_items=[
                {
                    "name": item.name,
                    "category": item.category,
                    "active": item.active,
                    "request_count": item.request_count,
                    "approval_required": item.approval_required,
                }
                for item in discovery.catalog_items
            ],
            workflow_analyses=[
                {
                    "workflow_sys_id": wf.workflow_sys_id,
                    "workflow_name": wf.workflow_name,
                    "health_score": wf.health_score,
                    "automation_readiness": wf.automation_readiness,
                    "activity_count": wf.activity_count,
                    "manual_step_count": wf.manual_step_count,
                    "approval_count": wf.approval_count,
                    "timer_count": wf.timer_count,
                    "complexity_score": wf.complexity_score,
                    "recommended_agents": wf.recommended_agents,
                    "specific_steps_to_automate": wf.specific_steps_to_automate,
                }
                for wf in analysis_result.workflow_health
            ],
            integrations=[
                {
                    "name": integ.name,
                    "endpoint": integ.endpoint,
                    "http_method": integ.http_method,
                    "active": integ.active,
                }
                for integ in discovery.integrations
            ],
        )

    # ------------------------------------------------------------------
    # Mermaid diagram builders
    # ------------------------------------------------------------------

    def _build_current_diagram(self, discovery, analysis_result) -> str:
        lines = ["graph TD"]
        lines.append("    User[End User] -->|Submit Request| Portal[ServiceNow Portal]")

        for i, wf in enumerate(analysis_result.workflow_health[:8]):  # limit for readability
            safe_name = wf.workflow_name.replace(" ", "_").replace("-", "_")
            lines.append(f"    Portal --> WF{i}_{safe_name}[{wf.workflow_name}]")
            lines.append(f"    WF{i}_{safe_name} -->|{wf.manual_step_count} manual steps| Fulfillment{i}[Fulfillment]")

        if discovery.integrations:
            lines.append("    Fulfillment0 --> Integrations[External Integrations]")
        lines.append("    Fulfillment0 --> Done[Request Complete]")
        return "\n".join(lines)

    def _build_target_diagram(self, analysis_result) -> str:
        lines = ["graph TD"]
        lines.append("    User[End User] -->|Chat / Portal| Orch[Orchestrator Agent]")

        roles_drawn: set[str] = set()
        for wf in analysis_result.workflow_health:
            for agent in wf.recommended_agents:
                if agent not in roles_drawn:
                    safe = agent.replace("-", "_").replace(" ", "_")
                    lines.append(f"    Orch --> {safe}[{agent}]")
                    roles_drawn.add(agent)

        if "approval-agent" in roles_drawn:
            lines.append("    approval_agent -->|Auto-Approved| provisioning_agent")
            lines.append("    approval_agent -->|Needs Review| HumanApprover[Human Approver]")

        lines.append("    provisioning_agent --> Done[Request Fulfilled]")
        lines.append("    Orch -->|Unknown/Error| Escalation[Escalation Agent]")
        lines.append("    Escalation --> HumanSupport[Human Support]")

        return "\n".join(lines)
