"""Bottleneck Finder — identifies performance bottlenecks in workflows.

Analyzes request history (SLA breaches, fulfillment timings, manual tasks,
approval counts) from a DiscoveryResult and produces a prioritized list of
Bottleneck records with actionable recommendations.
"""

from ..models import (
    Bottleneck,
    DiscoveryResult,
    RequestHistory,
)


# ---------------------------------------------------------------------------
# Severity thresholds for SLA breach rate
# ---------------------------------------------------------------------------

CRITICAL_BREACH_RATE = 0.20   # >20% → critical
HIGH_BREACH_RATE = 0.10       # >10% → high
MEDIUM_BREACH_RATE = 0.05     # >5%  → medium

# Fulfillment time thresholds (hours) — used heuristically where no explicit
# SLA data is available.
VERY_HIGH_FULFILLMENT = 72.0   # >72h suggests systemic issues
HIGH_FULFILLMENT = 24.0        # >24h
ELEVATED_FULFILLMENT = 8.0     # >8h

# Approval thresholds
MANY_APPROVALS = 3             # workflow has ≥3 approval steps → flagged
HIGH_APPROVAL_RATIO = 0.5      # approvals / total steps ≥ 50% → flagged


# ---------------------------------------------------------------------------
# Public class
# ---------------------------------------------------------------------------


