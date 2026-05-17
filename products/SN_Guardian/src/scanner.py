#!/usr/bin/env python3
"""
scanner.py — SN Guardian: ServiceNow Guarded Script Scanner
Uses regex-based JS analysis — no external JS parser needed.
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import json, os, re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

import requests

DEFAULT_INSTANCE = "https://dev362840.service-now.com"
DEFAULT_USER = "admin"
DEFAULT_PASS = os.environ.get("SN_PASSWORD", "7%%gXJzImsW7")

# Allowed APIs in Guarded Script (exact method names)
ALLOWED_APIS = {
    # gs methods
    "gs.getUserID", "gs.getUserName", "gs.getUserDisplayName", "gs.getUser",
    "gs.getSession", "gs.dateGenerate", "gs.daysAgo", "gs.daysAgoEnd", "gs.daysAgoStart",
    "gs.endOfLastMonth", "gs.endOfLastWeek", "gs.endOfLastYear", "gs.endOfNextMonth",
    "gs.endOfNextWeek", "gs.endOfNextYear", "gs.endOfThisMonth", "gs.endOfThisWeek",
    "gs.endOfThisYear", "gs.monthsAgo", "gs.monthsAgoEnd", "gs.monthsAgoStart",
    "gs.quartersAgo", "gs.quartersAgoEnd", "gs.quartersAgoStart", "gs.startOfLastMonth",
    "gs.startOfLastWeek", "gs.startOfLastYear", "gs.startOfNextMonth", "gs.startOfNextWeek",
    "gs.startOfNextYear", "gs.startOfThisMonth", "gs.startOfThisWeek", "gs.startOfThisYear",
    "gs.today", "gs.yesterday", "gs.weeksAgo", "gs.weeksAgoEnd", "gs.weeksAgoStart",
    "gs.yearsAgo", "gs.yearsAgoEnd", "gs.yearsAgoStart",
    # current / parent methods
    "current.getDisplayValue", "current.getUniqueValue", "current.getValue", "current.isValidRecord",
    "parent.getDisplayValue", "parent.getUniqueValue", "parent.getValue", "parent.isValidRecord",
    # GlideDate
    "getValue", "setValue", "getDisplayValue", "getLocalTime", "getDayOfMonth", "getMonth", "getYear",
    # String / Math / JSON / Array built-ins accessible in guarded script
}

# Regex patterns for forbidden constructs
FORBIDDEN_PATTERNS = [
    ("variable declaration", re.compile(r'\bvar\b|\blet\b|\bconst\b')),
    ("if statement", re.compile(r'\bif\s*\(')),
    ("for loop", re.compile(r'\bfor\s*\(')),
    ("while loop", re.compile(r'\bwhile\s*\(')),
    ("do-while loop", re.compile(r'\bdo\s*\{')),
    ("function definition", re.compile(r'\bfunction\s+\w+\s*\(')),
    ("try/catch", re.compile(r'\btry\s*\{|\bcatch\s*\(')),
    ("throw", re.compile(r'\bthrow\b')),
    ("switch", re.compile(r'\bswitch\s*\(')),
    ("class definition", re.compile(r'\bclass\s+\w+')),
    ("arrow function", re.compile(r'=>')),
    ("template literal", re.compile(r'`[^`]*\$\{')),
    ("spread operator", re.compile(r'\.\.\.')),
    ("import statement", re.compile(r'\bimport\b|\brequire\s*\(')),
]

# Regex for allowed API calls (allow dot-chain calls)
API_CALL_RE = re.compile(r'\b(gs|current|parent)\.(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.)*[a-zA-Z_$][a-zA-Z0-9_$]*')


@dataclass
class ScriptResult:
    sys_id: str
    name: str
    table: str
    script: str
    status: str          # COMPATIBLE, INCOMPATIBLE, WARNING, ERROR
    reasons: List[str]
    suggested_action: str


@dataclass
class ScanReport:
    instance: str
    total: int
    compatible: int
    incompatible: int
    warning: int
    scripts: List[ScriptResult]
    phase_info: dict
    timestamp: str


class GuardedScriptScanner:
    def __init__(self, instance: str = DEFAULT_INSTANCE, user: str = DEFAULT_USER, password: str = DEFAULT_PASS):
        self.instance = instance.rstrip("/")
        self.auth = (user, password)
        self.headers = {"Accept": "application/json", "Content-Type": "application/json"}

    def _get(self, endpoint: str, params: Optional[dict] = None) -> dict:
        url = f"{self.instance}{endpoint}"
        r = requests.get(url, auth=self.auth, headers=self.headers, params=params, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"GET {url} => {r.status_code}: {r.text[:200]}")
        return r.json().get("result", [])

    def list_scripts(self, limit: int = 500) -> List[dict]:
        scripts = []
        # Business rules (execute server-side)
        params = {
            "sysparm_limit": limit,
            "sysparm_fields": "sys_id,name,sys_name,collection,when,script",
            "sysparm_query": "active=true",
        }
        for row in self._get("/api/now/table/sys_script", params):
            scripts.append({
                "sys_id": row.get("sys_id", ""),
                "name": row.get("name") or row.get("sys_name", "untitled"),
                "table": row.get("collection", "global"),
                "type": "business_rule",
                "script": row.get("script", ""),
            })
        # UI Policies — server script true/false
        params_ui = {
            "sysparm_limit": limit,
            "sysparm_fields": "sys_id,short_description,table,script_true,script_false",
            "sysparm_query": "active=true",
        }
        for row in self._get("/api/now/table/sys_ui_policy", params_ui):
            for field in ("script_true", "script_false"):
                s = row.get(field, "")
                if s and s.strip():
                    scripts.append({
                        "sys_id": row.get("sys_id", "") + f"_{field}",
                        "name": (row.get("short_description") or "untitled") + f" [{field}]",
                        "table": row.get("table", "global"),
                        "type": "ui_policy",
                        "script": s,
                    })
        return scripts

    def analyze(self, script: str) -> ScriptResult:
        reasons = []
        status = "COMPATIBLE"
        stripped = script.strip()
        if not stripped:
            return ScriptResult(
                sys_id="", name="", table="", script=script, status="COMPATIBLE",
                reasons=[], suggested_action="No action needed"
            )

        for reason_pattern, pattern_re in FORBIDDEN_PATTERNS:
            if pattern_re.search(script):
                reasons.append(reason_pattern)
                status = "INCOMPATIBLE"

        # Check API calls against whitelist
        for match in API_CALL_RE.finditer(script):
            full_call = match.group(0)
            # Normalize: gs.getUserID() -> gs.getUserID
            base = full_call.split("(")[0].strip(".")
            if base not in ALLOWED_APIS:
                reasons.append(f"Potentially forbidden API call: {base}")
                if status != "INCOMPATIBLE":
                    status = "WARNING"

        suggested = self._suggest_action(status, reasons, script)
        return ScriptResult(
            sys_id="", name="", table="", script=script, status=status,
            reasons=reasons, suggested_action=suggested
        )

    @staticmethod
    def _suggest_action(status: str, reasons: List[str], script: str) -> str:
        if status == "INCOMPATIBLE":
            return "Migrate complex logic to Script Include with 'Sandbox enabled' option"
        if status == "WARNING":
            return "Verify API usage against GlideGuardedScript whitelist"
        return "No action needed"

    def fetch_phase_info(self) -> dict:
        try:
            props = self._get("/api/now/table/sys_properties", {
                "sysparm_query": "nameSTARTSWITHglide.guarded.script",
                "sysparm_fields": "name,value,description"
            })
            phase = "unknown"
            for p in props:
                if p.get("name") == "glide.guarded.script.phase":
                    phase = p.get("value", "unknown")
            return {"glide.guarded.script.phase": phase, "properties": props}
        except Exception as e:
            return {"error": str(e)}

    def run(self, limit: int = 500) -> ScanReport:
        from datetime import datetime
        raw = self.list_scripts(limit)
        results = []
        compat = incomp = warn = 0
        for s in raw:
            res = self.analyze(s["script"])
            res.sys_id = s["sys_id"]
            res.name = s["name"]
            res.table = f"{s['table']}::{s['type']}"
            results.append(res)
            if res.status == "COMPATIBLE": compat += 1
            elif res.status == "INCOMPATIBLE": incomp += 1
            elif res.status == "WARNING": warn += 1
        phase_info = self.fetch_phase_info()
        return ScanReport(
            instance=self.instance, total=len(results), compatible=compat,
            incompatible=incomp, warning=warn, scripts=results,
            phase_info=phase_info, timestamp=datetime.utcnow().isoformat()
        )

    @staticmethod
    def generate_script_include(script_result: ScriptResult) -> str:
        safe_name = re.sub(r'[^a-zA-Z0-9_]', '_', script_result.name)[:40]
        return f"""var GuardedScript_{safe_name} = Class.create();
