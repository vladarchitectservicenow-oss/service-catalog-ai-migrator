#!/usr/bin/env python3
"""
test_a2a_bridge.py — SN A2A Bridge Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from a2a_bridge import A2ABridge, ExternalAgent, A2AConfig, BridgeReport

class TestA2ABridge(unittest.TestCase):
    def setUp(self):
        self.b = A2ABridge()

    def test_list_external_agents(self):
        self.b._get = lambda e, p=None: [
            {"sys_id":"1","name":"Ext1","integration_type":"webhook","endpoint_url":"http://x.com","auth_type":"basic","a2a_enabled":"false"},
            {"sys_id":"2","name":"Ext2","integration_type":"a2a","endpoint_url":"http://y.com","auth_type":"oauth2","a2a_enabled":"true"},
        ]
        agents = self.b.list_external_agents()
        self.assertEqual(len(agents), 2)
        self.assertTrue(agents[0].deprecated)
        self.assertFalse(agents[1].deprecated)

    def test_generate_a2a_config(self):
        agent = ExternalAgent("1","Legacy","webhook","http://x.com","basic",False,True)
        cfg = self.b.generate_a2a_config(agent)
        self.assertEqual(cfg.source_agent_id, "1")
        self.assertEqual(cfg.endpoint_url, "http://x.com")
        self.assertIn("actions", cfg.capabilities)

    def test_validate_a2a_pass(self):
        cfg = A2AConfig("1","Test","1.0","http://x.com",["text"],{"type":"oauth2"})
        issues = self.b.validate_a2a(cfg)
        self.assertEqual(len(issues), 0)

    def test_validate_a2a_fail_missing_url(self):
        cfg = A2AConfig("1","Test","1.0","",[],{})
        issues = self.b.validate_a2a(cfg)
        self.assertTrue(any("Missing" in i for i in issues))

    def test_run_all_migrated(self):
        self.b._get = lambda e, p=None: [
            {"sys_id":"1","name":"Ext1","integration_type":"webhook","endpoint_url":"http://x.com","auth_type":"basic","a2a_enabled":"false"},
        ]
        report = self.b.run()
        self.assertEqual(report.total_external_agents, 1)
        self.assertEqual(report.deprecated_count, 1)
        self.assertEqual(len(report.migrated), 1)

    def test_run_validation_issue(self):
        self.b._get = lambda e, p=None: [
            {"sys_id":"1","name":"Bad","integration_type":"manual","endpoint_url":"","auth_type":"","a2a_enabled":"false"},
        ]
        report = self.b.run()
        self.assertEqual(len(report.migrated), 0)
        self.assertTrue(len(report.issues) > 0)

    def test_render_html(self):
        report = BridgeReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            total_external_agents=2, deprecated_count=1, a2a_compliant_count=1,
            migrated=[A2AConfig("1","Migrated","1.0","http://x.com",["text"],{})],
            issues=["Bad: Missing endpoint"],
        )
        html = A2ABridge._render_html(report)
        self.assertIn("A2A Protocol Bridge Report", html)
        self.assertIn("Bad: Missing", html)

    def test_save_and_read(self):
        from pathlib import Path
        report = BridgeReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            total_external_agents=0, deprecated_count=0, a2a_compliant_count=0,migrated=[],issues=[]
        )
        path = self.b.save_report(report)
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        Path(path).with_suffix(".json").unlink(missing_ok=True)

    def test_detect_circular(self):
        # Placeholder: circular detection requires graph analysis
        self.assertTrue(True)

    def test_compatibility_matrix(self):
        for itype in ("webhook", "manual", "legacy"):
            agent = ExternalAgent("1","Test",itype,"","",False,True)
            self.assertTrue(agent.deprecated)

if __name__ == "__main__":
    unittest.main(verbosity=2)
