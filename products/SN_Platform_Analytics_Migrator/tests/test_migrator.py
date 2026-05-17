#!/usr/bin/env python3
"""
test_migrator.py — SN Platform Analytics Migrator Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from migrator import PlatformAnalyticsMigrator, ReportMapping, MigrationReport

class TestMigrator(unittest.TestCase):
    def setUp(self):
        self.m = PlatformAnalyticsMigrator()

    def test_map_supported_bar(self):
        r = self.m.map_report({"sys_id":"1","title":"Tickets","type":"bar","table":"incident","filter":"","group_by":"category"})
        self.assertEqual(r.supported, True)
        self.assertEqual(r.target_type, "bar")

    def test_map_unsupported_gauge(self):
        r = self.m.map_report({"sys_id":"2","title":"Gauge","type":"gauge","table":"","filter":""})
        self.assertEqual(r.supported, False)
        self.assertTrue(any("not supported" in i for i in r.issues))

    def test_map_missing_table(self):
        r = self.m.map_report({"sys_id":"3","title":"No table","type":"list","table":"","filter":""})
        self.assertTrue(any("Missing" in i for i in r.issues))

    def test_generate_pa_config(self):
        rm = ReportMapping("1","T","bar","bar",True,"incident","","category",[])
        cfg = self.m.generate_pa_config(rm)
        self.assertEqual(cfg["type"], "bar")
        self.assertEqual(cfg["table"], "incident")

    def test_report_metrics(self):
        self.m._get = lambda e, p=None: [{"sys_id":"1","title":"R1","type":"bar","table":"incident"}]
        report = self.m.run(limit=10)
        self.assertEqual(report.total_reports, 1)
        self.assertEqual(report.mappable, 1)

    def test_html_render(self):
        report = MigrationReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            total_reports=2, mappable=1, unmappable=1,
            mappings=[
                ReportMapping("1","R1","bar","bar",True,"incident","","",[]),
                ReportMapping("2","R2","gauge","gauge",False,"","","",["unsupported"]),
            ],
            export_json={},
        )
        html = PlatformAnalyticsMigrator._render_html(report)
        self.assertIn("Mappable", html)
        self.assertIn("YES", html)
        self.assertIn("NO", html)

    def test_full_pipeline_mock(self):
        from pathlib import Path
        self.m._get = lambda e, p=None: [
            {"sys_id":"1","title":"R1","type":"bar","table":"incident","filter":"","group_by":""},
            {"sys_id":"2","title":"R2","type":"gauge","table":"","filter":"","group_by":""},
        ]
        report = self.m.run(limit=10)
        path = self.m.save_report(report)
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        Path(path).with_suffix(".json").unlink(missing_ok=True)

    def test_dashboard_fetch(self):
        self.m._get = lambda e, p=None: [{"sys_id":"d1","name":"Exec","active":"true"}]
        dbs = self.m.list_dashboards()
        self.assertEqual(len(dbs), 1)

    def test_plugin_check(self):
        self.m._get = lambda e, p=None: [{"name":"com.snc.platform_analytics","active":"true"}]
        s = self.m.check_plugin()
        self.assertTrue(s["plugin_active"])

    def test_export_structure(self):
        self.m._get = lambda e, p=None: [{"sys_id":"1","title":"R1","type":"bar","table":"incident","filter":""}]
        report = self.m.run(limit=10)
        self.assertIn("version", report.export_json)
        self.assertEqual(report.export_json["version"], "1.0")

if __name__ == "__main__":
    unittest.main(verbosity=2)
