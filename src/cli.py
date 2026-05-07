"""Typer CLI — the command-line interface for ServiceNow AI Migration Architect."""

import asyncio
import logging
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich.tree import Tree

from src.config import AppConfig, load_config
from src.servicenow.client import ServiceNowClient
from src.servicenow.discovery import DiscoveryEngine
from src.analyzer.workflow_health import WorkflowHealthAnalyzer
from src.analyzer.script_auditor import ScriptAuditor
from src.analyzer.integration_mapper import IntegrationMapper
from src.analyzer.bottleneck_finder import BottleneckFinder
from src.generator.tor_generator import TorGenerator
from src.generator.spec_generator import SpecGenerator
from src.generator.agent_designer import AgentDesigner
from src.generator.roadmap_builder import RoadmapBuilder
from src.generator.risk_analyzer import RiskAnalyzer
from src.generator.user_training import UserTrainingGenerator
from src.models import AnalysisResult, MigrationPackage

app = typer.Typer(
    name="sn-ai-migrator",
    help="ServiceNow AI Migration Architect — analyze your SN instance and generate a complete migration blueprint",
)
console = Console()
logger = logging.getLogger("sn-ai-migrator")


def _setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _build_sn_client(config: AppConfig) -> ServiceNowClient:
    """Build ServiceNow client from config."""
    sn = config.servicenow
    if not sn.instance_url or not sn.password:
        console.print("[red]ERROR:[/] ServiceNow credentials not configured.")
        console.print("Edit config.yaml with your instance_url, username, and password.")
        raise typer.Exit(code=1)
    return ServiceNowClient(
        instance_url=sn.instance_url,
        username=sn.username,
        password=sn.password,
    )


def _ensure_output_dir(output_dir: str):
    """Create output directory structure."""
    base = Path(output_dir)
    for subdir in [
        "",
        "03_workflow_analysis",
        "04_agent_architectures",
        "08_appendices",
    ]:
        (base / subdir).mkdir(parents=True, exist_ok=True)


def _write_doc(output_dir: str, filename: str, content: str):
    """Write a generated document to output directory."""
    path = Path(output_dir) / filename
    path.write_text(content, encoding="utf-8")
    return path


@app.command()
def discover(
    config_path: str = typer.Option("config.yaml", "--config", "-c", help="Path to config.yaml"),
):
    """Connect to ServiceNow and discover all catalog items, workflows, scripts, and history."""
    _setup_logging()
    config = load_config(config_path)
    client = _build_sn_client(config)

    console.print()
    console.print(Panel.fit(
        "[bold cyan]ServiceNow AI Migration Architect[/] — Discovery",
        border_style="cyan",
    ))
    console.print(f"Connecting to [bold]{config.servicenow.instance_url}[/]...")

    async def _run():
        try:
            engine = DiscoveryEngine(
                client,
                config={
                    "max_catalog_items": config.discovery.max_catalog_items,
                    "history_days": config.discovery.history_days,
                    "include_inactive": config.discovery.include_inactive,
                },
            )
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                task = progress.add_task("Discovering ServiceNow instance...", total=None)
                result = await engine.discover_all()
                progress.update(task, completed=True)

            # Summary
            console.print()
            table = Table(title="Discovery Results", style="cyan")
            table.add_column("Resource", style="bold")
            table.add_column("Count", justify="right")

            table.add_row("Catalog Items", str(len(result.catalog_items)))
            table.add_row("Workflows", str(len(result.workflows)))
            table.add_row("Script Includes", str(len(result.script_includes)))
            table.add_row("Business Rules", str(len(result.business_rules)))
            table.add_row("REST Integrations", str(len(result.integrations)))
            table.add_row("History Records", str(len(result.history)))

            console.print(table)

            # Save discovery result
            output_dir = config.output.dir
            _ensure_output_dir(output_dir)
            import json
            data_path = Path(output_dir) / "08_appendices" / "discovery_data.json"
            data_path.write_text(result.model_dump_json(indent=2))
            console.print(f"\n[green]Discovery data saved to[/] {data_path}")

            return result
        finally:
            await client.close()

    asyncio.run(_run())


