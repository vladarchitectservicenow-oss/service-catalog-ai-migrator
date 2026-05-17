#!/usr/bin/env python3
"""
panel_fixer.py — SN NowAssist Panel Fixer
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

REQUIRED_UX_LIBS = {"autosize.js", "lodash.js", "jQuery.js"}

@dataclass
class UXAsset:
    sys_id: str
    name: str
    type: str
    present: bool
    fix_script: str

@dataclass
class PanelFixerReport:
    instance: str
    timestamp: str
    missing_assets: int
    assets: List[UXAsset]

class PanelFixer:
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

    def scan_ux_libs(self) -> List[dict]:
        return self._get("/api/now/table/sys_ux_lib", {
            "sysparm_fields": "sys_id,name", "sysparm_limit": 500,
            "sysparm_query": "nameIN" + ",".join(REQUIRED_UX_LIBS),
        })

    def scan_ui_scripts(self) -> List[dict]:
        return self._get("/api/now/table/sys_ui_script", {
            "sysparm_fields": "sys_id,name,script", "sysparm_limit": 500,
            "sysparm_query": "nameLIKEautosize^ORnameLIKEnow assist",
        })

    def run(self) -> PanelFixerReport:
        found = {r.get("name") for r in self.scan_ux_libs()}
        missing = REQUIRED_UX_LIBS - found
        assets = []
        for name in missing:
            assets.append(UXAsset(
                sys_id="", name=name, type="ux_lib", present=False,
                fix_script=f"gs.info('Installing {name}...');\n// Use ServiceNow Store or upload via Update Set",
            ))
        for name in found:
            assets.append(UXAsset(
                sys_id="", name=name, type="ux_lib", present=True,
                fix_script="// Already present, no action needed",
            ))
        return PanelFixerReport(
            instance=self.instance,
            timestamp=datetime.now(timezone.utc).isoformat(),
            missing_assets=len(missing),
            assets=assets,
        )

    def save_report(self, report: PanelFixerReport, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        js = Path(out_dir) / f"panel_fixer_{ts}_{host}.json"
        js.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2))
        html = Path(out_dir) / f"panel_fixer_{ts}_{host}.html"
        html.write_text(self._render_html(report))
        return html

    @staticmethod
    def _render_html(report: PanelFixerReport) -> str:
        rows = ""
        for a in report.assets:
            color = "green" if a.present else "red"
            rows += f"""<tr><td>{a.name}</td><td>{a.type}</td><td style="color:{color}"><b>{ 'OK' if a.present else 'MISSING' }</b></td><td><pre>{a.fix_script}</pre></td></tr>\n"""
        return f"""
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Panel Fixer</title>
<style>body{{font-family:DejaVu Sans;margin:40px}}h1{{color:#0F1D35}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ddd;padding:8px}}th{{background:#0F1D35;color:white}}pre{{white-space:pre-wrap;font-size:0.9em;background:#f6f6f6;padding:8px;border-radius:4px}}</style>
</head><body>
<h1>NowAssist Panel Fixer Report</h1>
<p><b>Instance:</b> {report.instance} | <b>Missing:</b> {report.missing_assets}</p>
<table><tr><th>Name</th><th>Type</th><th>Status</th><th>Fix</th></tr>
{rows}</table>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""

if __name__ == "__main__":
    f = PanelFixer()
    report = f.run()
    path = f.save_report(report)
    print(f"Missing assets: {report.missing_assets} | Report: {path}")
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
