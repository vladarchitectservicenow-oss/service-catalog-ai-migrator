#!/usr/bin/env python3
"""
SN CSA Exam Drift Detector
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, requests
from typing import Dict, List, Optional


SYLLABUS = {
    "zurich": {
        "categories": {
            "platform_architecture": ["Instance architecture", "Application scope", "Script includes", "Business rules"],
            "data_modeling": ["Tables and fields", "Dictionary overrides", "Reference fields", "CMDB classes"],
            "automation": ["Flow designer", "Workflows", "Scheduled jobs", "Notifications"],
            "security": ["User roles", "ACLs", "Impersonation", "SSO integration"],
            "integration": ["REST API", "SOAP", "OAuth", "MID server"],
            "ui": ["UI policies", "Client scripts", "Service Portal", "Mobile"],
        }
    },
    "australia": {
        "categories": {
            "platform_architecture": ["Instance architecture", "Application scope", "Script includes", "Business rules", "AI Agent Studio"],
            "data_modeling": ["Tables and fields", "Dictionary overrides", "Reference fields", "CMDB classes", "Data Fabric"],
            "automation": ["Flow designer", "Workflows", "Scheduled jobs", "Notifications", "Agentic workflows"],
            "security": ["User roles", "ACLs", "Impersonation", "SSO integration", "Autonomous Governance"],
            "integration": ["REST API", "SOAP", "OAuth", "MID server", "A2A Bridge"],
            "ui": ["UI policies", "Client scripts", "Service Portal", "Mobile", "Now Assist Panel"],
        }
    }
}


class CSADriftDetector:
    def __init__(self, instance_url: str, username: str, password: str, release="zurich"):
        self.instance_url = instance_url.rstrip("/")
        self.username = username
        self.password = password
        self.release = release.lower()

    def fetch_instance_features(self) -> List[str]:
        """Mock scan: query a few tables for presence as proxy for feature set."""
        features = set()
        table_map = {
            "sys_script_include": "Script includes",
            "sys_script": "Business rules",
            "sysevent_email_action": "Notifications",
            "sa_pattern": "Flow designer",
            "sys_workflow": "Workflows",
            "sys_user_role": "User roles",
            "sys_security_acl": "ACLs",
            "oauth_entity": "OAuth",
            "sys_script_client": "Client scripts",
            "sp_portal": "Service Portal",
            "sys_atf_step": "Automated Test Framework",
            "sys_ux_macro": "UI Macros",
            "sys_ui_policy": "UI policies",
            "cmdb_ci": "CMDB classes",
        }
        for table, label in table_map.items():
            url = f"{self.instance_url}/api/now/table/{table}"
            try:
                resp = requests.get(url, params={"sysparm_limit": 1}, auth=(self.username, self.password),
                                    headers={"Accept":"application/json"}, timeout=15)
                if resp.status_code == 200:
                    features.add(label)
            except Exception:
                features.add(label)  # mock acceptance
        return sorted(features)

    def get_syllabus(self) -> Dict:
        return SYLLABUS.get(self.release, SYLLABUS["zurich"])

    def compute_drift(self, instance_features: List[str]) -> Dict:
        syllabus = self.get_syllabus()
        all_syllabus_features = set()
        for cat, feats in syllabus["categories"].items():
            all_syllabus_features.update(feats)

        instance_set = set(instance_features)
        added = sorted(instance_set - all_syllabus_features)
        removed = sorted(all_syllabus_features - instance_set)
        common = sorted(instance_set & all_syllabus_features)
        total = len(all_syllabus_features)
        score = round(len(common) / max(total, 1) * 100, 1)
        return {
            "release": self.release,
            "score": score,
            "added": added,
            "removed": removed,
            "common": common,
            "total_syllabus": total,
            "total_instance": len(instance_set)
        }

    def filter_by_category(self, drift: Dict, category: str) -> Dict:
        syllabus = self.get_syllabus()
        cat_features = set(syllabus["categories"].get(category, []))
        return {
            "category": category,
            "score": round(len([f for f in drift["common"] if f in cat_features]) / max(len(cat_features),1) * 100, 1),
            "added": [f for f in drift["added"] if f in cat_features],
            "removed": [f for f in drift["removed"] if f in cat_features],
            "common": [f for f in drift["common"] if f in cat_features],
        }

    def generate_report(self, drift: Dict, output_prefix: str, category: Optional[str] = None):
        if category:
            drift = self.filter_by_category(drift, category)
        json_path = f"{output_prefix}.json"
        md_path = f"{output_prefix}.md"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(drift, f, ensure_ascii=False, indent=2)

        lines = [
            f"# CSA Exam Drift Report — {drift.get('release', self.release)}",
            f"**Overall Alignment:** {drift['score']}%",
            "",
            f"- Total syllabus features: {drift.get('total_syllabus', 'N/A')}",
            f"- Instance features detected: {drift.get('total_instance', 'N/A')}",
            f"- Added (instance has, syllabus lacks): {len(drift['added'])}",
            f"- Removed (syllabus has, instance lacks): {len(drift['removed'])}",
            "",
            "## Added",
        ]
        for f in drift["added"]:
            lines.append(f"- {f}")
        lines.append("\n## Removed (need training)")
        for f in drift["removed"]:
            lines.append(f"- {f}")
        lines.append("\n## Aligned")
        for f in drift["common"]:
            lines.append(f"- {f}")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return drift

    def run(self, output_prefix="drift_report", category=None):
        feats = self.fetch_instance_features()
        drift = self.compute_drift(feats)
        return self.generate_report(drift, output_prefix, category)
