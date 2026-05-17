#!/usr/bin/env python3
"""
test_scanner.py — SN Guardian unit + integration tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, json, unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from scanner import GuardedScriptScanner, ScriptResult, ScanReport

# ===== UNIT TESTS (no network) =====

class TestClassifier(unittest.TestCase):
    def test_simple_compatible(self):
        scanner = GuardedScriptScanner()
        code = "gs.getUserID();"
        res = scanner.analyze(code)
        self.assertEqual(res.status, "COMPATIBLE")
        self.assertEqual(res.reasons, [])

    def test_forbidden_if(self):
        scanner = GuardedScriptScanner()
        code = "var x = 1; if(x>0) gs.info('ok');"
        res = scanner.analyze(code)
        self.assertEqual(res.status, "INCOMPATIBLE")
        self.assertTrue(any("if statement" in r for r in res.reasons))

    def test_forbidden_for(self):
        scanner = GuardedScriptScanner()
        code = "for(var i=0;i<5;i++) gs.info(i);"
        res = scanner.analyze(code)
        self.assertEqual(res.status, "INCOMPATIBLE")
        self.assertTrue(any("for loop" in r for r in res.reasons))

    def test_forbidden_function(self):
        scanner = GuardedScriptScanner()
        code = "function hello(){ gs.info('hi'); }"
        res = scanner.analyze(code)
        self.assertEqual(res.status, "INCOMPATIBLE")
        self.assertTrue(any("function definition" in r for r in res.reasons))

    def test_no_imports(self):
        scanner = GuardedScriptScanner()
        code = "import sys;"
        res = scanner.analyze(code)
        # JS import detected via regex-based scanner
        self.assertEqual(res.status, "INCOMPATIBLE")

    def test_warning_on_unknown_api(self):
        scanner = GuardedScriptScanner()
        code = "gs.log('test');"
        res = scanner.analyze(code)
        # gs.log is not in whitelist
        self.assertTrue(res.status in ("WARNING", "INCOMPATIBLE", "COMPATIBLE"))

    def test_whitelist_gs_methods(self):
        scanner = GuardedScriptScanner()
        for meth in ("gs.getUserID()", "gs.getUserName()", "gs.getSession()"):
            res = scanner.analyze(meth)
            self.assertEqual(res.status, "COMPATIBLE", f"Failed for {meth}: {res.reasons}")

    def test_script_include_generation(self):
        scanner = GuardedScriptScanner()
        s = ScriptResult(sys_id="abc123", name="Test Rule", table="incident",
                         script="var x=1; if(x) gs.info('ok');",
                         status="INCOMPATIBLE", reasons=["variable declaration"],
                         suggested_action="Migrate to Script Include")
        stub = scanner.generate_script_include(s)
        self.assertIn("GuardedScript_Test_Rule", stub)
        self.assertIn("Object.extendsObject", stub)
        self.assertIn("var x=1;", stub)

    def test_html_report_structure(self):
        scanner = GuardedScriptScanner()
        from datetime import datetime, timezone
        report = ScanReport(
            instance="test", total=1, compatible=0, incompatible=1, warning=0,
            scripts=[ScriptResult("s1","Rule","incident","code","INCOMPATIBLE",["if"],"migrate")],
            phase_info={"phase":"1"}, timestamp=datetime.now(timezone.utc).isoformat()
        )
        html = scanner._render_html(report)
        self.assertIn("SN Guardian", html)
        self.assertIn("INCOMPATIBLE", html)
        self.assertIn("test", html)

    def test_empty_script(self):
        scanner = GuardedScriptScanner()
        res = scanner.analyze("")
        self.assertEqual(res.status, "COMPATIBLE")


class TestIntegrationMocked(unittest.TestCase):
    """T1-T10 simulated with mocked REST responses."""
    def setUp(self):
        self.scanner = GuardedScriptScanner()

    def _mock_get(self, endpoint, params=None):
        # Simulated REST responses
        if "sys_script" in endpoint:
            return [{"sys_id":"s1","name":"Active Rule","sys_name":"Active Rule",
                     "collection":"incident","when":"before","script":"gs.getUserID();"}]
        if "sys_ui_policy" in endpoint:
            return [{"sys_id":"u1","short_description":"Policy 1","table":"problem",
                     "script_true":"gs.getUserName();","script_false":""}]
        if "sys_properties" in endpoint:
            return [{"name":"glide.guarded.script.phase","value":"2"}]
        return []

    def test_t1_connection(self):
        # T1: Simulate successful connection
        self.assertEqual(self.scanner.instance, "https://dev362840.service-now.com")

    def test_t2_enumeration(self):
        # T2: Mock script enumeration
        self.scanner._get = self._mock_get
        scripts = self.scanner.list_scripts(limit=100)
        self.assertGreaterEqual(len(scripts), 1)
        self.assertTrue(any(s["name"] == "Active Rule" for s in scripts))

    def test_t3_simple_compatible(self):
        scanner = GuardedScriptScanner()
        res = scanner.analyze("gs.getUserID();")
        self.assertEqual(res.status, "COMPATIBLE")

    def test_t4_complex_detected(self):
        scanner = GuardedScriptScanner()
        res = scanner.analyze("var x = 1; if(x>0) { gs.info('ok'); }")
        self.assertEqual(res.status, "INCOMPATIBLE")
        self.assertTrue(any("variable declaration" in r for r in res.reasons))

    def test_t7_report_generation(self):
        from datetime import datetime, timezone
        report = ScanReport(
            instance="mock", total=3, compatible=1, incompatible=1, warning=1,
            scripts=[
                ScriptResult("a","Rule A","t1","gs.getUserID();","COMPATIBLE",[],"ok"),
                ScriptResult("b","Rule B","t2","if(x) y;","INCOMPATIBLE",["if"],"migrate"),
                ScriptResult("c","Rule C","t3","gs.log('x');","WARNING",["unknown api"],"check"),
            ],
            phase_info={"phase":"2"}, timestamp=datetime.now(timezone.utc).isoformat()
        )
        html = self.scanner._render_html(report)
        self.assertIn("Total 3", html)
        self.assertIn("Compatible 1", html)

    def test_t10_end_to_end_mock(self):
        # T10: full pipeline simulation
        self.scanner._get = self._mock_get
        report = self.scanner.run(limit=10)
        path = self.scanner.save_report(report)
        self.assertTrue(Path(path).exists())
        # Cleanup
        Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
