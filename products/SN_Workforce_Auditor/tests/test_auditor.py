"""
Tests for SN Workforce Auditor.
AGPL-3.0. Copyright (c) Vladimir Kapustin.
"""

import json
import unittest
from unittest.mock import MagicMock, patch, mock_open
from datetime import datetime, timedelta

import sys
sys.path.insert(0, "./src")

from auditor import ServiceNowClient, WorkforceAuditor, Task, Discrepancy, AuditReport


class FakeResponse:
    def __init__(self, payload: dict):
        self._payload = json.dumps(payload).encode("utf-8")
    def read(self):
        return self._payload
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


class TestServiceNowClient(unittest.TestCase):
    def test_get_json_parses_response(self):
        client = ServiceNowClient("dev123", "admin", "secret")
        payload = {"result": [{"sys_id": "abc"}]}
        with patch("urllib.request.urlopen", return_value=FakeResponse(payload)) as mock_urlopen:
            result = client.get_json("/api/now/table/task", {"sysparm_limit": 1})
            self.assertEqual(result["result"][0]["sys_id"], "abc")
            mock_urlopen.assert_called_once()


class TestTaskParsing(unittest.TestCase):
    def test_parse_task_all_fields(self):
        raw = {
            "sys_id": "abc123",
            "number": "INC0001",
            "state": "6",
            "resolved_by": "bot_user",
            "opened_at": "2024-01-01 00:00:00",
            "closed_at": "2024-01-02 00:00:00",
            "reassignment_count": "3",
        }
        task = WorkforceAuditor.parse_task(raw)
        self.assertEqual(task.sys_id, "abc123")
        self.assertEqual(task.number, "INC0001")
        self.assertEqual(task.resolved_by, "bot_user")
        self.assertEqual(task.reassignment_count, 3)

    def test_parse_task_missing_optional(self):
        raw = {
            "sys_id": "def456",
            "number": "INC0002",
            "state": "3",
            "resolved_by": None,
            "opened_at": "2024-01-01 00:00:00",
            "closed_at": None,
            "reassignment_count": "",
        }
        task = WorkforceAuditor.parse_task(raw)
        self.assertIsNone(task.resolved_by)
        self.assertIsNone(task.closed_at)
        self.assertEqual(task.reassignment_count, 0)


class TestStateNormalization(unittest.TestCase):
    def test_resolved_states(self):
        self.assertEqual(WorkforceAuditor.normalize_state("6"), "resolved")
        self.assertEqual(WorkforceAuditor.normalize_state("3"), "closed")
        self.assertEqual(WorkforceAuditor.normalize_state("7"), "closed")

    def test_cancelled_states(self):
        self.assertEqual(WorkforceAuditor.normalize_state("4"), "cancelled")
        self.assertEqual(WorkforceAuditor.normalize_state("8"), "cancelled")

    def test_unknown_state_passsthrough(self):
        self.assertEqual(WorkforceAuditor.normalize_state("new"), "new")


class TestClassification(unittest.TestCase):
    def test_unattributed_resolution(self):
        task = Task(
            sys_id="t1", number="INC001", state="6", resolved_by=None,
            opened_at="2024-01-01", closed_at="2024-01-02", reassignment_count=0,
        )
        auditor = WorkforceAuditor(MagicMock())
        discs = auditor.classify_task(task)
        self.assertEqual(len(discs), 1)
        self.assertEqual(discs[0].category, "unattributed_resolution")
        self.assertEqual(discs[0].severity, "Moderate")

    def test_claimed_cancelled(self):
        task = Task(
            sys_id="t2", number="INC002", state="4", resolved_by="bot",
            opened_at="2024-01-01", closed_at="2024-01-02", reassignment_count=0,
        )
        auditor = WorkforceAuditor(MagicMock())
        discs = auditor.classify_task(task)
        cats = [d.category for d in discs]
        self.assertIn("claimed_cancelled", cats)

    def test_critical_frequent_reassignment(self):
        task = Task(
            sys_id="t3", number="INC003", state="6", resolved_by="bot",
            opened_at="2024-01-01", closed_at="2024-01-02", reassignment_count=2,
        )
        auditor = WorkforceAuditor(MagicMock())
        discs = auditor.classify_task(task)
        cats = {d.category for d in discs}
        self.assertIn("frequent_reassignment", cats)
        crit = [d for d in discs if d.severity == "Critical"]
        self.assertTrue(len(crit) >= 1)


class TestAuditReport(unittest.TestCase):
    def test_audit_empty_tasks(self):
        mock_client = MagicMock()
        mock_client.get_json.return_value = {"result": []}
        auditor = WorkforceAuditor(mock_client)
        report = auditor.audit(window_days=7)
        self.assertEqual(report.total_tasks, 0)
        self.assertEqual(report.claimed_rate, 0.0)
        self.assertEqual(report.actual_rate, 0.0)

    def test_audit_rates(self):
        mock_client = MagicMock()
        mock_client.get_json.return_value = {
            "result": [
                {
                    "sys_id": "a1", "number": "INC01", "state": "6",
                    "resolved_by": "bot", "opened_at": "2024-01-01",
                    "closed_at": "2024-01-02", "reassignment_count": "0",
                },
                {
                    "sys_id": "a2", "number": "INC02", "state": "3",
                    "resolved_by": None, "opened_at": "2024-01-01",
                    "closed_at": "2024-01-02", "reassignment_count": "0",
                },
            ]
        }
        auditor = WorkforceAuditor(mock_client)
        report = auditor.audit(window_days=7)
        self.assertEqual(report.total_tasks, 2)
        self.assertEqual(report.claimed_resolved, 2)
        self.assertEqual(report.actual_resolved, 1)
        self.assertAlmostEqual(report.claimed_rate, 100.0)
        self.assertAlmostEqual(report.actual_rate, 50.0)
        self.assertAlmostEqual(report.variance, 50.0)

    def test_report_to_dict(self):
        report = AuditReport(
            audit_date="2024-02-01", window_start="2024-01-01",
            window_end="2024-02-01", total_tasks=5, claimed_resolved=5,
            actual_resolved=3, claimed_rate=100.0, actual_rate=60.0,
            variance=40.0, discrepancies=[
                Discrepancy("INC01", "s1", "x", "Minor", "desc", "t")
            ],
        )
        d = WorkforceAuditor.report_to_dict(report)
        self.assertEqual(d["total_tasks"], 5)
        self.assertEqual(len(d["discrepancies"]), 1)
        self.assertEqual(d["variance"], 40.0)


if __name__ == "__main__":
    unittest.main()
