#!/usr/bin/env python3
"""
a2a_bridge.py — SN A2A Bridge
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import json, os
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import requests

DEFAULT_INSTANCE = "https://dev362840.service-now.com"
DEFAULT_USER = "admin"
DEFAULT_PASS = os.environ.get("SN_PASSWORD", "7%%gXJzImsW7")

A2A_REQUIRED_FIELDS = {"protocol_version", "agent_manifest", "capabilities", "endpoint_url"}

@dataclass
class ExternalAgent:
    sys_id: str
    name: str
    integration_type: str
    endpoint_url: str
    auth_type: str
    a2a_enabled: bool
    deprecated: bool

@dataclass
class A2AConfig:
    source_agent_id: str
    name: str
    protocol_version: str = "1.0"
    endpoint_url: str = ""
    capabilities: List[str] = field(default_factory=list)
    auth: dict = field(default_factory=lambda: {"type": "oauth2", "scope": "agent"})

@dataclass
class BridgeReport:
    instance: str
    timestamp: str
    total_external_agents: int
    deprecated_count: int
    a2a_compliant_count: int
    migrated: List[A2AConfig]
    issues: List[str]

class A2ABridge:
    def __init__(self, instance: str = DEFAULT_INSTANCE, user: str = DEFAULT_USER, password: str = DEFAULT_PASS):
        self.instance = instance.rstrip("/")
        self.auth = (user, password)
        self.headers = {"Accept": "application/json", "Content-Type": "application/json"}

    def _get(self, endpoint: str, params: Optional[dict] = None) -> List[dict]:
        url = f"{self.instance}{endpoint}"
        r = requests.get(url, auth=self.auth, headers=self.headers, params=params or {}, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"GET {url} => {r.status_code}: {r.text[:200]}")
        return r.json().get("result", [])

    def list_external_agents(self) -> List[ExternalAgent]:
        rows = self._get("/api/now/table/sn_agent", {
            "sysparm_query": "type=external",
            "sysparm_fields": "sys_id,name,integration_type,endpoint_url,auth_type,a2a_enabled",
            "sysparm_limit": 500,
        })
        return [
            ExternalAgent(
                sys_id=r.get("sys_id", ""),
                name=r.get("name", ""),
                integration_type=r.get("integration_type", ""),
                endpoint_url=r.get("endpoint_url", ""),
                auth_type=r.get("auth_type", ""),
                a2a_enabled=str(r.get("a2a_enabled", "")).lower() == "true",
                deprecated=r.get("integration_type", "").lower() in ("manual", "webhook", "legacy"),
            )
            for r in rows
        ]

    def generate_a2a_config(self, agent: ExternalAgent) -> A2AConfig:
        capabilities = ["text", "actions"] if "webhook" in agent.integration_type.lower() else ["text"]
        return A2AConfig(
            source_agent_id=agent.sys_id,
            name=agent.name,
            endpoint_url=agent.endpoint_url,
            capabilities=capabilities,
            auth={"type": agent.auth_type or "oauth2", "scope": "agent"},
        )

    def validate_a2a(self, config: A2AConfig) -> List[str]:
        issues = []
        if not config.endpoint_url:
            issues.append("Missing endpoint_url")
        if not config.capabilities:
            issues.append("Missing capabilities")
        if not config.name:
            issues.append("Missing agent name")
        return issues

    def run(self, limit: int = 500) -> BridgeReport:
        agents = self.list_external_agents()
        deprecated = [a for a in agents if a.deprecated]
        compliant = [a for a in agents if a.a2a_enabled and not a.deprecated]
        migrated = []
        issues = []
        for a in deprecated:
            cfg = self.generate_a2a_config(a)
            validation = self.validate_a2a(cfg)
            if not validation:
                migrated.append(cfg)
            else:
                issues.extend([f"{a.name}: {v}" for v in validation])
        return BridgeReport(
            instance=self.instance,
            timestamp=datetime.now(timezone.utc).isoformat(),
            total_external_agents=len(agents),
            deprecated_count=len(deprecated),
            a2a_compliant_count=len(compliant),
            migrated=migrated,
            issues=issues,
        )

    def save_report(self, report: BridgeReport, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        js = Path(out_dir) / f"a2a_bridge_{ts}_{host}.json"
        js.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2))
        html = Path(out_dir) / f"a2a_bridge_{ts}_{host}.html"
        html.write_text(self._render_html(report))
        return html

    @staticmethod
    def _render_html(report: BridgeReport) -> str:
        migrated_rows = ""
        for m in report.migrated:
            migrated_rows += f"""<tr><td>{m.name}</td><td>{m.endpoint_url}</td><td>{', '.join(m.capabilities)}</td><td></td></tr>\n"""
        issue_rows = ""
        for i in report.issues:
            issue_rows += f"""<tr><td colspan="4" style="color:red">{i}</td></tr>\n"""
        return f"""
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>A2A Bridge Report</title>
<style>body{{font-family:DejaVu Sans;margin:40px}}h1{{color:#0F1D35}}.summary{{font-size:1.2em;margin-bottom:20px}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ddd;padding:8px}}th{{background:#0F1D35;color:white}}</style>
</head><body>
<h1>ServiceNow A2A Protocol Bridge Report</h1>
<div class="summary"><b>Instance:</b> {report.instance} | <b>Total:</b> {report.total_external_agents} | <b>Deprecated:</b> {report.deprecated_count} | <b>A2A Compliant:</b> {report.a2a_compliant_count} | <b>Migrated:</b> {len(report.migrated)}</div>
<h2>Migrated Agents</h2>
<table><tr><th>Name</th><th>Endpoint</th><th>Capabilities</th><th>Status</th></tr>
{migrated_rows}</table>
<h2>Issues</h2>
<table><tr><th>Issues</th></tr>
{issue_rows}</table>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""

if __name__ == "__main__":
    b = A2ABridge()
    report = b.run()
    path = b.save_report(report)
    print(f"Total: {report.total_external_agents} | Deprecated: {report.deprecated_count} | Migrated: {len(report.migrated)} | Report: {path}")
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