class BottleneckFinder:
    """Analyzes request history and identifies bottlenecks in workflow execution.

    Public methods:
        find_bottlenecks(discovery_result) -> list[Bottleneck]
        summary(bottlenecks) -> str
    """

    # ------------------------------------------------------------------
    # Core bottleneck detection
    # ------------------------------------------------------------------

    def find_bottlenecks(
        self,
        discovery_result: DiscoveryResult,
    ) -> list[Bottleneck]:
        """Analyze discovery result history and return prioritized bottlenecks.

        Checks every RequestHistory entry for:
          - SLA breaches (breach rate determines severity)
          - Manual task delays (many manual tasks + long fulfillment)
          - Approval delays (many approvals + long fulfillment)
          - Integration latency flags (when integration mapper data is
            cross-referenced externally)

        Args:
            discovery_result: Complete discovery payload with history entries.

        Returns:
            List of Bottleneck objects sorted: critical first, then by
            affected_requests descending.
        """
        bottlenecks: list[Bottleneck] = []

        # Pre-build workflow lookup for cross-referencing names
        workflow_by_catalog: dict[str, str] = {}  # catalog_item_sys_id → workflow_sys_id
        workflow_name_by_id: dict[str, str] = {}
        for wf in discovery_result.workflows:
            workflow_name_by_id[wf.sys_id] = wf.name
            for cis_id in wf.catalog_item_sys_ids:
                workflow_by_catalog[cis_id] = wf.sys_id

        for rh in discovery_result.history:
            wf_sys_id = workflow_by_catalog.get(rh.catalog_item_sys_id, rh.catalog_item_sys_id)
            wf_name = workflow_name_by_id.get(wf_sys_id, rh.catalog_item_name)

            # ---- 1. SLA breach analysis ----
            sla_bottleneck = self._analyze_sla_breaches(rh, wf_sys_id, wf_name)
            if sla_bottleneck:
                bottlenecks.append(sla_bottleneck)

            # ---- 2. Manual task bottleneck ----
            manual_bottleneck = self._analyze_manual_tasks(rh, wf_sys_id, wf_name)
            if manual_bottleneck:
                bottlenecks.append(manual_bottleneck)

            # ---- 3. Approval delay bottleneck ----
            approval_bottleneck = self._analyze_approval_delays(rh, wf_sys_id, wf_name)
            if approval_bottleneck:
                bottlenecks.append(approval_bottleneck)

            # ---- 4. Integration latency flag ----
            integration_bottleneck = self._analyze_integration_latency(
                rh, wf_sys_id, wf_name
            )
            if integration_bottleneck:
                bottlenecks.append(integration_bottleneck)

        # Sort: critical → high → medium → low, then by affected_requests desc
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        bottlenecks.sort(
            key=lambda b: (
                severity_order.get(b.severity, 99),
                -b.affected_requests,
                b.workflow_name,
            )
        )

        return bottlenecks

    # ------------------------------------------------------------------
    # SLA breach analysis
    # ------------------------------------------------------------------

    @staticmethod
    def _analyze_sla_breaches(
        rh: RequestHistory,
        wf_sys_id: str,
        wf_name: str,
    ) -> Bottleneck | None:
        """Check for SLA breaches and produce a bottleneck if thresholds are met."""
        if rh.sla_breaches <= 0 or rh.total_requests <= 0:
            return None

        breach_rate = rh.sla_breaches / rh.total_requests

        if breach_rate > CRITICAL_BREACH_RATE:
            severity = "critical"
        elif breach_rate > HIGH_BREACH_RATE:
            severity = "high"
        elif breach_rate > MEDIUM_BREACH_RATE:
            severity = "medium"
        else:
            severity = "low"

        avg_delay = rh.avg_fulfillment_hours or 0.0

        description = (
            f"SLA breaches detected: {rh.sla_breaches} out of "
            f"{rh.total_requests} requests ({breach_rate:.1%} breach rate). "
            f"Average fulfillment: {avg_delay:.1f}h."
        )

        recommendation = (
            f"Automate SLA-sensitive steps. Reduce manual handoffs. "
            f"Consider auto-escalation when approaching SLA threshold. "
            f"Target: reduce breach rate below {MEDIUM_BREACH_RATE:.0%}."
        )

        return Bottleneck(
            workflow_sys_id=wf_sys_id,
            workflow_name=wf_name,
            bottleneck_type="sla_breach",
            severity=severity,
            avg_delay_hours=round(avg_delay, 2),
            affected_requests=rh.sla_breaches,
            description=description,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Manual task bottleneck
    # ------------------------------------------------------------------

    @staticmethod
    def _analyze_manual_tasks(
        rh: RequestHistory,
        wf_sys_id: str,
        wf_name: str,
    ) -> Bottleneck | None:
        """Flag workflows with many manual tasks and long fulfillment times."""
        if rh.manual_task_count <= 0:
            return None

        avg_delay = rh.avg_fulfillment_hours or 0.0

        # Only flag if:
        #   - multiple manual tasks exist, AND
        #   - fulfillment time is above elevated threshold
        if rh.manual_task_count < 2:
            return None
        if avg_delay < ELEVATED_FULFILLMENT:
            return None

        # Severity based on fulfillment time and manual task count
        if avg_delay > VERY_HIGH_FULFILLMENT:
            severity = "critical"
        elif avg_delay > HIGH_FULFILLMENT:
            severity = "high"
        else:
            severity = "medium"

        description = (
            f"Workflow has {rh.manual_task_count} manual tasks with average "
            f"fulfillment time of {avg_delay:.1f}h — manual handoffs are likely "
            f"causing delays in {rh.total_requests} total requests."
        )

        recommendation = (
            f"Automate or eliminate {rh.manual_task_count} manual tasks. "
            f"Replace manual assignments with automated provisioning steps. "
            f"Agent-driven task execution can reduce fulfillment by 60-80%."
        )

        return Bottleneck(
            workflow_sys_id=wf_sys_id,
            workflow_name=wf_name,
            bottleneck_type="manual_step",
            severity=severity,
            avg_delay_hours=round(avg_delay, 2),
            affected_requests=rh.total_requests,
            description=description,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Approval delay bottleneck
    # ------------------------------------------------------------------

    @staticmethod
    def _analyze_approval_delays(
        rh: RequestHistory,
        wf_sys_id: str,
        wf_name: str,
    ) -> Bottleneck | None:
        """Flag workflows where many approvals correlate with long fulfillment."""
        if rh.approval_count <= 0:
            return None

        avg_delay = rh.avg_fulfillment_hours or 0.0

        # Only flag if approvals are "many" AND fulfillment is elevated
        if rh.approval_count < MANY_APPROVALS:
            return None
        if avg_delay < ELEVATED_FULFILLMENT:
            return None

        # Severity based on fulfillment time
        if avg_delay > VERY_HIGH_FULFILLMENT:
            severity = "critical"
        elif avg_delay > HIGH_FULFILLMENT:
            severity = "high"
        else:
            severity = "medium"

        description = (
            f"Workflow requires {rh.approval_count} approvals with average "
            f"fulfillment of {avg_delay:.1f}h — approval chains are a primary "
            f"source of delay across {rh.total_requests} requests."
        )

        recommendation = (
            f"Reduce approval chain from {rh.approval_count} to 1-2 levels. "
            f"Implement auto-approval for low-risk requests. "
            f"Use parallel approvals instead of sequential chains. "
            f"Agent-based pre-evaluation can auto-approve routine cases."
        )

        return Bottleneck(
            workflow_sys_id=wf_sys_id,
            workflow_name=wf_name,
            bottleneck_type="approval_delay",
            severity=severity,
            avg_delay_hours=round(avg_delay, 2),
            affected_requests=rh.total_requests,
            description=description,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Integration latency flag
    # ------------------------------------------------------------------

    @staticmethod
    def _analyze_integration_latency(
        rh: RequestHistory,
        wf_sys_id: str,
        wf_name: str,
    ) -> Bottleneck | None:
        """Flag high fulfillment times that may relate to integration latency.

        This is a heuristic: if fulfillment is very high and no other bottleneck
        type was the clear cause (few manual tasks, few approvals, few SLA
        breaches), the delay may stem from slow external integrations.
        """
        avg_delay = rh.avg_fulfillment_hours or 0.0

        # Only flag if fulfillment is very high despite few manual tasks/approvals
        if avg_delay < HIGH_FULFILLMENT:
            return None
        if rh.manual_task_count > 2 or rh.approval_count > 2 or rh.sla_breaches > 0:
            # Other bottleneck types already cover this
            return None

        severity = "medium" if avg_delay <= VERY_HIGH_FULFILLMENT else "high"

        description = (
            f"High average fulfillment time ({avg_delay:.1f}h) with few manual "
            f"or approval steps — possible integration latency from external "
            f"system dependencies. {rh.total_requests} requests affected."
        )

        recommendation = (
            f"Profile external API call durations. Add timeouts and circuit "
            f"breakers. Consider async integration patterns. Cache external "
            f"data where appropriate. Monitor integration health proactively."
        )

        return Bottleneck(
            workflow_sys_id=wf_sys_id,
            workflow_name=wf_name,
            bottleneck_type="integration_latency",
            severity=severity,
            avg_delay_hours=round(avg_delay, 2),
            affected_requests=rh.total_requests,
            description=description,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Summary helper
    # ------------------------------------------------------------------

    @staticmethod
    def summary(bottlenecks: list[Bottleneck]) -> str:
        """Return a human-readable text summary of all bottlenecks.

        Args:
            bottlenecks: List of Bottleneck records (sorted by severity).

        Returns:
            Multi-line summary string suitable for display or reporting.
        """
        if not bottlenecks:
            return "No bottlenecks detected. All workflows are performing within acceptable thresholds."

        total = len(bottlenecks)
        by_severity: dict[str, int] = {}
        by_type: dict[str, int] = {}

        for b in bottlenecks:
            sev = b.severity
            btype = b.bottleneck_type
            by_severity[sev] = by_severity.get(sev, 0) + 1
            by_type[btype] = by_type.get(btype, 0) + 1

        total_affected = sum(b.affected_requests for b in bottlenecks)
        total_delay = sum(b.avg_delay_hours for b in bottlenecks)

        lines: list[str] = []
        lines.append(f"BOTTLENECK ANALYSIS SUMMARY")
        lines.append(f"{'=' * 60}")
        lines.append(f"Total bottlenecks found: {total}")
        lines.append(f"  Critical: {by_severity.get('critical', 0)}")
        lines.append(f"  High:     {by_severity.get('high', 0)}")
        lines.append(f"  Medium:   {by_severity.get('medium', 0)}")
        lines.append(f"  Low:      {by_severity.get('low', 0)}")
        lines.append("")
        lines.append("By type:")
        type_labels = {
            "sla_breach": "SLA Breaches",
            "manual_step": "Manual Task Delays",
            "approval_delay": "Approval Delays",
            "integration_latency": "Integration Latency",
        }
        for btype, count in sorted(by_type.items()):
            label = type_labels.get(btype, btype)
            lines.append(f"  {label}: {count}")
        lines.append("")
        lines.append(f"Total requests affected: {total_affected}")
        lines.append(f"Cumulative avg delay:    {total_delay:.1f}h")
        lines.append(f"{'=' * 60}")
        lines.append("")
        lines.append("Top bottlenecks (by severity):")
        lines.append("")

        # Show top-10 details
        for idx, b in enumerate(bottlenecks[:10], start=1):
            lines.append(
                f"  {idx}. [{b.severity.upper()}] {b.workflow_name} "
                f"({b.bottleneck_type})"
            )
            lines.append(f"     {b.description}")
            lines.append(f"     → {b.recommendation}")
            lines.append("")

        if len(bottlenecks) > 10:
            lines.append(f"  ... and {len(bottlenecks) - 10} more bottlenecks.")

        return "\n".join(lines)
