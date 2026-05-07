"""Integration test for all 6 document generators."""

from datetime import datetime, timezone
from src.models import (
    AnalysisResult, DiscoveryResult, WorkflowHealth, Bottleneck,
    CatalogItem, Workflow, ScriptInclude, BusinessRule, RESTIntegration, RequestHistory,
)
from src.generator import (
    TorGenerator, SpecGenerator, AgentDesigner, RoadmapBuilder, RiskAnalyzer, UserTrainingGenerator,
)

# Build realistic mock data
discovery = DiscoveryResult(
    instance_url="https://dev12345.service-now.com",
    catalog_items=[
        CatalogItem(sys_id="ci1", name="Laptop Request", category="Hardware", request_count=450, approval_required=True),
        CatalogItem(sys_id="ci2", name="VPN Access", category="Security", request_count=1200, approval_required=True),
        CatalogItem(sys_id="ci3", name="Software License", category="Software", request_count=300, approval_required=False),
        CatalogItem(sys_id="ci4", name="New Hire Onboarding", category="HR", request_count=80, approval_required=True),
        CatalogItem(sys_id="ci5", name="Database Access", category="Infrastructure", request_count=200, approval_required=True),
    ],
    workflows=[
        Workflow(sys_id="wf1", name="Laptop Fulfillment", activities=[]),
        Workflow(sys_id="wf2", name="VPN Provisioning", activities=[]),
        Workflow(sys_id="wf3", name="License Assignment", activities=[]),
    ],
    script_includes=[ScriptInclude(sys_id="si1", name="CatalogUtils", script="function getItem...")],
    business_rules=[BusinessRule(sys_id="br1", name="Validate Request", table="sc_req_item", when="before")],
    integrations=[
        RESTIntegration(sys_id="int1", name="Active Directory", endpoint="https://ad.company.com/api", http_method="POST"),
        RESTIntegration(sys_id="int2", name="Jira", endpoint="https://jira.company.com/rest/api", http_method="POST"),
    ],
    history=[
        RequestHistory(catalog_item_sys_id="ci1", catalog_item_name="Laptop Request", total_requests=450, sla_breaches=12, avg_fulfillment_hours=48.0),
        RequestHistory(catalog_item_sys_id="ci2", catalog_item_name="VPN Access", total_requests=1200, sla_breaches=5, avg_fulfillment_hours=2.0),
    ],
)

analysis = AnalysisResult(
    discovery=discovery,
    workflow_health=[
        WorkflowHealth(workflow_sys_id="wf1", workflow_name="Laptop Fulfillment", health_score=72.0, automation_readiness="high",
                       activity_count=8, manual_step_count=2, approval_count=2, timer_count=1, complexity_score=2.5,
                       recommended_agents=["orchestrator", "approval-agent", "provisioning-agent", "notification-agent"],
                       specific_steps_to_automate=["Manager approval", "Asset assignment"]),
        WorkflowHealth(workflow_sys_id="wf2", workflow_name="VPN Provisioning", health_score=90.0, automation_readiness="high",
                       activity_count=4, manual_step_count=0, approval_count=1, timer_count=0, complexity_score=1.0,
                       recommended_agents=["orchestrator", "approval-agent", "provisioning-agent"],
                       specific_steps_to_automate=["AD group membership"]),
        WorkflowHealth(workflow_sys_id="wf3", workflow_name="License Assignment", health_score=45.0, automation_readiness="low",
                       activity_count=12, manual_step_count=5, approval_count=3, timer_count=2, complexity_score=4.0,
                       recommended_agents=["orchestrator", "approval-agent", "provisioning-agent", "notification-agent", "escalation-agent"],
                       specific_steps_to_automate=["License check", "Cost center validation", "SaaS API call"]),
    ],
    bottlenecks=[
        Bottleneck(workflow_sys_id="wf1", workflow_name="Laptop Fulfillment", bottleneck_type="approval_delay",
                   severity="high", avg_delay_hours=24.0, affected_requests=120,
                   description="Manager approvals take 24h on average", recommendation="Auto-approve below $2000"),
    ],
)


