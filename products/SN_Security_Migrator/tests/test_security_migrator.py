#!/usr/bin/env python3
"""
test_security_migrator.py — SN Security Migrator Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from scanner import SecurityMigrator, FailedJob, SecurityReport

class TestSecurityMigrator(unittest.TestCase):
    def setUp(self):
        self.m = SecurityMigrator()

    def test_password_classification(self):
        self.assertEqual(self.m.classify_failure("password migration failed"), "password")
        self.assertEqual(self.m.classify_failure("credential update error"), "password")

    def test_encryption_classification(self):
        self.assertEqual(self.m.classify_failure("encryption key mismatch"), "encryption")
        self.assertEqual(self.m.classify_failure("certificate expired"), "encryption")

    def test_acl_classification(self):
        self.assertEqual(self.m.classify_failure("ACL restriction invalid"), "acl")

    def test_unknown_classification(self):
        self.assertEqual(self.m.classify_failure("random error"), "unknown")

    def test_fix_script_password(self):
        script = self.m.generate_fix_script("password", "Test Job")
        self.assertIn("Migrating password", script)

    def test_fix_script_empty(self):
        script = self.m.generate_fix_script("nonexistent", "Test Job")
        self.assertIn("Manual review required", script)

    def test_mocked_run(self):
        self.m._get = lambda e, p=None: [
            {"sys_id":"1","name":"Security Password Migration","state":"failure","error_message":"password migration failed"},
            {"sys_id":"2","name":"Security Encryption Sync","state":"failure","error_message":"encrypt key mismatch"},
        ]
        report = self.m.run()
        self.assertEqual(report.total_jobs, 2)
        self.assertEqual(report.jobs[0].failure_type, "password")
        self.assertEqual(report.jobs[1].failure_type, "encryption")

    def test_empty_run(self):
        self.m._get = lambda e, p=None: []
        report = self.m.run()
        self.assertEqual(report.total_jobs, 0)

    def test_html_render(self):
        report = SecurityReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            total_jobs=1, failed_jobs=1,
            jobs=[FailedJob("1","Test","failure","err","unknown","fix")]
        )
        html = SecurityMigrator._render_html(report)
        self.assertIn("Security Migrator", html)
        self.assertIn("Test", html)

    def test_save_and_read(self):
        from pathlib import Path
        report = SecurityReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            total_jobs=0, failed_jobs=0, jobs=[]
        )
        path = self.m.save_report(report)
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        Path(path).with_suffix(".json").unlink(missing_ok=True)

if __name__ == "__main__":
    unittest.main(verbosity=2)
