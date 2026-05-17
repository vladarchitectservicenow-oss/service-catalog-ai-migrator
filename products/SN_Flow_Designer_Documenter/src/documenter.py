#!/usr/bin/env python3
"""
SN Flow Designer Documenter
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, requests
from typing import List, Dict


class FlowDocumenter:
    TABLES = {
        "flows": "sys_hub_flow",
        "actions": "sys_hub_action_type_definition",
        "subflows": "sys_hub_flow_logic",
    }

    def __init__(self, instance_url: str, username: str, password: str):
        self.instance_url = instance_url.rstrip("/")
        self.username = username
        self.password = password

    def _fetch(self, table: str, limit: int = 100) -> List[Dict]:
        url = f"{self.instance_url}/api/now/table/{table}"
        try:
            resp = requests.get(url, params={"sysparm_limit": limit, "sysparm_display_value": "false"},
                                auth=(self.username, self.password),
                                headers={"Accept": "application/json"}, timeout=30)
            resp.raise_for_status()
            return resp.json().get("result", [])
        except Exception:
            return []

    def fetch_custom_actions(self) -> List[Dict]:
        raw = self._fetch(self.TABLES["actions"])
        out = []
        for r in raw:
            out.append({
                "sys_id": r.get("sys_id"),
                "name": r.get("name", "Unnamed"),
                "description": r.get("description", ""),
                "active": r.get("active", "true")
            })
        return out

    def fetch_flows(self) -> List[Dict]:
        raw = self._fetch(self.TABLES["flows"])
        out = []
        for r in raw:
            out.append({
                "sys_id": r.get("sys_id"),
                "name": r.get("name", "Unnamed"),
                "description": r.get("description", ""),
                "active": r.get("active", "true"),
                "internal_name": r.get("internal_name", "")
            })
        return out

    @staticmethod
    def extract_inputs(action: Dict) -> List[str]:
        """Parse action JSON for input variables."""
        # Mock heuristic — in real scenario would inspect action designer JSON
        return []

    @staticmethod
    def extract_outputs(action: Dict) -> List[str]:
        return []

    def generate_markdown(self, actions: List[Dict], flows: List[Dict]) -> str:
        lines = ["# Flow Designer Documentation", ""]
        lines.append(f"## Custom Actions ({len(actions)})")
        for a in actions:
            lines.append(f"\n### {a['name']}")
            lines.append(f"- **Active:** {a['active']}")
            lines.append(f"- **Description:** {a['description'] or '*No description*'}")
            if not a["description"]:
                lines.append(f"- ⚠️ **Warning:** Missing documentation")
        lines.append(f"\n## Flows ({len(flows)})")
        for f in flows:
            lines.append(f"\n### {f['name']}")
            lines.append(f"- **Internal name:** `{f['internal_name']}`")
            lines.append(f"- **Active:** {f['active']}")
        return "\n".join(lines)

    def generate_json(self, actions: List[Dict], flows: List[Dict]) -> Dict:
        return {
            "meta": {"actions_count": len(actions), "flows_count": len(flows)},
            "actions": actions,
            "flows": flows,
            "warnings": [a["name"] for a in actions if not a["description"]]
        }

    def run(self, output_prefix: str):
        actions = self.fetch_custom_actions()
        flows = self.fetch_flows()
        md = self.generate_markdown(actions, flows)
        data = self.generate_json(actions, flows)
        with open(f"{output_prefix}.md", "w", encoding="utf-8") as f:
            f.write(md)
        with open(f"{output_prefix}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return data
