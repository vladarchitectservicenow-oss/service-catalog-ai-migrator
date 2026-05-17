#!/usr/bin/env python3
"""
Tests for SN Flow Designer Documenter
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys, tempfile
from unittest.mock import patch, MagicMock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.documenter import FlowDocumenter


def fake_fetch_actions(*args, **kwargs):
    return {
        "result": [
            {"sys_id": "a1", "name": "Send Slack", "description": "Sends a Slack message", "active": "true"},
            {"sys_id": "a2", "name": "Create Ticket", "description": "", "active": "true"},
        ]
    }

def fake_fetch_flows(*args, **kwargs):
    return {
        "result": [
            {"sys_id": "f1", "name": "Onboarding", "description": "HR onboarding", "active": "true", "internal_name": "onboarding_flow"},
        ]
    }


def test_fetch_custom_actions():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    with patch("src.documenter.requests.get", return_value=MagicMock(status_code=200, json=lambda: fake_fetch_actions())):
        actions = d.fetch_custom_actions()
    assert len(actions) == 2
    assert actions[0]["name"] == "Send Slack"


def test_fetch_flows():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    with patch("src.documenter.requests.get", return_value=MagicMock(status_code=200, json=lambda: fake_fetch_flows())):
        flows = d.fetch_flows()
    assert len(flows) == 1
    assert flows[0]["internal_name"] == "onboarding_flow"


def test_generate_markdown():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    actions = [
        {"name": "Send Slack", "description": "Sends msg", "active": "true"},
        {"name": "Create Ticket", "description": "", "active": "true"},
    ]
    flows = [{"name": "Onboarding", "internal_name": "onb", "active": "true"}]
    md = d.generate_markdown(actions, flows)
    assert "Send Slack" in md
    assert "Missing documentation" in md
    assert "onb" in md


def test_generate_json():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    actions = [{"name": "A", "description": "", "active": "true"}]
    flows = [{"name": "F", "internal_name": "f1", "active": "true"}]
    data = d.generate_json(actions, flows)
    assert data["meta"]["actions_count"] == 1
    assert "A" in data["warnings"]


def test_empty_flow_handling():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    md = d.generate_markdown([], [])
    assert "Flows (0)" in md
    assert "Actions (0)" in md


def test_missing_description_warning():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    actions = [{"name": "A", "description": "", "active": "true"}]
    flows = []
    md = d.generate_markdown(actions, flows)
    assert "Missing documentation" in md


def test_batch_documentation():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    with patch("src.documenter.requests.get", side_effect=[
        MagicMock(status_code=200, json=lambda: fake_fetch_actions()),
        MagicMock(status_code=200, json=lambda: fake_fetch_flows()),
    ]):
        with tempfile.TemporaryDirectory() as tmpdir:
            prefix = os.path.join(tmpdir, "doc")
            data = d.run(prefix)
            assert os.path.exists(prefix + ".md")
            assert os.path.exists(prefix + ".json")
            assert data["meta"]["actions_count"] == 2


def test_cli_invocation():
    import subprocess, sys
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run([
        sys.executable, os.path.join(src, "src", "cli.py"),
        "--instance", "https://dev.example.com",
        "--user", "admin", "--password", "pass",
        "--output", "/tmp/doc_test"
    ], capture_output=True, text=True)
    assert result.returncode != 2


def test_extract_inputs():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    assert d.extract_inputs({"sys_id": "a1"}) == []


def test_extract_outputs():
    d = FlowDocumenter("https://dev.example.com", "admin", "pass")
    assert d.extract_outputs({"sys_id": "a1"}) == []


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