def main():
    print("=== TOR Generator ===")
    tor_gen = TorGenerator()
    tor_text = tor_gen.generate(analysis)
    print(f"Generated {len(tor_text)} chars")
    assert "dev12345.service-now.com" in tor_text
    assert "5" in tor_text  # total catalog items
    assert "3" in tor_text  # total workflows
    assert "Total Request History Records" in tor_text
    print("  PASS")

    print("=== Spec Generator ===")
    spec_gen = SpecGenerator()
    spec_text = spec_gen.generate(analysis)
    print(f"Generated {len(spec_text)} chars")
    assert "Technical Specification" in spec_text
    assert "```mermaid" in spec_text
    assert "Active Directory" in spec_text
    print("  PASS")

    print("=== Agent Designer ===")
    ad = AgentDesigner()
    architectures, docs = ad.design(analysis)
    print(f"Architectures: {len(architectures)}, Docs: {len(docs)}")
    assert len(architectures) == 3
    assert len(docs) == 3
    assert "Laptop Fulfillment" in docs.get("wf1", "")
    assert "```mermaid" in docs["wf1"]
    laptop = next(a for a in architectures if a.workflow_sys_id == "wf1")
    vpn = next(a for a in architectures if a.workflow_sys_id == "wf2")
    license_arch = next(a for a in architectures if a.workflow_sys_id == "wf3")
    print(f"  Laptop agents: {len(laptop.agents)}, VPN agents: {len(vpn.agents)}, License agents: {len(license_arch.agents)}")
    assert len(vpn.agents) <= 4
    assert len(license_arch.agents) >= 4  # complex gets escalation agent
    print("  PASS")

    print("=== Roadmap Builder ===")
    rb = RoadmapBuilder()
    roadmap = rb.build(analysis, architectures)
    print(f"Phases: {len(roadmap.phases)}, Total weeks: {roadmap.total_duration_weeks}")
    assert len(roadmap.phases) == 5
    assert roadmap.total_duration_weeks == 20
    phase1 = roadmap.phases[1]
    assert phase1.name == "Phase 1: Quick Wins"
    print(f"  Phase 1 workflows: {phase1.workflows_included}")
    roadmap_text = rb.render(roadmap, analysis)
    assert "Quick Wins" in roadmap_text
    print("  PASS")

    print("=== Risk Analyzer ===")
    ra = RiskAnalyzer()
    register = ra.analyze(analysis, roadmap)
    print(f"Risks: {len(register.risks)}")
    assert 8 <= len(register.risks) <= 12
    for r in register.risks:
        assert r.risk_score == r.likelihood * r.impact, f"{r.id}: {r.risk_score} != {r.likelihood} * {r.impact}"
    risk_text = ra.render(register, analysis)
    assert "Risk Register" in risk_text
    assert "R01" in risk_text
    print("  PASS")

    print("=== Training Generator ===")
    ut = UserTrainingGenerator()
    train_text = ut.generate(analysis, architectures)
    assert "Training Plan" in train_text
    assert "End Users" in train_text
    assert "Approvers" in train_text
    print(f"Generated {len(train_text)} chars")
    print("  PASS")

    # Test empty data handling
    print("\n=== Empty Data Tests ===")
    empty_discovery = DiscoveryResult(
        instance_url="https://empty.service-now.com",
        catalog_items=[], workflows=[], script_includes=[], business_rules=[], integrations=[], history=[],
    )
    empty_analysis = AnalysisResult(discovery=empty_discovery, workflow_health=[], script_audits=[], bottlenecks=[])

    assert "Cannot generate TOR" in tor_gen.generate(empty_analysis)
    print("  TOR empty: PASS")
    assert "Cannot generate specification" in spec_gen.generate(empty_analysis)
    print("  Spec empty: PASS")

    empty_archs, empty_docs = ad.design(empty_analysis)
    assert len(empty_archs) == 0
    assert len(empty_docs) == 0
    print("  AgentDesigner empty: PASS")

    empty_roadmap = rb.build(empty_analysis, [])
    assert empty_roadmap.total_duration_weeks == 0
    print("  Roadmap empty: PASS")

    assert "cannot be generated" in ut.generate(empty_analysis, []).lower()
    print("  Training empty: PASS")

    print("\nAll 6 generators PASSED integration tests!")


if __name__ == "__main__":
    main()
