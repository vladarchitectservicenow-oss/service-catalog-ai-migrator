"""AI Agent Architecture designer — maps workflows to agent topologies."""

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from src.models import AgentArchitecture, AgentDefinition, AnalysisResult


class AgentDesigner:
    """Design agent architectures for each workflow."""

    def __init__(self, template_dir: str | None = None) -> None:
        if template_dir is None:
            template_dir = str(Path(__file__).resolve().parent.parent / "templates")
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=False)
        self._template = self._env.get_template("agent_arch.md.j2")

    def design(self, analysis_result: AnalysisResult) -> tuple[list[AgentArchitecture], dict[str, str]]:
        """Create agent architectures and render markdown per workflow.

        Returns:
            (list_of_architectures, dict_of_{workflow_sys_id: markdown_text})
        """
        architectures: list[AgentArchitecture] = []
        docs: dict[str, str] = {}

        for wf in analysis_result.workflow_health:
            arch = self._build_architecture(wf, analysis_result)
            architectures.append(arch)

            # Build Mermaid topology diagram
            topology = self._build_topology(arch)

            # Count integration points from discovery
            integration_count = len(
                [i for i in analysis_result.discovery.integrations
                 if i.active]
            )
            human_touchpoints = sum(
                1 for a in arch.agents for _ in a.human_in_the_loop
            )

            doc = self._template.render(
                workflow_name=arch.workflow_name,
                workflow_sys_id=arch.workflow_sys_id,
                generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                health_score=wf.health_score,
                automation_readiness=wf.automation_readiness,
                complexity_score=wf.complexity_score,
                topology=topology,
                agents=[a.model_dump() for a in arch.agents],
                communication_pattern=arch.communication_pattern,
                estimated_complexity=arch.estimated_complexity,
                integration_count=integration_count,
                human_touchpoints=human_touchpoints,
            )
            docs[arch.workflow_sys_id] = doc

        return architectures, docs

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_architecture(self, wf, analysis_result) -> AgentArchitecture:
        """Determine agents, pattern, complexity for one workflow."""
        readiness = wf.automation_readiness.lower()
        complexity = wf.complexity_score

        agents: list[AgentDefinition] = []

        # Orchestrator is always present
        agents.append(
            AgentDefinition(
                name=f"{wf.workflow_name} Orchestrator",
                role="orchestrator",
                description=f"Receives and triages requests for {wf.workflow_name}. "
                            f"Routes to specialist agents based on request type.",
                tools=["catalog_api", "nlp_interface", "request_create"],
                triggers=["on_new_request", "on_status_change"],
                human_in_the_loop=[],
                fallback_behavior="escalate_to_human",
            )
        )

        # Approval agent when workflow has approvals
        if wf.approval_count > 0:
            agents.append(
                AgentDefinition(
                    name=f"{wf.workflow_name} Approval Agent",
                    role="approval-agent",
                    description="Evaluates requests against approval policies and "
                                "auto-approves low-risk submissions or routes to human approvers.",
                    tools=["policy_engine", "cmdb_lookup", "risk_scorer"],
                    triggers=["on_approval_required"],
                    human_in_the_loop=["high_risk_items", "above_cost_threshold", "security_requests"],
                    fallback_behavior="escalate_to_human",
                )
            )

        # Provisioning agent if there are manual tasks or script steps
        if wf.manual_step_count > 0 or wf.activity_count > 0:
            agents.append(
                AgentDefinition(
                    name=f"{wf.workflow_name} Provisioning Agent",
                    role="provisioning-agent",
                    description="Executes automated fulfillment tasks — API calls, script execution, "
                                "integration orchestration.",
                    tools=["rest_api_client", "script_runner", "integration_bus"],
                    triggers=["on_approval_granted"],
                    human_in_the_loop=["failed_provisioning", "rollback_required"],
                    fallback_behavior="retry_then_escalate",
                )
            )

        # Notification agent for any workflow above trivial
        agents.append(
            AgentDefinition(
                name=f"{wf.workflow_name} Notification Agent",
                role="notification-agent",
                description="Sends status updates and alerts to users throughout the request lifecycle.",
                tools=["email_sender", "slack_notifier", "teams_notifier"],
                triggers=["on_status_change", "on_completion", "on_error"],
                human_in_the_loop=[],
                fallback_behavior="log_and_continue",
            )
        )

        # Escalation agent for complex workflows
        if complexity >= 2.5:
            agents.append(
                AgentDefinition(
                    name=f"{wf.workflow_name} Escalation Agent",
                    role="escalation-agent",
                    description="Handles exceptions, unknowns, and agent failures. Routes to human support "
                                "with full context.",
                    tools=["ticketing_system", "context_collector", "pagerduty"],
                    triggers=["on_agent_failure", "on_unknown_intent", "on_timeout"],
                    human_in_the_loop=["all_escalations"],
                    fallback_behavior="immediate_human_handoff",
                )
            )

        # Determine complexity: simple=1-2, medium=3, complex=4-5
        est = 1
        if readiness == "medium":
            est = 3
        elif readiness == "low" or complexity > 3:
            est = 4 if complexity <= 4 else 5
        elif readiness == "high":
            est = 2 if complexity > 1.5 else 1

        return AgentArchitecture(
            workflow_sys_id=wf.workflow_sys_id,
            workflow_name=wf.workflow_name,
            agents=agents,
            topology="",  # filled later via _build_topology
            communication_pattern="sync" if complexity < 3 else "async",
            estimated_complexity=est,
        )

    def _build_topology(self, arch: AgentArchitecture) -> str:
        """Render a Mermaid flowchart from an AgentArchitecture."""
        lines = ["graph TD"]

        # Entry point
        lines.append("    User[End User] -->|Submit Request| Orch[Orchestrator]")

        role_nodes: dict[str, str] = {}
        for agent in arch.agents:
            role_nodes[agent.role] = agent.name.replace(" ", "_").replace("-", "_")

        # Draw connections from orchestrator to specialists
        for role, node_id in role_nodes.items():
            if role != "orchestrator":
                lines.append(f"    Orch -->|Delegate| {node_id}[{role}]")

        # Approval -> Provisioning if both exist
        if "approval-agent" in role_nodes and "provisioning-agent" in role_nodes:
            lines.append(
                f"    {role_nodes['approval-agent']} -->|Auto-Approved| "
                f"{role_nodes['provisioning-agent']}"
            )
            lines.append(
                f"    {role_nodes['approval-agent']} -->|Needs Review| "
                f"HumanApprover[Human Approver]"
            )

        if "provisioning-agent" in role_nodes:
            lines.append(
                f"    {role_nodes['provisioning-agent']} --> Done[Request Fulfilled]"
            )

        if "escalation-agent" in role_nodes:
            lines.append(
                f"    Orch -->|Exception| {role_nodes['escalation-agent']}"
            )
            lines.append(
                f"    {role_nodes['escalation-agent']} --> HumanSupport[Human Support]"
            )

        return "\n".join(lines)
