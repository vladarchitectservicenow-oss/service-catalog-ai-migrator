#!/usr/bin/env python3
"""
test_panel_fixer.py — SN NowAssist Panel Fixer Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from panel_fixer import PanelFixer, UXAsset, PanelFixerReport

class TestPanelFixer(unittest.TestCase):
    def test_all_present(self):
        f = PanelFixer()
        f._get = lambda e, p=None: [{"name":"autosize.js"},{"name":"jQuery.js"},{"name":"lodash.js"}]
        r = f.run()
        self.assertEqual(r.missing_assets, 0)
        self.assertTrue(all(a.present for a in r.assets))

    def test_one_missing(self):
        f = PanelFixer()
        f._get = lambda e, p=None: [{"name":"autosize.js"},{"name":"jQuery.js"}]
        r = f.run()
        self.assertEqual(r.missing_assets, 1)
        self.assertTrue(any(not a.present and a.name == "lodash.js" for a in r.assets))

    def test_ui_script_scan_empty(self):
        f = PanelFixer()
        r = f.scan_ui_scripts()
        # Empty mock
        self.assertEqual(len(r), 0)

    def test_fix_script_missing(self):
        f = PanelFixer()
        f._get = lambda e, p=None: []
        r = f.run()
        missing = [a for a in r.assets if not a.present]
        self.assertTrue(all("Store" in a.fix_script or "upload" in a.fix_script for a in missing))

    def test_html_render(self):
        report = PanelFixerReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            missing_assets=1,
            assets=[UXAsset("","autosize.js","ux_lib",True,"ok"), UXAsset("","lodash.js","ux_lib",False,"fix")]
        )
        html = PanelFixer._render_html(report)
        self.assertIn("MISSING", html)
        self.assertIn("OK", html)

    def test_save_and_read(self):
        from pathlib import Path
        report = PanelFixerReport(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(), missing_assets=0, assets=[]
        )
        f = PanelFixer()
        path = f.save_report(report)
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        Path(path).with_suffix(".json").unlink(missing_ok=True)

if __name__ == "__main__":
    unittest.main(verbosity=2)
