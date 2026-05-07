"""Shared Pydantic models for the entire application."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class CatalogItem(BaseModel):
    """Service Catalog item."""

    sys_id: str
    name: str
    short_description: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    active: bool = True

    @field_validator("category", mode="before")
    @classmethod
    def coerce_category(cls, v: Any) -> Optional[str]:
        """ServiceNow returns category as an object {'link':..., 'value':...}."""
        if v is None:
            return None
        if isinstance(v, dict):
            return v.get("value") or v.get("display_value") or str(v)
        return str(v) if v else None
    workflow_id: Optional[str] = None
    variables: list[dict] = Field(default_factory=list)
    request_count: int = 0
    approval_required: bool = False


class WorkflowActivity(BaseModel):
    """A single activity/step in a workflow."""

    sys_id: str
    name: str
    activity_type: str  # "approval", "task", "script", "timer", "condition", etc.
    description: Optional[str] = None
    condition: Optional[str] = None
    is_manual: bool = False
    duration_minutes: Optional[int] = None


class Workflow(BaseModel):
    """Workflow definition attached to catalog items."""

    sys_id: str
    name: str
    table: str = "sc_req_item"
    active: bool = True
    activities: list[WorkflowActivity] = Field(default_factory=list)
    catalog_item_sys_ids: list[str] = Field(default_factory=list)
    version: Optional[str] = None


class ScriptInclude(BaseModel):
    """Script Include (server-side class)."""

    sys_id: str
    name: str
    script: str
    description: Optional[str] = None
    active: bool = True
    access: str = "package_private"
    api_name: Optional[str] = None


class BusinessRule(BaseModel):
    """Business Rule definition."""

    sys_id: str
    name: str
    table: str
    when: str  # "before", "after", "async", "display"
    order: int = 100
    active: bool = True
    condition: Optional[str] = None
    script: Optional[str] = None
    action_insert: bool = True
    action_update: bool = True
    action_delete: bool = False
    action_query: bool = False


class RESTIntegration(BaseModel):
    """Outbound REST message definition."""

    sys_id: str
    name: str
    endpoint: str
    http_method: str = "GET"
    description: Optional[str] = None
    active: bool = True
    retry_policy: Optional[str] = None


class RequestHistory(BaseModel):
    """Aggregated request history statistics for a catalog item."""

    catalog_item_sys_id: str
    catalog_item_name: str
    total_requests: int
    sla_breaches: int = 0
    avg_fulfillment_hours: Optional[float] = None
    median_fulfillment_hours: Optional[float] = None
    approval_count: int = 0
    manual_task_count: int = 0


class WorkflowHealth(BaseModel):
    """Workflow health analysis result."""

    workflow_sys_id: str
    workflow_name: str
    health_score: float = Field(ge=0.0, le=100.0)
    automation_readiness: str  # "high", "medium", "low"
    activity_count: int
    manual_step_count: int
    approval_count: int
    timer_count: int
    complexity_score: float = 0.0
    recommended_agents: list[str] = Field(default_factory=list)
    specific_steps_to_automate: list[str] = Field(default_factory=list)


class ScriptAuditResult(BaseModel):
    """Script audit result per script."""

    sys_id: str
    name: str
    script_type: str  # "script_include", "business_rule", "scheduled_job"
    issues: list[dict] = Field(default_factory=list)
    agent_compatible: bool = True
    needs_refactor: bool = False
    severity: str = "info"  # "critical", "high", "medium", "low", "info"


class Bottleneck(BaseModel):
    """Identified bottleneck in a workflow."""

    workflow_sys_id: str
    workflow_name: str
    bottleneck_type: str  # "sla_breach", "manual_step", "approval_delay", "integration_latency"
    severity: str = "medium"  # "critical", "high", "medium", "low"
    avg_delay_hours: float = 0.0
    affected_requests: int = 0
    description: str = ""
    recommendation: str = ""


class AgentDefinition(BaseModel):
    """AI agent definition for a workflow."""

    name: str
    role: str  # "orchestrator", "approval-agent", "provisioning-agent", "notification-agent", "escalation-agent"
    description: str
    tools: list[str] = Field(default_factory=list)
    triggers: list[str] = Field(default_factory=list)
    human_in_the_loop: list[str] = Field(default_factory=list)
    fallback_behavior: str = "escalate_to_human"


class AgentArchitecture(BaseModel):
    """Full agent architecture for one workflow."""

    workflow_sys_id: str
    workflow_name: str
    agents: list[AgentDefinition] = Field(default_factory=list)
    topology: str = ""  # Mermaid.js diagram
    communication_pattern: str = "sync"
    estimated_complexity: int = Field(default=1, ge=1, le=5)


class MigrationPhase(BaseModel):
    """Single phase in the migration roadmap."""

    name: str
    duration_weeks: int
    description: str
    workflows_included: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    rollback_plan: Optional[str] = None


class MigrationRoadmap(BaseModel):
    """Full migration roadmap."""

    phases: list[MigrationPhase] = Field(default_factory=list)
    total_duration_weeks: int = 0
    parallel_run_strategy: str = ""


class Risk(BaseModel):
    """Single risk entry."""

    id: str
    category: str  # "technical", "operational", "organizational", "security", "data"
    description: str
    likelihood: int = Field(ge=1, le=5)
    impact: int = Field(ge=1, le=5)
    risk_score: int = Field(default=0, ge=0, le=25)
    mitigation: str = ""
    detection: str = ""
    owner: str = ""


class RiskRegister(BaseModel):
    """Full risk register."""

    risks: list[Risk] = Field(default_factory=list)
    summary: str = ""


class DiscoveryResult(BaseModel):
    """Complete result of ServiceNow instance discovery."""

    instance_url: str
    discovered_at: datetime = Field(default_factory=datetime.utcnow)
    catalog_items: list[CatalogItem] = Field(default_factory=list)
    workflows: list[Workflow] = Field(default_factory=list)
    script_includes: list[ScriptInclude] = Field(default_factory=list)
    business_rules: list[BusinessRule] = Field(default_factory=list)
    integrations: list[RESTIntegration] = Field(default_factory=list)
    history: list[RequestHistory] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    """Complete analysis result."""

    discovery: DiscoveryResult
    workflow_health: list[WorkflowHealth] = Field(default_factory=list)
    script_audits: list[ScriptAuditResult] = Field(default_factory=list)
    bottlenecks: list[Bottleneck] = Field(default_factory=list)


class MigrationPackage(BaseModel):
    """Complete migration package — everything the architect needs."""

    analysis: AnalysisResult
    agent_architectures: list[AgentArchitecture] = Field(default_factory=list)
    roadmap: Optional[MigrationRoadmap] = None
    risk_register: Optional[RiskRegister] = None
    generated_docs: dict[str, str] = Field(default_factory=dict)
