#!/usr/bin/env python3
"""
Tests for SN NowAssist FreeForm Triage
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.triage_engine import TriageEngine


def test_parsing_keyword_extraction():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    assert "vpn" in engine.extract_keywords("My VPN is broken")
    assert "broken" in engine.extract_keywords("The printer is broken")
    assert engine.extract_keywords("") == []


def test_catalog_match():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    item, cat, conf = engine.match_catalog("I can't access my email")
    assert item == "Email Account Issue"
    assert conf >= 0.8


def test_confidence_scoring():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    _, _, conf1 = engine.match_catalog("VPN not working")
    _, _, conf2 = engine.match_catalog("Something is weird")
    assert conf1 > conf2


def test_low_confidence_flag():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    result = engine.triage("u123", "Something is weird")
    assert result["needs_review"] is True
    assert result["confidence"] < 0.5


def test_catalog_item_creation():
    import tempfile
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump([{"user": "u1", "text": "password reset"}], f)
        path = f.name
    result = engine.triage("u1", "password reset")
    assert result["catalog_item"] == "Password Reset"
    os.unlink(path)


def test_empty_input():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    result = engine.triage("u1", "     ")
    assert result["catalog_item"] == "General Inquiry"
    assert result["needs_review"] is True


def test_shortcuts_expansion():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    result = engine.triage("u1", "vpn")
    assert result["catalog_item"] == "VPN Access Request"


def test_multi_category_disambiguation():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    # "password" is 0.9 identity, "slow" is 0.6 incident; highest wins
    item, cat, conf = engine.match_catalog("password slow")
    assert item == "Password Reset"
    assert conf >= 0.9


def test_json_report():
    import tempfile
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    r = engine.triage("u1", "printer broken")
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "report.json")
        engine.generate_report([r], path)
        data = json.load(open(path))
        assert "total" in data
        assert data["total"] == 1


def test_batch_triage():
    engine = TriageEngine("https://dev.example.com", "admin", "pass")
    results = engine.batch_triage([
        {"user": "u1", "text": "vpn down"},
        {"user": "u2", "text": "email not working"},
    ])
    assert len(results) == 2
    assert results[0]["catalog_item"] == "VPN Access Request"
    assert results[1]["catalog_item"] == "Email Account Issue"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
