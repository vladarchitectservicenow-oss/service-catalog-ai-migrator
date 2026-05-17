#!/usr/bin/env python3
"""
migrator.py — SN Platform Analytics Migrator
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import json, os
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict

import requests

DEFAULT_INSTANCE = "https://dev362840.service-now.com"
DEFAULT_USER = "admin"
DEFAULT_PASS = os.environ.get("SN_PASSWORD", "7%%gXJzImsW7")

REPORT_TYPE_MAP = {
    "list": {"type": "list", "supported": True},
    "bar": {"type": "bar", "supported": True},
    "pie": {"type": "pie", "supported": True},
    "line": {"type": "line", "supported": True},
    "pivot": {"type": "pivot", "supported": True},
    "map": {"type": "map", "supported": False},
    "calendar": {"type": "calendar", "supported": False},
    "gauge": {"type": "gauge", "supported": False},
}

@dataclass
class ReportMapping:
    sys_id: str
    name: str
    source_type: str
    target_type: str
    supported: bool
    table: str
    filter: str
    group_by: Optional[str]
    issues: List[str] = field(default_factory=list)

@dataclass
class MigrationReport:
    instance: str
    timestamp: str
    total_reports: int
    mappable: int
    unmappable: int
    mappings: List[ReportMapping]
    export_json: dict

class PlatformAnalyticsMigrator:
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

    def check_plugin(self) -> dict:
        rows = self._get("/api/now/table/v_plugin", {
            "sysparm_query": "name=com.snc.pa^ORname=com.snc.platform_analytics^active=true",
            "sysparm_fields": "name,active", "sysparm_limit": 10,
        })
        return {"plugin_active": len(rows) > 0, "plugins": rows}

    def list_reports(self, limit: int = 500) -> List[dict]:
        return self._get("/api/now/table/sys_report", {
            "sysparm_limit": limit,
            "sysparm_fields": "sys_id,title,type,table,filter,group_by,chart_size,aggregation,sum_field,order_by",
            "sysparm_query": "active=true",
        })

    def list_dashboards(self, limit: int = 500) -> List[dict]:
        return self._get("/api/now/table/pa_dashboards", {
            "sysparm_limit": limit,
            "sysparm_fields": "sys_id,name,owner,active",
        })

    def map_report(self, rep: dict) -> ReportMapping:
        src_type = rep.get("type", "list")
        mapping = REPORT_TYPE_MAP.get(src_type, {"type": src_type, "supported": False})
        issues = []
        if not mapping["supported"]:
            issues.append(f"Visualization type '{src_type}' not supported in Platform Analytics")
        if not rep.get("table"):
            issues.append("Missing target table")
        return ReportMapping(
            sys_id=rep.get("sys_id", ""),
            name=rep.get("title") or rep.get("name", "untitled"),
            source_type=src_type,
            target_type=mapping["type"],
            supported=mapping["supported"],
            table=rep.get("table", ""),
            filter=rep.get("filter", ""),
            group_by=rep.get("group_by"),
            issues=issues,
        )

    def generate_pa_config(self, mapping: ReportMapping) -> dict:
        return {
            "sys_id": mapping.sys_id,
            "name": mapping.name,
            "type": mapping.target_type,
            "table": mapping.table,
            "filter": mapping.filter,
            "group_by": mapping.group_by,
            "source": "legacy_migration",
            "supported": mapping.supported,
        }

    def run(self, limit: int = 500) -> MigrationReport:
        reports = self.list_reports(limit)
        dashboards = self.list_dashboards(limit)
        mappings = [self.map_report(r) for r in reports]
        mappable = sum(1 for m in mappings if m.supported)
        unmappable = len(mappings) - mappable
        export = {
            "version": "1.0",
            "source_instance": self.instance,
            "reports": [self.generate_pa_config(m) for m in mappings if m.supported],
            "dashboards": [{"sys_id": d.get("sys_id"), "name": d.get("name")} for d in dashboards],
        }
        return MigrationReport(
            instance=self.instance,
            timestamp=datetime.now(timezone.utc).isoformat(),
            total_reports=len(mappings),
            mappable=mappable,
            unmappable=unmappable,
            mappings=mappings,
            export_json=export,
        )

    def save_report(self, report: MigrationReport, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        js = Path(out_dir) / f"pa_migrator_{ts}_{host}.json"
        js.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2, default=lambda o: o.__dict__))
        html = Path(out_dir) / f"pa_migrator_{ts}_{host}.html"
        html.write_text(self._render_html(report))
        return html

    @staticmethod
    def _render_html(report: MigrationReport) -> str:
        rows = ""
        for m in report.mappings:
            color = "green" if m.supported else "red"
            rows += f"""<tr><td>{m.name}</td><td>{m.source_type}</td><td>{m.target_type}</td><td style="color:{color}"><b>{ 'YES' if m.supported else 'NO' }</b></td><td>{'; '.join(m.issues)}</td></tr>\n"""
        return f"""
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PA Migrator Report</title>
<style>body{{font-family:DejaVu Sans;margin:40px}}h1{{color:#0F1D35}}.summary{{font-size:1.2em;margin-bottom:20px}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ddd;padding:8px}}th{{background:#0F1D35;color:white}}</style>
</head><body>
<h1>ServiceNow Platform Analytics Migration Report</h1>
<div class="summary"><b>Instance:</b> {report.instance} | <b>Reports:</b> {report.total_reports} | <b>Mappable:</b> {report.mappable} | <b>Unmappable:</b> {report.unmappable}</div>
<table><tr><th>Name</th><th>Source</th><th>Target</th><th>Supported</th><th>Issues</th></tr>
{rows}</table>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""


if __name__ == "__main__":
    m = PlatformAnalyticsMigrator()
    report = m.run()
    path = m.save_report(report)
    print(f"Reports: {report.total_reports} | Mappable: {report.mappable} | Unmappable: {report.unmappable} | Report: {path}")
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, default=lambda o: o.__dict__))