@app.command()
def analyze(
    config_path: str = typer.Option("config.yaml", "--config", "-c", help="Path to config.yaml"),
):
    """Analyze discovered data: workflow health, script quality, bottlenecks."""
    _setup_logging()
    config = load_config(config_path)
    client = _build_sn_client(config)

    console.print()
    console.print(Panel.fit(
        "[bold cyan]ServiceNow AI Migration Architect[/] — Analysis",
        border_style="cyan",
    ))

    async def _run():
        try:
            engine = DiscoveryEngine(
                client,
                config={
                    "max_catalog_items": config.discovery.max_catalog_items,
                    "history_days": config.discovery.history_days,
                    "include_inactive": config.discovery.include_inactive,
                },
            )

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                task = progress.add_task("Discovering...", total=None)
                discovery = await engine.discover_all()
                progress.update(task, completed=True)

                task = progress.add_task("Analyzing workflow health...", total=None)
                health = WorkflowHealthAnalyzer().analyze(discovery)
                progress.update(task, completed=True)

                task = progress.add_task("Auditing scripts...", total=None)
                scripts = ScriptAuditor().audit(discovery)
                progress.update(task, completed=True)

                task = progress.add_task("Mapping integrations...", total=None)
                integrations = IntegrationMapper().map_integrations(discovery)
                progress.update(task, completed=True)

                task = progress.add_task("Finding bottlenecks...", total=None)
                bottlenecks = BottleneckFinder().find_bottlenecks(discovery)
                progress.update(task, completed=True)

            analysis = AnalysisResult(
                discovery=discovery,
                workflow_health=health,
                script_audits=scripts,
                bottlenecks=bottlenecks,
            )

            # Summary
            console.print()
            high = sum(1 for h in health if h.automation_readiness == "high")
            medium = sum(1 for h in health if h.automation_readiness == "medium")
            low = sum(1 for h in health if h.automation_readiness == "low")

            ready_table = Table(title="Automation Readiness", style="cyan")
            ready_table.add_column("Readiness", style="bold")
            ready_table.add_column("Count", justify="right")
            ready_table.add_row("[green]High[/]", str(high))
            ready_table.add_row("[yellow]Medium[/]", str(medium))
            ready_table.add_row("[red]Low[/]", str(low))
            console.print(ready_table)

            crit_scripts = sum(1 for s in scripts if s.severity == "critical")
            high_scripts = sum(1 for s in scripts if s.severity == "high")
            console.print(f"\nScript Audit: [red]{crit_scripts} critical[/], [yellow]{high_scripts} high[/] issues in {len(scripts)} scripts")

            crit_bn = sum(1 for b in bottlenecks if b.severity == "critical")
            console.print(f"Bottlenecks: [red]{crit_bn} critical[/] out of {len(bottlenecks)} total")

            # Save analysis
            output_dir = config.output.dir
            _ensure_output_dir(output_dir)
            data_path = Path(output_dir) / "08_appendices" / "analysis_data.json"
            data_path.write_text(analysis.model_dump_json(indent=2))
            console.print(f"\n[green]Analysis data saved to[/] {data_path}")

            return analysis
        finally:
            await client.close()

    asyncio.run(_run())


