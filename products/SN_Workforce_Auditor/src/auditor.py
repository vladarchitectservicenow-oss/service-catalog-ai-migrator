"""
SN Workforce Auditor
Audits ServiceNow Autonomous Workforce resolution claims.
AGPL-3.0. Copyright (c) Vladimir Kapustin.
"""

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import urljoin

import urllib.request


@dataclass
class Task:
    sys_id: str
    number: str
    state: str
    resolved_by: Optional[str]
    opened_at: str
    closed_at: Optional[str]
    reassignment_count: int


@dataclass
class Discrepancy:
    task_number: str
    sys_id: str
    category: str
    severity: str
    description: str
    timestamp: str


@dataclass
class AuditReport:
    audit_date: str
    window_start: str
    window_end: str
    total_tasks: int
    claimed_resolved: int
    actual_resolved: int
    claimed_rate: float
    actual_rate: float
    variance: float
    discrepancies: List[Discrepancy]


class ServiceNowClient:
    def __init__(self, instance: str, user: str, password: str):
        self.base_url = f"https://{instance}.service-now.com"
        credentials = f"{user}:{password}"
        self.auth_header = ("Authorization", f"Basic {credentials}")

    def get_json(self, endpoint: str, params: dict) -> dict:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{urljoin(self.base_url, endpoint)}?{query}"
        req = urllib.request.Request(url, method="GET")
        req.add_header(*self.auth_header)
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))


class WorkforceAuditor:
    def __init__(self, client: ServiceNowClient):
        self.client = client

    def fetch_tasks(self, window_start: str, window_end: str) -> List[dict]:
        params = {
            "sysparm_query": f"opened_at>={window_start}^opened_at<={window_end}",
            "sysparm_fields": "sys_id,number,state,resolved_by,opened_at,closed_at,reassignment_count",
            "sysparm_limit": 1000,
        }
        try:
            result = self.client.get_json("/api/now/table/task", params)
            return result.get("result", [])
        except Exception:
            return []

    @staticmethod
    def parse_task(raw: dict) -> Task:
        return Task(
            sys_id=raw.get("sys_id", ""),
            number=raw.get("number", ""),
            state=raw.get("state", ""),
            resolved_by=raw.get("resolved_by") or None,
            opened_at=raw.get("opened_at", ""),
            closed_at=raw.get("closed_at") or None,
            reassignment_count=int(raw.get("reassignment_count", 0) or 0),
        )

    @staticmethod
    def normalize_state(state: str) -> str:
        mapping = {
            "3": "closed",
            "6": "resolved",
            "7": "closed",
            "4": "cancelled",
            "8": "cancelled",
        }
        return mapping.get(state, state).lower()

    def classify_task(self, task: Task) -> List[Discrepancy]:
        discrepancies: List[Discrepancy] = []
        state = self.normalize_state(task.state)

        if state == "resolved" and not task.resolved_by:
            discrepancies.append(
                Discrepancy(
                    task_number=task.number,
                    sys_id=task.sys_id,
                    category="unattributed_resolution",
                    severity="Moderate",
                    description="Task marked resolved but has no resolved_by.",
                    timestamp=task.closed_at or task.opened_at,
                )
            )

        if state == "cancelled" and task.resolved_by:
            discrepancies.append(
                Discrepancy(
                    task_number=task.number,
                    sys_id=task.sys_id,
                    category="claimed_cancelled",
                    severity="Moderate",
                    description="Task is cancelled yet resolution was claimed.",
                    timestamp=task.closed_at or task.opened_at,
                )
            )

        if task.reassignment_count > 0 and state == "resolved":
            discrepancies.append(
                Discrepancy(
                    task_number=task.number,
                    sys_id=task.sys_id,
                    category="reassigned_then_resolved",
                    severity="Minor",
                    description="Task was reassigned after bot resolution.",
                    timestamp=task.closed_at or task.opened_at,
                )
            )

        if state == "resolved" and task.reassignment_count >= 2:
            discrepancies.append(
                Discrepancy(
                    task_number=task.number,
                    sys_id=task.sys_id,
                    category="frequent_reassignment",
                    severity="Critical",
                    description="Resolved after multiple reassignments suggesting human intervention.",
                    timestamp=task.closed_at or task.opened_at,
                )
            )

        return discrepancies

    def audit(self, window_days: int = 30):
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=window_days)
        window_start = start.strftime("%Y-%m-%d %H:%M:%S")
        window_end = end.strftime("%Y-%m-%d %H:%M:%S")

        raw_tasks = self.fetch_tasks(window_start, window_end)
        tasks = [self.parse_task(t) for t in raw_tasks]

        total = len(tasks)
        claimed_resolved = sum(
            1 for t in tasks
            if self.normalize_state(t.state) in ("resolved", "closed")
        )
        actual_resolved = sum(
            1 for t in tasks
            if self.normalize_state(t.state) == "resolved" and t.resolved_by
        )
        claimed_rate = (claimed_resolved / total * 100) if total else 0.0
        actual_rate = (actual_resolved / total * 100) if total else 0.0

        discrepancies: List[Discrepancy] = []
        for task in tasks:
            discrepancies.extend(self.classify_task(task))

        variance = claimed_rate - actual_rate

        return AuditReport(
            audit_date=datetime.now(timezone.utc).isoformat(),
            window_start=window_start,
            window_end=window_end,
            total_tasks=total,
            claimed_resolved=claimed_resolved,
            actual_resolved=actual_resolved,
            claimed_rate=claimed_rate,
            actual_rate=actual_rate,
            variance=variance,
            discrepancies=discrepancies,
        )

    @staticmethod
    def report_to_dict(report: AuditReport) -> dict:
        return {
            "audit_date": report.audit_date,
            "window_start": report.window_start,
            "window_end": report.window_end,
            "total_tasks": report.total_tasks,
            "claimed_resolved": report.claimed_resolved,
            "actual_resolved": report.actual_resolved,
            "claimed_rate": round(report.claimed_rate, 2),
            "actual_rate": round(report.actual_rate, 2),
            "variance": round(report.variance, 2),
            "discrepancies": [
                {
                    "task_number": d.task_number,
                    "sys_id": d.sys_id,
                    "category": d.category,
                    "severity": d.severity,
                    "description": d.description,
                    "timestamp": d.timestamp,
                }
                for d in report.discrepancies
            ],
        }


def main():
    parser = argparse.ArgumentParser(description="SN Workforce Auditor")
    parser.add_argument("--instance", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--output", default="audit_report.json")
    args = parser.parse_args()

    client = ServiceNowClient(args.instance, args.user, args.password)
    auditor = WorkforceAuditor(client)
    report = auditor.audit(window_days=args.window_days)
    payload = WorkforceAuditor.report_to_dict(report)

    with open(args.output, "w") as fh:
        json.dump(payload, fh, indent=2)

    print(f"Audit complete. Report written to {args.output}")
    print(f"Claimed rate: {payload['claimed_rate']}% | Actual rate: {payload['actual_rate']}% | Variance: {payload['variance']}%")


if __name__ == "__main__":
    main()