GuardedScript_{safe_name}.prototype = Object.extendsObject(AbstractAjaxProcessor, {{
    process: function() {{
        // Migrated from {script_result.name}
        // NOTE: Complex logic extracted to Script Include
        {script_result.script.replace(chr(10), chr(10)+'        ')}
    }},
    type: 'GuardedScript_{safe_name}'
}});
"""

    @staticmethod
    def save_report(report: ScanReport, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        # JSON
        js_path = Path(out_dir) / f"report_{ts}_{host}.json"
        js_path.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2))
        # HTML
        html = GuardedScriptScanner._render_html(report)
        html_path = Path(out_dir) / f"report_{ts}_{host}.html"
        html_path.write_text(html)
        return html_path

    @staticmethod
    def _render_html(report: ScanReport) -> str:
        rows = ""
        for s in report.scripts:
            status_color = "green" if s.status == "COMPATIBLE" else "red" if s.status == "INCOMPATIBLE" else "orange"
            rows += f"""
<tr>
<td>{s.sys_id}</td><td>{s.name}</td><td>{s.table}</td>
<td style="color:{status_color}"><b>{s.status}</b></td>
<td>{'; '.join(s.reasons)}</td>
<td>{s.suggested_action}</td>
</tr>
"""
        return f"""
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>SN Guardian Report</title>
<style>body{{font-family:DejaVu Sans,sans-serif;margin:40px}}h1{{color:#0F1D35}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ddd;padding:8px;text-align:left}}th{{background:#0F1D35;color:white}}</style>
</head><body>
<h1>ServiceNow Guarded Script Migration Report</h1>
<p><b>Instance:</b> {report.instance} | <b>Date:</b> {report.timestamp}</p>
<p><b>Summary:</b> Total {report.total} | Compatible {report.compatible} | Incompatible {report.incompatible} | Warnings {report.warning}</p>
<table><tr><th>ID</th><th>Name</th><th>Table/Type</th><th>Status</th><th>Reasons</th><th>Action</th></tr>
{rows}</table>
<h2>Phase Info</h2><pre>{json.dumps(report.phase_info, indent=2)}</pre>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""


def main():
    scanner = GuardedScriptScanner()
    report = scanner.run(limit=100)
    path = scanner.save_report(report)
    print(f"Report saved to {path}")
    print(f"Summary: {report.total} scripts | {report.compatible} compatible | {report.incompatible} incompatible | {report.warning} warnings")
    print(json.dumps({"report_path": str(path), "summary": asdict(report)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
