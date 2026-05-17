#!/usr/bin/env python3
"""
Tests for SN CSA Exam Drift Detector
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.drift_detector import CSADriftDetector


def test_load_syllabus():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    s = d.get_syllabus()
    assert "platform_architecture" in s["categories"]
    assert "Script includes" in s["categories"]["platform_architecture"]


def test_detect_added_features():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    drift = d.compute_drift(["Script includes", "Business rules", "AI Agent Studio", "Extra Feature"])
    assert "AI Agent Studio" in drift["added"] or "Extra Feature" in drift["added"]


def test_detect_removed_features():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    drift = d.compute_drift(["Script includes"])
    # Many syllabus features missing
    assert len(drift["removed"]) > 0


def test_score_drift():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    drift = d.compute_drift(["Script includes", "Business rules", "Notifications", "User roles"])
    assert 0 <= drift["score"] <= 100


def test_report_generation():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    drift = d.compute_drift(["Script includes", "Business rules"])
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "r")
        d.generate_report(drift, prefix)
        assert os.path.exists(prefix + ".json")
        assert os.path.exists(prefix + ".md")
        data = json.load(open(prefix + ".json"))
        assert "score" in data


def test_filter_by_category():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    drift = d.compute_drift(["Script includes", "Business rules"])
    filtered = d.filter_by_category(drift, "platform_architecture")
    assert filtered["category"] == "platform_architecture"
    assert 0 <= filtered["score"] <= 100


def test_empty_syllabus_fallback():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass", "unknown")
    s = d.get_syllabus()
    assert "platform_architecture" in s["categories"]


def test_cli_invocation():
    import subprocess, sys
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run([
        sys.executable, os.path.join(src, "src", "cli.py"),
        "--instance", "https://dev.example.com",
        "--user", "admin", "--password", "pass",
        "--output", "/tmp/drift_test"
    ], capture_output=True, text=True)
    assert result.returncode != 2


def test_multiple_releases():
    d_z = CSADriftDetector("https://dev.example.com", "admin", "pass", "zurich")
    d_a = CSADriftDetector("https://dev.example.com", "admin", "pass", "australia")
    sz = d_z.get_syllabus()
    sa = d_a.get_syllabus()
    # Australia has AI Agent Studio which Zurich lacks
    assert "AI Agent Studio" in sa["categories"].get("platform_architecture", [])
    assert "AI Agent Studio" not in sz["categories"].get("platform_architecture", [])


def test_fetch_instance_features_mock():
    d = CSADriftDetector("https://dev.example.com", "admin", "pass")
    feats = d.fetch_instance_features()
    assert isinstance(feats, list)
    assert len(feats) >= 10  # all table_map items mock-accepted


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
