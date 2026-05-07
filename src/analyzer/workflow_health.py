"""Workflow Health Analyzer — scores workflows for AI-automation readiness."""

from ..models import (
    DiscoveryResult,
    Workflow,
    WorkflowActivity,
    WorkflowHealth,
    RequestHistory,
    CatalogItem,
)


class WorkflowHealthAnalyzer:
    """Analyzes ServiceNow workflows and scores their AI-automation readiness.

    Produces a sorted list of WorkflowHealth records (high readiness first)
    from a DiscoveryResult payload.
    """

    # Activity-type constants
    APPROVAL_TYPE = "approval"
    TASK_TYPE = "task"
    SCRIPT_TYPE = "script"
    TIMER_TYPE = "timer"
    CONDITION_TYPE = "condition"

    # Readiness thresholds
    HIGH_THRESHOLD = 70
    MEDIUM_THRESHOLD = 40
    HIGH_MAX_MANUAL = 2

    # Score deduction weights
    ACTIVITY_OVERAGE_DEDUCTION = 5  # per activity over 10, capped at -50
    APPROVAL_DEDUCTION = 10
    MANUAL_DEDUCTION = 5
    TIMER_DEDUCTION = 3
    SIMPLE_BONUS = 10  # fewer than 5 activities
    SIMPLE_THRESHOLD = 5
    ACTIVITY_OVERAGE_THRESHOLD = 10
    MAX_ACTIVITY_DEDUCTION = 50
    MAX_SCORE = 100
    MIN_SCORE = 0

    # Keywords for provisioning detection
    PROVISIONING_KEYWORDS = frozenset({
        "provision", "provisioning", "create", "allocate", "deploy",
        "setup", "spin up", "spin-up", "onboard", "grant", "assign",
        "configure", "install",
    })

    # Keywords for script lookups / transformations
    LOOKUP_TRANSFORM_KEYWORDS = frozenset({
        "lookup", "look up", "transform", "map", "translate",
        "enrich", "fetch", "retrieve", "get", "query", "resolve",
    })

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, discovery_result: DiscoveryResult) -> list[WorkflowHealth]:
        """Score every active workflow and return results sorted by readiness.

        Args:
            discovery_result: The complete discovery payload including
                              workflows, catalog items, and request history.

        Returns:
            List of WorkflowHealth objects sorted high → medium → low.
        """
        results: list[WorkflowHealth] = []

        # Pre-build lookup structures for cross-referencing
        catalog_by_id = self._index_catalog_items(discovery_result)
        history_by_catalog = self._index_history(discovery_result)

        for workflow in discovery_result.workflows:
            if not workflow.active:
                continue

            health = self._analyze_one(workflow, catalog_by_id, history_by_catalog)
            results.append(health)

        # Sort: high first, then medium, then low
        readiness_order = {"high": 0, "medium": 1, "low": 2}
        results.sort(key=lambda h: (readiness_order.get(h.automation_readiness, 99), -h.health_score))

        return results

    # ------------------------------------------------------------------
    # Single-workflow analysis
    # ------------------------------------------------------------------

    def _analyze_one(
        self,
        workflow: Workflow,
        catalog_by_id: dict[str, CatalogItem],
        history_by_catalog: dict[str, RequestHistory],
    ) -> WorkflowHealth:
        """Run the full health analysis for a single workflow."""
        activities = workflow.activities

        # ---- Counts ----
        activity_count = len(activities)
        approval_count = sum(1 for a in activities if a.activity_type == self.APPROVAL_TYPE)
        manual_count = sum(1 for a in activities if a.is_manual)
        timer_count = sum(1 for a in activities if a.activity_type == self.TIMER_TYPE)

        # ---- Health score (0-100) ----
        health_score = self._compute_health_score(
            activity_count, approval_count, manual_count, timer_count
        )

        # Cross-reference SLA breach data
        sla_breach_total, sla_breach_catalogs = self._gather_sla_breaches(
            workflow, catalog_by_id, history_by_catalog
        )
        if sla_breach_total > 0:
            # Penalise score when SLA breaches are present
            health_score = max(self.MIN_SCORE, health_score - min(sla_breach_total * 2, 15))

        # ---- Complexity score (raw formula) ----
        complexity_score = (
            activity_count * 1.5
            + manual_count * 2.0
            + approval_count * 3.0
            + timer_count * 1.0
        )

        # ---- Automation readiness ----
        automation_readiness = self._determine_readiness(health_score, manual_count)

        # ---- Specific steps to automate ----
        steps = self._identify_automation_steps(activities)

        # If SLA breaches exist, add them as notable findings
        if sla_breach_total > 0:
            steps.append(
                f"SLA breaches detected ({sla_breach_total} across "
                f"{len(sla_breach_catalogs)} catalog items): "
                f"automation could reduce missed deadlines"
            )

        # ---- Recommended agents ----
        agents = self._recommend_agents(activities, workflow)

        return WorkflowHealth(
            workflow_sys_id=workflow.sys_id,
            workflow_name=workflow.name,
            health_score=round(health_score, 2),
            automation_readiness=automation_readiness,
            activity_count=activity_count,
            manual_step_count=manual_count,
            approval_count=approval_count,
            timer_count=timer_count,
            complexity_score=round(complexity_score, 2),
            recommended_agents=agents,
            specific_steps_to_automate=steps,
        )

    # ------------------------------------------------------------------
    # Health score computation
    # ------------------------------------------------------------------

    def _compute_health_score(
        self,
        activity_count: int,
        approval_count: int,
        manual_count: int,
        timer_count: int,
    ) -> float:
        """Compute 0-100 health score using deduction rules."""
        score = float(self.MAX_SCORE)

        # Deduction per activity over 10 (capped at -50)
        overage = max(0, activity_count - self.ACTIVITY_OVERAGE_THRESHOLD)
        activity_deduction = min(overage * self.ACTIVITY_OVERAGE_DEDUCTION, self.MAX_ACTIVITY_DEDUCTION)
        score -= activity_deduction

        # Approval penalty
        score -= approval_count * self.APPROVAL_DEDUCTION

        # Manual task penalty
        score -= manual_count * self.MANUAL_DEDUCTION

        # Timer penalty
        score -= timer_count * self.TIMER_DEDUCTION

        # Bonus for simple workflows
        if activity_count < self.SIMPLE_THRESHOLD:
            score += self.SIMPLE_BONUS

        return max(self.MIN_SCORE, min(self.MAX_SCORE, score))

    # ------------------------------------------------------------------
    # Readiness determination
    # ------------------------------------------------------------------

    @staticmethod
    def _determine_readiness(health_score: float, manual_count: int) -> str:
        """Map health_score to readiness tier."""
        if health_score >= WorkflowHealthAnalyzer.HIGH_THRESHOLD and manual_count <= WorkflowHealthAnalyzer.HIGH_MAX_MANUAL:
            return "high"
        if health_score >= WorkflowHealthAnalyzer.MEDIUM_THRESHOLD:
            return "medium"
        return "low"

    # ------------------------------------------------------------------
    # Automation-step identification
    # ------------------------------------------------------------------

    def _identify_automation_steps(self, activities: list[WorkflowActivity]) -> list[str]:
        """Return human-readable descriptions of automatable steps."""
        steps: list[str] = []

        for activity in activities:
            atype = activity.activity_type
            name = activity.name

            # Approval with no complex conditions → agent can handle
            if atype == self.APPROVAL_TYPE:
                if self._condition_is_simple(activity.condition):
                    steps.append(
                        f"Approval '{name}' has no complex conditions "
                        f"— an approval-agent can auto-handle this step"
                    )
                else:
                    steps.append(
                        f"Approval '{name}' has conditional logic — "
                        f"agent can pre-evaluate and present recommendation to human"
                    )

            # Manual task with clear trigger → automatable
            elif atype == self.TASK_TYPE and activity.is_manual:
                trigger_note = self._infer_trigger(activity)
                steps.append(
                    f"Manual task '{name}'{trigger_note} — "
                    f"can be automated with a provisioning-agent or orchestrator"
                )

            # Timer-based activities → can be event-driven
            elif atype == self.TIMER_TYPE:
                dur = f" ({activity.duration_minutes}m)" if activity.duration_minutes else ""
                steps.append(
                    f"Timer activity '{name}'{dur} — replace with event-driven "
                    f"trigger for immediate execution"
                )

            # Script activities doing lookups/transformations → automatable
            elif atype == self.SCRIPT_TYPE:
                if self._is_lookup_or_transform(activity):
                    steps.append(
                        f"Script '{name}' performs lookup/transformation — "
                        f"can be handled by an agent tool call"
                    )

        return steps

    # ------------------------------------------------------------------
    # Agent recommendations
    # ------------------------------------------------------------------

    def _recommend_agents(
        self,
        activities: list[WorkflowActivity],
        workflow: Workflow,
    ) -> list[str]:
        """Build the list of recommended agent types."""
        agents: set[str] = set()

        has_approvals = any(a.activity_type == self.APPROVAL_TYPE for a in activities)
        has_provisioning = self._has_provisioning_tasks(activities, workflow)
        has_exceptions = self._has_exception_patterns(activities)
        is_complex = len(activities) > 7

        # Every workflow gets a notification-agent for user updates
        agents.add("notification-agent")

        if has_approvals:
            agents.add("approval-agent")

        if has_provisioning:
            agents.add("provisioning-agent")

        if is_complex or (has_approvals and has_provisioning):
            agents.add("orchestrator")

        if has_exceptions:
            agents.add("escalation-agent")

        # Ensure consistent ordering
        priority = ["orchestrator", "approval-agent", "provisioning-agent",
                     "notification-agent", "escalation-agent"]
        return sorted(agents, key=lambda a: priority.index(a) if a in priority else 99)

    # ------------------------------------------------------------------
    # Provisioning / exception detection
    # ------------------------------------------------------------------

    @classmethod
    def _has_provisioning_tasks(
        cls, activities: list[WorkflowActivity], workflow: Workflow
    ) -> bool:
        """Check if workflow contains provisioning-related activities."""
        # Check activity names / descriptions
        for a in activities:
            text = f"{a.name or ''} {a.description or ''}".lower()
            if any(kw in text for kw in cls.PROVISIONING_KEYWORDS):
                return True
        # Also check workflow name
        if any(kw in (workflow.name or "").lower() for kw in cls.PROVISIONING_KEYWORDS):
            return True
        return False

    @staticmethod
    def _has_exception_patterns(activities: list[WorkflowActivity]) -> bool:
        """Check for exception / error-handling patterns in conditions."""
        exception_keywords = ("error", "exception", "fail", "escalat", "rollback", "reject")
        for a in activities:
            cond = (a.condition or "").lower()
            if any(kw in cond for kw in exception_keywords):
                return True
            if a.activity_type == WorkflowHealthAnalyzer.CONDITION_TYPE and cond:
                # A non-trivial condition suggests branching / exceptions
                if len(cond.split()) > 3:
                    return True
        return False

    # ------------------------------------------------------------------
    # Condition evaluation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _condition_is_simple(condition: str | None) -> bool:
        """A condition is 'simple' if it is None, empty, or a trivial pass-through."""
        if condition is None:
            return True
        stripped = condition.strip().lower()
        if not stripped:
            return True
        # Trivial always-true conditions
        if stripped in ("true", "1 == 1", "1=1"):
            return True
        return False

    # ------------------------------------------------------------------
    # Trigger inference for manual tasks
    # ------------------------------------------------------------------

    @staticmethod
    def _infer_trigger(activity: WorkflowActivity) -> str:
        """Return a note about the trigger for a manual task."""
        desc = (activity.description or "").lower()
        name = (activity.name or "").lower()
        combined = f"{name} {desc}"

        if any(word in combined for word in ("request", "submit", "form", "order")):
            return " (triggered by request submission)"
        if any(word in combined for word in ("approv", "authoriz")):
            return " (triggered after approval)"
        if any(word in combined for word in ("assign", "queue")):
            return " (triggered by assignment)"
        return ""

    # ------------------------------------------------------------------
    # Script classification
    # ------------------------------------------------------------------

    @classmethod
    def _is_lookup_or_transform(cls, activity: WorkflowActivity) -> bool:
        """Determine if a script activity is performing lookups/transformations."""
        text = f"{activity.name or ''} {activity.description or ''}".lower()
        return any(kw in text for kw in cls.LOOKUP_TRANSFORM_KEYWORDS)

    # ------------------------------------------------------------------
    # SLA cross-reference
    # ------------------------------------------------------------------

    @staticmethod
    def _gather_sla_breaches(
        workflow: Workflow,
        catalog_by_id: dict[str, CatalogItem],
        history_by_catalog: dict[str, RequestHistory],
    ) -> tuple[int, set[str]]:
        """Aggregate SLA breach counts for all catalog items linked to this workflow.

        Returns:
            (total_breaches, set of catalog_item_sys_ids with breaches)
        """
        total = 0
        affected: set[str] = set()

        for cis_id in workflow.catalog_item_sys_ids:
            # Try direct history lookup first
            rh = history_by_catalog.get(cis_id)
            if rh and rh.sla_breaches > 0:
                total += rh.sla_breaches
                affected.add(cis_id)
                continue

            # Fall back to catalog-item index and then history
            cat = catalog_by_id.get(cis_id)
            if cat is not None:
                rh = history_by_catalog.get(cat.sys_id)
                if rh and rh.sla_breaches > 0:
                    total += rh.sla_breaches
                    affected.add(cis_id)

        return total, affected

    # ------------------------------------------------------------------
    # Index builders
    # ------------------------------------------------------------------

    @staticmethod
    def _index_catalog_items(discovery: DiscoveryResult) -> dict[str, CatalogItem]:
        """Build sys_id → CatalogItem map."""
        return {ci.sys_id: ci for ci in discovery.catalog_items}

    @staticmethod
    def _index_history(discovery: DiscoveryResult) -> dict[str, RequestHistory]:
        """Build catalog_item_sys_id → RequestHistory map."""
        return {h.catalog_item_sys_id: h for h in discovery.history}
