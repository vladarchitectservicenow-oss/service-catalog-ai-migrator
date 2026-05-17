#!/usr/bin/env python3
"""
test_validator.py — SN AI Agent Validator Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from validator import AIAgentValidator, CheckResult, ValidationReport

class TestValidator(unittest.TestCase):
    def setUp(self):
        self.v = AIAgentValidator()

    def test_plugin_pass(self):
        self.v._get = lambda e, p=None: [{"name":"com.snc.now_assist","active":"true"},{"name":"com.snc.ai_agent_studio","active":"true"}]
        r = self.v.check_plugin()
        self.assertEqual(r.status, "PASS")
        self.assertEqual(r.score, 100)

    def test_plugin_fail(self):
        self.v._get = lambda e, p=None: [{"name":"com.snc.now_assist","active":"false"}]
        r = self.v.check_plugin()
        self.assertEqual(r.status, "FAIL")

    def test_agent_config_pass(self):
        self.v._get = lambda e, p=None: [{"name":"ITSM Agent","short_description":"Help","agent_state":"active","skills":"skill1","roles":"itil"}]
        r = self.v.check_agent_config()
        self.assertEqual(r.status, "PASS")

    def test_agent_config_fail(self):
        self.v._get = lambda e, p=None: [{"name":"Bad Agent","short_description":"","agent_state":"active","skills":"","roles":""}]
        r = self.v.check_agent_config()
        self.assertIn(r.status, ("WARN", "FAIL"))

    def test_skills_orphaned(self):
        self.v._get = lambda e, p=None: [{"name":"s1","active":"true","agent":""},{"name":"s2","active":"false","agent":"a1"}]
        r = self.v.check_skills()
        self.assertEqual(r.status, "WARN")
        self.assertIn("Orphaned", str(r.details))

    def test_role_masking_elevated(self):
        self.v._get = lambda e, p=None: [{"name":"Evil Agent","roles":"admin,itil"}]
        r = self.v.check_role_masking()
        self.assertEqual(r.status, "WARN")

    def test_a2a_compliant(self):
        self.v._get = lambda e, p=None: [{"name":"Ext Agent","integration_type":"a2a","a2a_enabled":"true"}]
        r = self.v.check_a2a_compliance()
        self.assertEqual(r.status, "PASS")

    def test_cmdb_health(self):
        self.v._get = lambda e, p=None: [{"sys_id":"1"}]
        r = self.v.check_cmdb_health()
        self.assertEqual(r.status, "PASS")

    def test_kb_coverage(self):
        self.v._get = lambda e, p=None: [{"sys_id":"1","topic":"incident","valid_to":"2026-12-31"}]
        r = self.v.check_kb_coverage()
        self.assertEqual(r.status, "PASS")

    def test_simulate_fail(self):
        self.v._post = lambda e, b: (_ for _ in ()).throw(Exception("API down"))
        r = self.v.simulate_agent()
        self.assertEqual(r.status, "FAIL")

    def test_full_report(self):
        self.v._get = lambda e, p=None: [
            {"name":"com.snc.now_assist","active":"true"},
            {"name":"com.snc.ai_agent_studio","active":"true"},
        ] if "v_plugin" in e else [
            {"name":"Agent","short_description":"desc","agent_state":"active","skills":"s1","roles":"itil"}
        ] if "sn_agent" in e else [
            {"sys_id":"1"}
        ]
        self.v._post = lambda e, b: {"result":{"text":"Hello"}}
        report = self.v.run()
        self.assertGreaterEqual(report.overall_score, 0)
        self.assertIn(report.overall_status, ("PASS", "WARN", "FAIL"))
        path = self.v.save_report(report)
        from pathlib import Path
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        Path(path).with_suffix(".json").unlink(missing_ok=True)

    def test_html_render(self):
        report = ValidationReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            overall_score=85, overall_status="PASS",
            checks=[CheckResult("Area1","PASS",100,["OK"]),CheckResult("Area2","WARN",70,["Low"])]
        )
        html = AIAgentValidator._render_html(report)
        self.assertIn("PASS", html)
        self.assertIn("85/100", html)

if __name__ == "__main__":
    unittest.main(verbosity=2)
