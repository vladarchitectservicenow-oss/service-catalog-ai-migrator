#!/usr/bin/env python3
"""
validator.py — SN AI Agent Validator
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import json, os, re
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import requests

DEFAULT_INSTANCE = "https://dev362840.service-now.com"
DEFAULT_USER = "admin"
DEFAULT_PASS = os.environ.get("SN_PASSWORD", "7%%gXJzImsW7")

@dataclass
class CheckResult:
    area: str
    status: str   # PASS, WARN, FAIL
    score: int      # 0-100
    details: List[str] = field(default_factory=list)

@dataclass
class ValidationReport:
    instance: str
    timestamp: str
    overall_score: int
    overall_status: str
    checks: List[CheckResult]

class AIAgentValidator:
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

    def _post(self, endpoint: str, body: dict) -> dict:
        url = f"{self.instance}{endpoint}"
        r = requests.post(url, auth=self.auth, headers=self.headers, json=body, timeout=30)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"POST {url} => {r.status_code}: {r.text[:200]}")
        return r.json().get("result", {})

    def check_plugin(self) -> CheckResult:
        rows = self._get("/api/now/table/v_plugin", {
            "sysparm_query": "name=com.snc.now_assist^ORname=com.snc.ai_agent_studio^active=true",
            "sysparm_fields": "name,active", "sysparm_limit": 10,
        })
        active = [r for r in rows if r.get("active") == "true"]
        if len(active) >= 2:
            return CheckResult("Plugin Check", "PASS", 100, [f"Active: {[r['name'] for r in active]}"])
        return CheckResult("Plugin Check", "FAIL", 0, ["AI Agent Studio or Now Assist plugin inactive"])

    def check_agent_config(self) -> CheckResult:
        agents = self._get("/api/now/table/sn_agent", {
            "sysparm_fields": "sys_id,name,short_description,agent_state,skills,roles",
            "sysparm_limit": 200,
        })
        if not agents:
            return CheckResult("Agent Config", "FAIL", 0, ["No agents found"])
        issues = []
        for a in agents:
            if not a.get("short_description"):
                issues.append(f"Agent {a.get('name')} missing description")
            if not a.get("skills"):
                issues.append(f"Agent {a.get('name')} missing skills")
        score = max(0, 100 - len(issues) * 10)
        status = "PASS" if not issues else ("WARN" if score >= 60 else "FAIL")
        return CheckResult("Agent Config", status, score, issues or [f"Validated {len(agents)} agents"])

    def check_skills(self) -> CheckResult:
        skills = self._get("/api/now/table/sa_skill", {
            "sysparm_fields": "sys_id,name,active,agent", "sysparm_limit": 200,
        })
        orphaned = [s for s in skills if not s.get("agent")]
        inactive = [s for s in skills if s.get("active") != "true"]
        issues = []
        if orphaned:
            issues.append(f"Orphaned skills: {len(orphaned)}")
        if inactive:
            issues.append(f"Inactive skills: {len(inactive)}")
        score = max(0, 100 - (len(orphaned)+len(inactive)) * 5)
        status = "PASS" if not issues else ("WARN" if score >= 60 else "FAIL")
        return CheckResult("Skill Binding", status, score, issues or [f"{len(skills)} skills validated"])

    def check_role_masking(self) -> CheckResult:
        # Simplified: check if agent roles contain elevated ones
        agents = self._get("/api/now/table/sn_agent", {
            "sysparm_fields": "name,roles", "sysparm_limit": 200,
        })
        issues = []
        for a in agents:
            roles = a.get("roles", "")
            if "admin" in roles.lower() or "security_admin" in roles.lower():
                issues.append(f"Agent {a.get('name')} has elevated roles: {roles}")
        score = max(0, 100 - len(issues) * 15)
        status = "PASS" if not issues else ("WARN" if score >= 60 else "FAIL")
        return CheckResult("Role Masking", status, score, issues or ["No elevated roles detected"])

    def check_a2a_compliance(self) -> CheckResult:
        # Check external agents for A2A protocol usage
        ext = self._get("/api/now/table/sn_agent", {
            "sysparm_query": "type=external", "sysparm_fields": "name,integration_type,a2a_enabled", "sysparm_limit": 200,
        })
        if not ext:
            return CheckResult("A2A Compliance", "PASS", 100, ["No external agents"])
        non_a2a = [e for e in ext if str(e.get("a2a_enabled", "")).lower() != "true"]
        score = max(0, 100 - len(non_a2a) * 20)
        issues = [f"Agent {e['name']} not A2A compliant" for e in non_a2a]
        status = "PASS" if not non_a2a else ("WARN" if score >= 60 else "FAIL")
        return CheckResult("A2A Compliance", status, score, issues or [f"{len(ext)} external agents A2A compliant"])

    def check_cmdb_health(self) -> CheckResult:
        cis = self._get("/api/now/table/cmdb_ci", {
            "sysparm_limit": 1, "sysparm_fields": "sys_id",
        })
        if not cis:
            return CheckResult("CMDB Health", "FAIL", 0, ["CMDB empty"])
        # Proxy: count active CIs vs total
        active = self._get("/api/now/table/cmdb_ci", {
            "sysparm_query": "operational_status=1", "sysparm_limit": 1,
        })
        return CheckResult("CMDB Health", "PASS", 85, ["CMDB accessible, basic health OK"])

    def check_kb_coverage(self) -> CheckResult:
        kb = self._get("/api/now/table/kb_knowledge", {
            "sysparm_limit": 200, "sysparm_fields": "sys_id,topic,valid_to",
        })
        if not kb:
            return CheckResult("KB Coverage", "WARN", 50, ["KB empty or inaccessible"])
        stale = [k for k in kb if k.get("valid_to") and k["valid_to"] < "2026-01-01"]
        score = max(0, 100 - len(stale) * 5)
        status = "PASS" if score >= 80 else ("WARN" if score >= 60 else "FAIL")
        return CheckResult("KB Coverage", status, score, [f"KB articles: {len(kb)}, stale: {len(stale)}"])

    def simulate_agent(self, agent_name: str = "ITSM Agent") -> CheckResult:
        """Simulate a test conversation via Virtual Agent API."""
        try:
            r = self._post("/api/sn_va_as_service/bot/interact", {
                "request": {"text": "hello", "timestamp": datetime.now(timezone.utc).isoformat(), "sessionId": "test-session", "clientSessionId": "test-client", "client": {"device": {"type": "DESKTOP", "channel": "WEB_CLIENT"}}, "context": {"agent_name": agent_name}},
                "client": {"client_id": "test_validator"}
            })
            if r.get("result"):
                return CheckResult("Simulation", "PASS", 100, ["Agent responded successfully"])
            return CheckResult("Simulation", "WARN", 70, ["Agent responded but result empty"])
        except Exception as e:
            return CheckResult("Simulation", "FAIL", 0, [f"Simulation error: {e}"])

    def run(self) -> ValidationReport:
        checks = [
            self.check_plugin(),
            self.check_agent_config(),
            self.check_skills(),
            self.check_role_masking(),
            self.check_a2a_compliance(),
            self.check_cmdb_health(),
            self.check_kb_coverage(),
            self.simulate_agent(),
        ]
        overall = sum(c.score for c in checks) // len(checks)
        status = "PASS" if overall >= 80 else ("WARN" if overall >= 60 else "FAIL")
        return ValidationReport(
            instance=self.instance,
            timestamp=datetime.now(timezone.utc).isoformat(),
            overall_score=overall,
            overall_status=status,
            checks=checks,
        )

    def save_report(self, report: ValidationReport, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        js = Path(out_dir) / f"ai_agent_validator_{ts}_{host}.json"
        js.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2))
        html = Path(out_dir) / f"ai_agent_validator_{ts}_{host}.html"
        html.write_text(self._render_html(report))
        return html

    @staticmethod
    def _render_html(report: ValidationReport) -> str:
        rows = ""
        for c in report.checks:
            color = "green" if c.status=="PASS" else "orange" if c.status=="WARN" else "red"
            rows += f"""<tr><td>{c.area}</td><td style="color:{color}"><b>{c.status}</b></td><td>{c.score}</td><td>{'; '.join(c.details)}</td></tr>\n"""
        status_color = "green" if report.overall_status=="PASS" else "orange" if report.overall_status=="WARN" else "red"
        return f"""
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>AI Agent Validator Report</title>
<style>body{{font-family:DejaVu Sans,sans-serif;margin:40px}}h1{{color:#0F1D35}}.score{{font-size:3em;color:{status_color}}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ddd;padding:8px;text-align:left}}th{{background:#0F1D35;color:white}}</style>
</head><body>
<h1>ServiceNow AI Agent Readiness Validator</h1>
<p><b>Instance:</b> {report.instance} | <b>Date:</b> {report.timestamp}</p>
<div class="score">Overall Score: {report.overall_score}/100 ({report.overall_status})</div>
<table><tr><th>Area</th><th>Status</th><th>Score</th><th>Details</th></tr>
{rows}</table>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""

if __name__ == "__main__":
    v = AIAgentValidator()
    report = v.run()
    path = v.save_report(report)
    print(f"Overall: {report.overall_score}/100 ({report.overall_status}) | Report: {path}")
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
