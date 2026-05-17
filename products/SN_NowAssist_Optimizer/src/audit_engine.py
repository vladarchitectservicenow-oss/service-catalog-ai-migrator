#!/usr/bin/env python3
"""
audit_engine.py — SN NowAssist Optimizer
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

@dataclass
class Conversation:
    sys_id: str
    session_id: str
    user_id: str
    deflected: bool
    kb_article: Optional[str]
    intent: Optional[str]
    confidence: float
    user_feedback: str
    created: str

@dataclass
class Metrics:
    total_conversations: int
    deflected_count: int
    deflection_rate: float
    kb_helpful: int
    kb_not_helpful: int
    kb_quality_score: float
    total_routed: int
    correct_intent_routing: int
    routing_accuracy: float
    low_confidence_count: int
    low_confidence_threshold: float
    avg_confidence: float

@dataclass
class Report:
    instance: str
    timestamp: str
    period_days: int
    metrics: Metrics
    top_low_confidence: List[Conversation] = field(default_factory=list)
    conversations: List[Conversation] = field(default_factory=list)


class NowAssistOptimizer:
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
        """Verify Now Assist plugin is active."""
        rows = self._get("/api/now/table/v_plugin", {
            "sysparm_query": "name=com.snc.now_assist^active=true",
            "sysparm_fields": "name,active",
            "sysparm_limit": 1,
        })
        return {"plugin_active": len(rows) > 0 and rows[0].get("active") == "true", "details": rows}

    def fetch_conversations(self, limit: int = 500, days: int = 30) -> List[Conversation]:
        """Fetch sa_conversation (or fallback sys_user_preference for VA logs)."""
        # SN Now Assist VA conversation table - try sa_conversation, fallback sa_conversation_log
        for table in ("sa_conversation", "sa_conversation_log", "sys_user_preference"):
            try:
                rows = self._get(f"/api/now/table/{table}", {
                    "sysparm_limit": limit,
                    "sysparm_fields": "sys_id,session_id,user,deflected,kb_article,intent,confidence,user_feedback,sys_created_on",
                })
                if rows:
                    out = []
                    for r in rows:
                        out.append(Conversation(
                            sys_id=r.get("sys_id", ""),
                            session_id=r.get("session_id", ""),
                            user_id=r.get("user", ""),
                            deflected=str(r.get("deflected", "")).lower() == "true",
                            kb_article=r.get("kb_article") or None,
                            intent=r.get("intent") or None,
                            confidence=float(r.get("confidence", 0) or 0),
                            user_feedback=str(r.get("user_feedback", "")),
                            created=r.get("sys_created_on", ""),
                        ))
                    return out
            except Exception:
                continue
        return []

    def compute_metrics(self, conversations: List[Conversation]) -> Metrics:
        total = len(conversations)
        if not total:
            return Metrics(0, 0, 0.0, 0, 0, 0.0, 0, 0, 0.0, 0, 0.85, 0.0)
        deflected = sum(1 for c in conversations if c.deflected)
        helpful = sum(1 for c in conversations if c.user_feedback.lower() in ("helpful", "yes", "true"))
        not_helpful = sum(1 for c in conversations if c.user_feedback.lower() in ("not helpful", "no", "false"))
        routed = [c for c in conversations if c.intent]
        correct_routing = sum(1 for c in routed if c.deflected)  # proxy: deflected ≈ correct routing
        low_conf = [c for c in conversations if c.confidence < 0.85]
        confidences = [c.confidence for c in conversations if c.confidence > 0]
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        kb_total = helpful + not_helpful
        return Metrics(
            total_conversations=total,
            deflected_count=deflected,
            deflection_rate=round(deflected / total * 100, 2),
            kb_helpful=helpful,
            kb_not_helpful=not_helpful,
            kb_quality_score=round(helpful / kb_total * 100, 2) if kb_total else 0.0,
            total_routed=len(routed),
            correct_intent_routing=correct_routing,
            routing_accuracy=round(correct_routing / len(routed) * 100, 2) if routed else 0.0,
            low_confidence_count=len(low_conf),
            low_confidence_threshold=0.85,
            avg_confidence=round(avg_conf, 3),
        )

    def run(self, limit: int = 500, days: int = 30) -> Report:
        conversations = self.fetch_conversations(limit=limit, days=days)
        metrics = self.compute_metrics(conversations)
        low_conf = sorted([c for c in conversations if c.confidence < metrics.low_confidence_threshold],
                          key=lambda x: x.confidence)[:20]
        return Report(
            instance=self.instance,
            timestamp=datetime.now(timezone.utc).isoformat(),
            period_days=days,
            metrics=metrics,
            top_low_confidence=low_conf,
            conversations=conversations,
        )

    def save_report(self, report: Report, out_dir: str = "reports") -> Path:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        ts = report.timestamp[:10]
        host = report.instance.split("//")[-1]
        # JSON
        js = Path(out_dir) / f"nowassist_report_{ts}_{host}.json"
        js.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2, default=lambda o: o.__dict__))
        # HTML
        html = Path(out_dir) / f"nowassist_report_{ts}_{host}.html"
        html.write_text(self._render_html(report))
        return html

    @staticmethod
    def _render_html(report: Report) -> str:
        m = report.metrics
        low_rows = ""
        for c in report.top_low_confidence:
            low_rows += f"""<tr><td>{c.session_id}</td><td>{c.intent or '- '}</td><td>{c.confidence}</td><td>{c.user_feedback or '-' }</td></tr>\n"""
        return f"""
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>SN NowAssist Optimizer Report</title>
<style>body{{font-family:DejaVu Sans,sans-serif;margin:40px}}h1{{color:#0F1D35}}.cards{{display:flex;gap:20px;flex-wrap:wrap}}.card{{border:1px solid #ddd;border-radius:8px;padding:20px;min-width:200px}}.big{{font-size:2em;font-weight:bold}}table{{border-collapse:collapse;width:100%;margin-top:20px}}th,td{{border:1px solid #ddd;padding:8px;text-align:left}}th{{background:#0F1D35;color:white}}</style>
</head><body>
<h1>ServiceNow Now Assist Optimizer Report</h1>
<p><b>Instance:</b> {report.instance} | <b>Period:</b> {report.period_days} days | <b>Published:</b> {report.timestamp}</p>
<div class="cards">
<div class="card"><div>Deflection Rate</div><div class="big">{m.deflection_rate}%</div></div>
<div class="card"><div>KB Quality</div><div class="big">{m.kb_quality_score}%</div></div>
<div class="card"><div>Routing Accuracy</div><div class="big">{m.routing_accuracy}%</div></div>
<div class="card"><div>Low Confidence</div><div class="big">{m.low_confidence_count}</div></div>
</div>
<h2>Low-Confidence Conversations (Top 20)</h2>
<table><tr><th>Session</th><th>Intent</th><th>Confidence</th><th>Feedback</th></tr>
{low_rows}</table>
<p style="font-size:0.8em;color:#555">Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0</p>
</body></html>
"""