@app.command()
def generate(
    config_path: str = typer.Option("config.yaml", "--config", "-c", help="Path to config.yaml"),
):
    """Generate the full migration document package."""
    _setup_logging()
    config = load_config(config_path)
    client = _build_sn_client(config)
    output_dir = config.output.dir
    _ensure_output_dir(output_dir)

    console.print()
    console.print(Panel.fit(
        "[bold cyan]ServiceNow AI Migration Architect[/] — Generate",
        border_style="cyan",
    ))

    async def _run():
        try:
            engine = DiscoveryEngine(
                client,
                config={
                    "max_catalog_items": config.discovery.max_catalog_items,
                    "history_days": config.discovery.history_days,
                    "include_inactive": config.discovery.include_inactive,
                },
            )

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                # Discover
                task = progress.add_task("Discovering...", total=None)
                discovery = await engine.discover_all()
                progress.update(task, completed=True)

                # Analyze
                task = progress.add_task("Analyzing workflows...", total=None)
                health = WorkflowHealthAnalyzer().analyze(discovery)
                scripts = ScriptAuditor().audit(discovery)
                bottlenecks = BottleneckFinder().find_bottlenecks(discovery)
                analysis = AnalysisResult(
                    discovery=discovery,
                    workflow_health=health,
                    script_audits=scripts,
                    bottlenecks=bottlenecks,
                )
                progress.update(task, completed=True)

                # Design agents
                task = progress.add_task("Designing AI agents...", total=None)
                agent_designer = AgentDesigner()
                architectures, arch_docs = agent_designer.design(analysis)
                progress.update(task, completed=True)

                # Build roadmap
                task = progress.add_task("Building roadmap...", total=None)
                roadmap = RoadmapBuilder().build(analysis, architectures)
                progress.update(task, completed=True)

                # Generate risks
                task = progress.add_task("Analyzing risks...", total=None)
                risk_register = RiskAnalyzer().analyze(analysis, roadmap)
                progress.update(task, completed=True)

                # Generate documents
                task = progress.add_task("Generating documents...", total=None)
                tor = TorGenerator().generate(analysis)
                spec = SpecGenerator().generate(analysis)
                training = UserTrainingGenerator().generate(analysis, architectures)

                pkg = MigrationPackage(
                    analysis=analysis,
                    agent_architectures=architectures,
                    roadmap=roadmap,
                    risk_register=risk_register,
                    generated_docs={
                        "tor": tor,
                        "spec": spec,
                        "training": training,
                    },
                )
                progress.update(task, completed=True)

            # Write all documents
            docs = [
                ("00_executive_summary.md", _build_executive_summary(analysis, architectures, roadmap, risk_register)),
                ("01_terms_of_reference.md", tor),
                ("02_technical_specification.md", spec),
            ]

            for filename, content in docs:
                path = _write_doc(output_dir, filename, content)
                console.print(f"  [green]Wrote[/] {path}")

            # Per-workflow docs
            for health_item in health:
                wf_name = health_item.workflow_name.replace(" ", "_").lower()
                wf_dir = "03_workflow_analysis"
                content = _build_workflow_analysis_md(health_item, analysis)
                path = _write_doc(output_dir, f"{wf_dir}/{wf_name}.md", content)
                console.print(f"  [green]Wrote[/] {path}")

            # Agent architecture docs
            for wf_sys_id, md_content in arch_docs.items():
                # find workflow name
                wf_name = "unknown"
                for wf in discovery.workflows:
                    if wf.sys_id == wf_sys_id:
                        wf_name = wf.name.replace(" ", "_").lower()
                        break
                path = _write_doc(output_dir, f"04_agent_architectures/{wf_name}_agents.md", md_content)
                console.print(f"  [green]Wrote[/] {path}")

            # Roadmap
            roadmap_md = RoadmapBuilder().render(roadmap, analysis)
            path = _write_doc(output_dir, "05_migration_roadmap.md", roadmap_md)
            console.print(f"  [green]Wrote[/] {path}")

            # Risk register
            risk_md = RiskAnalyzer().render(risk_register, analysis)
            path = _write_doc(output_dir, "06_risk_register.md", risk_md)
            console.print(f"  [green]Wrote[/] {path}")

            # Training plan
            path = _write_doc(output_dir, "07_training_plan.md", training)
            console.print(f"  [green]Wrote[/] {path}")

            # Appendices
            import json
            appends = Path(output_dir) / "08_appendices"
            (appends / "discovery_data.json").write_text(discovery.model_dump_json(indent=2))
            (appends / "analysis_data.json").write_text(analysis.model_dump_json(indent=2))
            (appends / "roadmap.json").write_text(roadmap.model_dump_json(indent=2))
            (appends / "risk_register.json").write_text(risk_register.model_dump_json(indent=2))
            console.print(f"  [green]Wrote[/] {appends}/")

            console.print()
            console.print(Panel.fit(
                "[bold green]Done![/] Full migration package generated.",
                border_style="green",
            ))
            console.print(f"Output directory: [bold]{Path(output_dir).resolve()}[/]")
            console.print()
            console.print("Next steps:")
            console.print("  1. Review [bold]00_executive_summary.md[/] for high-level overview")
            console.print("  2. Dive into [bold]03_workflow_analysis/[/] for per-workflow details")
            console.print("  3. Assess [bold]05_migration_roadmap.md[/] for phased execution")
            console.print("  4. Present [bold]01_terms_of_reference.md[/] to stakeholders")

            return pkg
        finally:
            await client.close()

    asyncio.run(_run())


