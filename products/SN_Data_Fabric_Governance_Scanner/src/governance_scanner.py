#!/usr/bin/env python3
"""
SN Data Fabric Governance Scanner
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, requests
from typing import List, Dict, Optional
from collections import Counter


class GovernanceScanner:
    BENCHMARK = {
        "min_classes": 5,
        "max_orphan_ratio": 0.1,
        "max_duplicate_ratio": 0.05,
        "required_fields": ["name", "sys_class_name", "operational_status"],
    }

    def __init__(self, instance_url: str, username: str, password: str):
        self.instance_url = instance_url.rstrip("/")
        self.username = username
        self.password = password

    def fetch_cmdb(self, limit: int = 500) -> List[Dict]:
        url = f"{self.instance_url}/api/now/table/cmdb_ci"
        try:
            resp = requests.get(url, params={"sysparm_limit": limit, "sysparm_display_value": "false"},
                                auth=(self.username, self.password),
                                headers={"Accept": "application/json"}, timeout=30)
            resp.raise_for_status()
            return resp.json().get("result", [])
        except Exception:
            return []

    def analyze(self, records: List[Dict]) -> Dict:
        total = len(records)
        if total == 0:
            return {"total": 0, "score": 0, "orphans": [], "duplicates": [], "missing_fields": []}

        orphans = [r for r in records if not r.get("sys_class_name")]
        names = Counter((r.get("name"), r.get("sys_class_name")) for r in records if r.get("name"))
        duplicates = [name for name, count in names.items() if count > 1]
        missing = [r["sys_id"] for r in records if any(not r.get(f) for f in self.BENCHMARK["required_fields"])]

        score = 100.0
        if total:
            score -= (len(orphans)/total)*50
            score -= min(len(duplicates)/max(total,1)*200, 20)
            score -= (len(missing)/total)*30
        score = max(0, round(score, 1))

        return {
            "total": total,
            "score": score,
            "orphans": orphans,
            "orphan_count": len(orphans),
            "duplicates": duplicates,
            "duplicate_count": len(duplicates),
            "missing_fields": missing,
            "missing_count": len(missing),
            "class_distribution": dict(Counter(r.get("sys_class_name","Unknown") for r in records))
        }

    def filter_by_class(self, records: List[Dict], class_name: str) -> List[Dict]:
        return [r for r in records if r.get("sys_class_name") == class_name]

    def generate_reports(self, analysis: Dict, prefix: str):
        jpath = f"{prefix}.json"
        mpath = f"{prefix}.md"
        with open(jpath, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        lines = [
            "# Data Fabric Governance Report",
            f"**Score:** {analysis['score']}/100",
            "",
            f"- Total CIs: {analysis['total']}",
            f"- Orphans: {analysis['orphan_count']}",
            f"- Duplicates: {analysis['duplicate_count']}",
            f"- Missing required fields: {analysis['missing_count']}",
            "",
            "## Class Distribution",
        ]
        for cls, cnt in analysis.get("class_distribution", {}).items():
            lines.append(f"- `{cls}`: {cnt}")
        with open(mpath, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return analysis

    def run(self, output_prefix: str, class_filter: Optional[str] = None) -> Dict:
        records = self.fetch_cmdb()
        if class_filter:
            records = self.filter_by_class(records, class_filter)
        analysis = self.analyze(records)
        return self.generate_reports(analysis, output_prefix)
