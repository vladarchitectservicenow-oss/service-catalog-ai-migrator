"""Training Plan generator — role-based curriculum for AI catalog adoption."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import AgentArchitecture, AnalysisResult


class UserTrainingGenerator:
    """Generate a role-based training plan for the AI-powered service catalog."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("training_plan.md.j2")

    def generate(
        self,
        analysis_result: AnalysisResult,
        agent_architectures: list[AgentArchitecture],
    ) -> str:
        """Render the training plan as markdown text.

        The template is fully self-contained with static curriculum content.
        We only inject instance-specific context.
        """
        discovery = analysis_result.discovery

        if not discovery.catalog_items:
            return (
                "# Training Plan\n\nNo catalog items discovered. "
                "Training plan cannot be generated without catalog context.\n"
            )

        return self._template.render(
            instance_url=discovery.instance_url,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        )