def _build_executive_summary(
    analysis: AnalysisResult,
    architectures: list,
    roadmap,
    risk_register,
) -> str:
    """Build executive summary markdown."""
    lines = [
        "# Executive Summary: AI Agent Migration for ServiceNow",
        "",
        f"**Instance:** {analysis.discovery.instance_url}",
        f"**Analysis Date:** {analysis.discovery.discovered_at.strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "## Current State",
        "",
        f"- **{len(analysis.discovery.catalog_items)}** catalog items",
        f"- **{len(analysis.discovery.workflows)}** active workflows",
        f"- **{len(analysis.discovery.script_includes)}** script includes",
        f"- **{len(analysis.discovery.business_rules)}** business rules",
        f"- **{len(analysis.discovery.integrations)}** external integrations",
        "",
        "## Automation Readiness",
        "",
    ]

    high = sum(1 for h in analysis.workflow_health if h.automation_readiness == "high")
    medium = sum(1 for h in analysis.workflow_health if h.automation_readiness == "medium")
    low = sum(1 for h in analysis.workflow_health if h.automation_readiness == "low")

    lines.append(f"| Readiness | Count |")
    lines.append(f"|-----------|-------|")
    lines.append(f"| High | {high} |")
    lines.append(f"| Medium | {medium} |")
    lines.append(f"| Low | {low} |")
    lines.append("")

    # Quick wins
    high_workflows = [h for h in analysis.workflow_health if h.automation_readiness == "high"]
    if high_workflows:
        lines.append("### Top Quick Win Candidates")
        lines.append("")
        for hw in sorted(high_workflows, key=lambda x: x.health_score, reverse=True)[:5]:
            lines.append(f"- **{hw.workflow_name}** (score: {hw.health_score:.0f})")

    lines.append("")
    lines.append("## Critical Risks")
    lines.append("")
    if risk_register:
        critical_risks = [r for r in risk_register.risks if r.risk_score >= 15]
        for r in critical_risks[:5]:
            lines.append(f"- [{r.category}] {r.description} (score: {r.risk_score})")

    lines.append("")
    lines.append("## Recommended Approach")
    lines.append("")
    if roadmap:
        for phase in roadmap.phases:
            lines.append(f"### {phase.name} ({phase.duration_weeks} weeks)")
            lines.append(f"{phase.description}")
            lines.append("")

    return "\n".join(lines)


def _build_workflow_analysis_md(health_item, analysis: AnalysisResult) -> str:
    """Build per-workflow analysis markdown."""
    lines = [
        f"# Workflow Analysis: {health_item.workflow_name}",
        "",
        f"**Health Score:** {health_item.health_score:.1f}/100",
        f"**Automation Readiness:** {health_item.automation_readiness}",
        f"**Complexity Score:** {health_item.complexity_score:.1f}",
        "",
        "## Metrics",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Total Activities | {health_item.activity_count} |",
        f"| Manual Steps | {health_item.manual_step_count} |",
        f"| Approvals | {health_item.approval_count} |",
        f"| Timers | {health_item.timer_count} |",
        "",
        "## Recommended AI Agents",
        "",
    ]

    for agent in health_item.recommended_agents:
        lines.append(f"- {agent}")

    lines.append("")
    lines.append("## Steps to Automate")
    lines.append("")

    for step in health_item.specific_steps_to_automate:
        lines.append(f"- {step}")

    # Cross-reference bottlenecks
    matching_bn = [b for b in analysis.bottlenecks if b.workflow_sys_id == health_item.workflow_sys_id]
    if matching_bn:
        lines.append("")
        lines.append("## Bottlenecks Found")
        lines.append("")
        for bn in matching_bn:
            lines.append(f"- [{bn.severity}] {bn.description} — {bn.recommendation}")

    lines.append("")
    return "\n".join(lines)


def main():
    """Entry point for console_scripts."""
    app()


if __name__ == "__main__":
    main()
