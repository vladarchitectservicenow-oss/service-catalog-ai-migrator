#!/usr/bin/env python3
"""
test_audit_engine.py — SN NowAssist Optimizer Tests
Copyright (c) 2026 Vladimir Kapustin. License: AGPL-3.0
"""
import sys, os, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from audit_engine import Conversation, Metrics, Report, NowAssistOptimizer

class TestMetrics(unittest.TestCase):
    def test_empty_conversations(self):
        m = NowAssistOptimizer.compute_metrics(NowAssistOptimizer, [])
        self.assertEqual(m.total_conversations, 0)
        self.assertEqual(m.deflection_rate, 0.0)

    def test_deflection_rate(self):
        convs = [
            Conversation("1","s1","u1",True,None,"incident",0.92,"yes","2026-05-01"),
            Conversation("2","s2","u2",False,None,"incident",0.88,"no","2026-05-01"),
            Conversation("3","s3","u3",True,None,"change",0.95,"yes","2026-05-01"),
        ]
        m = NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs)
        self.assertEqual(m.total_conversations, 3)
        self.assertAlmostEqual(m.deflection_rate, 66.67, places=1)
        self.assertEqual(m.deflected_count, 2)

    def test_kb_quality(self):
        convs = [
            Conversation("1","s1","u1",True,"KB001","incident",0.90,"helpful","2026-05-01"),
            Conversation("2","s2","u2",True,"KB002","incident",0.85,"not helpful","2026-05-01"),
            Conversation("3","s3","u3",False,None,"incident",0.95,"helpful","2026-05-01"),
        ]
        m = NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs)
        self.assertEqual(m.kb_helpful, 2)
        self.assertEqual(m.kb_not_helpful, 1)
        self.assertAlmostEqual(m.kb_quality_score, 66.67, places=1)

    def test_low_confidence(self):
        convs = [
            Conversation("1","s1","u1",True,None,"incident",0.92,"yes","2026-05-01"),
            Conversation("2","s2","u2",False,None,"incident",0.75,"no","2026-05-01"),
            Conversation("3","s3","u3",False,None,"change",0.70,"no","2026-05-01"),
        ]
        m = NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs)
        self.assertEqual(m.low_confidence_count, 2)
        self.assertAlmostEqual(m.avg_confidence, 0.79, places=2)

    def test_routing_accuracy(self):
        convs = [
            Conversation("1","s1","u1",True,"KB001","incident",0.92,"yes","2026-05-01"),
            Conversation("2","s2","u2",True,"KB002","incident",0.85,"yes","2026-05-01"),
            Conversation("3","s3","u3",False,None,"change",0.95,"no","2026-05-01"),
        ]
        m = NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs)
        self.assertEqual(m.total_routed, 3)
        self.assertAlmostEqual(m.routing_accuracy, 66.67, places=1)

    def test_report_render(self):
        convs = [
            Conversation("1","s1","u1",True,"KB001","incident",0.92,"yes","2026-05-01"),
        ]
        report = Report(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            period_days=30, metrics=NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs),
            top_low_confidence=convs, conversations=convs
        )
        html = NowAssistOptimizer._render_html(report)
        self.assertIn("NowAssist Optimizer Report", html)
        self.assertIn("Deflection Rate", html)

    def test_html_contains_cards(self):
        convs = []
        report = Report(
            instance="test", timestamp=datetime.now(timezone.utc).isoformat(),
            period_days=7, metrics=NowAssistOptimizer.compute_metrics(NowAssistOptimizer, convs),
            top_low_confidence=[], conversations=[]
        )
        html = NowAssistOptimizer._render_html(report)
        self.assertIn("cards", html)
        self.assertIn("KB Quality", html)
        self.assertIn("Routing Accuracy", html)

    def test_mocked_plugin_check(self):
        optimizer = NowAssistOptimizer()
        optimizer._get = lambda endpoint, params=None: [{"name":"com.snc.now_assist","active":"true"}]
        status = optimizer.check_plugin()
        self.assertTrue(status["plugin_active"])

    def test_mocked_conversation_fetch(self):
        optimizer = NowAssistOptimizer()
        optimizer._get = lambda endpoint, params=None: [
            {"sys_id":"1","session_id":"s1","user":"u1","deflected":"true","kb_article":"","intent":"incident",
             "confidence":"0.92","user_feedback":"yes","sys_created_on":"2026-05-01"}
        ]
        convs = optimizer.fetch_conversations(limit=10)
        self.assertEqual(len(convs), 1)
        self.assertTrue(convs[0].deflected)

    def test_full_pipeline_mock(self):
        from pathlib import Path
        optimizer = NowAssistOptimizer()
        optimizer._get = lambda endpoint, params=None: [
            {"sys_id":"1","session_id":"s1","user":"u1","deflected":"true","kb_article":"","intent":"incident",
             "confidence":"0.92","user_feedback":"yes","sys_created_on":"2026-05-01"},
            {"sys_id":"2","session_id":"s2","user":"u2","deflected":"false","kb_article":"","intent":"incident",
             "confidence":"0.78","user_feedback":"no","sys_created_on":"2026-05-01"},
        ]
        report = optimizer.run(limit=10)
        path = optimizer.save_report(report)
        self.assertTrue(Path(path).exists())
        Path(path).unlink(missing_ok=True)
        json_path = Path(path).with_suffix(".json")
        json_path.unlink(missing_ok=True)

if __name__ == "__main__":
    unittest.main(verbosity=2)
