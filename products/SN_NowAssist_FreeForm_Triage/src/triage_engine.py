#!/usr/bin/env python3
"""
SN NowAssist FreeForm Triage Engine
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, re, requests
from typing import List, Dict, Tuple, Optional


class TriageEngine:
    KEYWORD_MAP = {
        "vpn": ("VPN Access Request", "network", 0.9),
        "email": ("Email Account Issue", "identity", 0.85),
        "password": ("Password Reset", "identity", 0.9),
        "printer": ("Printer Support", "hardware", 0.8),
        "broken": ("General Incident", "incident", 0.5),
        "slow": ("Performance Issue", "incident", 0.6),
        "login": ("Login Issue", "identity", 0.85),
        "software": ("Software Installation", "application", 0.75),
        "access": ("Access Request", "identity", 0.7),
        "wifi": ("Wi-Fi Support", "network", 0.8),
    }

    def __init__(self, instance_url: str, username: str, password: str):
        self.instance_url = instance_url.rstrip("/")
        self.username = username
        self.password = password

    @staticmethod
    def extract_keywords(text: str) -> List[str]:
        t = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = t.split()
        return [tok for tok in tokens if len(tok) > 2]

    def match_catalog(self, text: str) -> Tuple[str, str, float]:
        """Return (catalog_item, category, confidence)."""
        keywords = self.extract_keywords(text)
        if not keywords:
            return ("General Inquiry", "general", 0.3)

        best_item, best_cat, best_score = "General Inquiry", "general", 0.0
        for kw in keywords:
            if kw in self.KEYWORD_MAP:
                item, cat, conf = self.KEYWORD_MAP[kw]
                if conf > best_score:
                    best_item, best_cat, best_score = item, cat, conf
        # Boost if multiple keywords match same category
        cat_hits = {}
        for kw in keywords:
            if kw in self.KEYWORD_MAP:
                _, c, _ = self.KEYWORD_MAP[kw]
                cat_hits[c] = cat_hits.get(c, 0) + 1
        if cat_hits:
            top_cat = max(cat_hits, key=cat_hits.get)
            if cat_hits[top_cat] > 1:
                best_score = min(best_score + 0.1, 1.0)
        return best_item, best_cat, round(best_score, 2)

    def create_ticket(self, user: str, text: str, catalog_item: str, category: str, confidence: float) -> Dict:
        """Mock POST to sc_request or catalog table."""
        url = f"{self.instance_url}/api/now/table/sc_request"
        payload = {
            "short_description": f"{catalog_item}: {text[:80]}",
            "description": f"User: {user}\nOriginal: {text}\nCategory: {category}\nConfidence: {confidence}",
            "request_state": "in_process" if confidence >= 0.5 else "review",
            "u_confidence": confidence
        }
        try:
            resp = requests.post(url, json=payload, auth=(self.username, self.password),
                                 headers={"Content-Type": "application/json"}, timeout=30)
            resp.raise_for_status()
            return {"status": "created", "sys_id": resp.json().get("result",{}).get("sys_id","mock-"+user), "confidence": confidence}
        except Exception as e:
            return {"status": "mock", "sys_id": "mock-" + user, "error": str(e), "confidence": confidence}

    def triage(self, user: str, text: str) -> Dict:
        item, cat, conf = self.match_catalog(text)
        ticket = self.create_ticket(user, text, item, cat, conf)
        return {
            "user": user,
            "original": text,
            "catalog_item": item,
            "category": cat,
            "confidence": conf,
            "needs_review": conf < 0.5,
            "ticket": ticket
        }

    def batch_triage(self, items: List[Dict]) -> List[Dict]:
        return [self.triage(i["user"], i["text"]) for i in items]

    def generate_report(self, results: List[Dict], output_path: str):
        report = {
            "total": len(results),
            "auto_routed": sum(1 for r in results if not r["needs_review"]),
            "needs_review": sum(1 for r in results if r["needs_review"]),
            "avg_confidence": round(sum(r["confidence"] for r in results)/max(len(results),1), 2),
            "details": results
        }
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return report
