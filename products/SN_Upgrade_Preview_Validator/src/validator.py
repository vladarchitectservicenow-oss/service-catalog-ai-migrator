#!/usr/bin/env python3
"""
ServiceNow Upgrade Preview Validator
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, hashlib, re, requests
from typing import List, Dict, Optional


class UpgradePreviewValidator:
    """Fetch skipped records, diff against baseline, emit report."""

    def __init__(self, instance_url: str, username: str, password: str):
        self.instance_url = instance_url.rstrip("/")
        self.username = username
        self.password = password

    def fetch_skipped_records(self) -> List[Dict]:
        """Return sys_upgrade_history_log entries with type=skipped."""
        url = f"{self.instance_url}/api/now/table/sys_upgrade_history_log"
        params = {
            "sysparm_query": "type=skip^ORtype=skipped",
            "sysparm_limit": 5000,
            "sysparm_display_value": "false",
            "sysparm_fields": "sys_id,target_name,table_name,payload,type,status"
        }
        resp = requests.get(
            url,
            params=params,
            auth=(self.username, self.password),
            headers={"Accept": "application/json"},
            timeout=60
        )
        resp.raise_for_status()
        data = resp.json().get("result", [])
        return data

    @staticmethod
    def load_baseline(path: Optional[str]) -> Dict:
        """Load baseline snapshot keyed by sys_id."""
        if not path:
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception:
            return {}
        out = {}
        for item in raw if isinstance(raw, list) else raw.get("records", []):
            sid = item.get("sys_id") or item.get("record_id")
            if sid:
                out[sid] = item
        return out

    @staticmethod
    def hash_payload(payload: str) -> str:
        """SHA-256 hash of normalized XML/JSON payload string."""
        if not payload:
            return ""
        norm = re.sub(r"\s+", " ", payload.strip())
        return hashlib.sha256(norm.encode()).hexdigest()[:32]

    def compute_delta(self, skipped: List[Dict], baseline: Dict) -> Dict:
        """added, removed, modified, safe."""
        current_ids = {r.get("sys_id", r.get("record_id", "")): r for r in skipped}
        baseline_ids = set(baseline.keys())
        current_set = set(current_ids.keys())

        added = [current_ids[sid] for sid in (current_set - baseline_ids) if sid]
        removed = [baseline[sid] for sid in (baseline_ids - current_set) if sid]
        modified = []
        safe = []
        for sid in current_set & baseline_ids:
            if not sid:
                continue
            cur_hash = self.hash_payload(current_ids[sid].get("payload", ""))
            base_hash = self.hash_payload(baseline[sid].get("payload", ""))
            if cur_hash != base_hash:
                modified.append(current_ids[sid])
            else:
                safe.append(current_ids[sid])

        return {"added": added, "removed": removed, "modified": modified, "safe": safe}

    def generate_reports(self, delta: Dict, output_prefix: str) -> Dict:
        """Write JSON report and Markdown report."""
        json_path = f"{output_prefix}.json"
        md_path = f"{output_prefix}.md"
        report = {
            "summary": {
                "added": len(delta["added"]),
                "removed": len(delta["removed"]),
                "modified": len(delta["modified"]),
                "safe": len(delta["safe"])
            },
            "details": delta
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        lines = [
            "# ServiceNow Upgrade Preview Delta Report",
            f"Generated: __now__",
            "",
            "| Category | Count |",
            "|----------|-------|",
            f"| Added    | {len(delta['added'])} |",
            f"| Removed  | {len(delta['removed'])} |",
            f"| Modified | {len(delta['modified'])} |",
            f"| Safe     | {len(delta['safe'])} |",
            "",
            "## Added",
        ]
        for r in delta["added"]:
            name = r.get("target_name", "N/A")
            tbl = r.get("table_name", "N/A")
            lines.append(f"- **{name}** (`{tbl}`)")
        lines.append("\n## Modified")
        for r in delta["modified"]:
            name = r.get("target_name", "N/A")
            tbl = r.get("table_name", "N/A")
            lines.append(f"- **{name}** (`{tbl}`)")
        lines.append("\n## Safe (unchanged)")
        for r in delta["safe"]:
            name = r.get("target_name", "N/A")
            lines.append(f"- {name}")

        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        return report

    def run(self, baseline_path: Optional[str], output_prefix: str, table_filter: Optional[str] = None) -> Dict:
        skipped = self.fetch_skipped_records()
        if table_filter:
            skipped = [r for r in skipped if r.get("table_name") == table_filter]
        baseline = self.load_baseline(baseline_path)
        delta = self.compute_delta(skipped, baseline)
        return self.generate_reports(delta, output_prefix)
