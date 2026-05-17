#!/usr/bin/env python3
"""
Tests for SN Data Fabric Governance Scanner
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys, tempfile
from unittest.mock import patch, MagicMock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.governance_scanner import GovernanceScanner


def test_fetch_cmdb():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    with patch("src.governance_scanner.requests.get", return_value=MagicMock(status_code=200, json=lambda: {
        "result": [{"sys_id": "c1", "name": "Server1", "sys_class_name": "cmdb_ci_server", "operational_status": "1"}]
    })):
        recs = d.fetch_cmdb()
    assert len(recs) == 1
    assert recs[0]["name"] == "Server1"


def test_detect_orphan_records():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    recs = [
        {"sys_id": "c1", "name": "A", "sys_class_name": "cmdb_ci_server", "operational_status": "1"},
        {"sys_id": "c2", "name": "B", "sys_class_name": "", "operational_status": "1"},
    ]
    a = d.analyze(recs)
    assert a["orphan_count"] == 1


def test_detect_duplicates():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    recs = [
        {"sys_id": "c1", "name": "Server", "sys_class_name": "cmdb_ci_server", "operational_status": "1"},
        {"sys_id": "c2", "name": "Server", "sys_class_name": "cmdb_ci_server", "operational_status": "1"},
    ]
    a = d.analyze(recs)
    assert a["duplicate_count"] == 1


def test_governance_score():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    recs = [{"sys_id": "c1", "name": "A", "sys_class_name": "cmdb_ci_server", "operational_status": "1"}]
    a = d.analyze(recs)
    assert 0 <= a["score"] <= 100


def test_generate_md_report():
    import tempfile
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    a = d.analyze([{"sys_id": "c1", "name": "A", "sys_class_name": "cmdb_ci_server", "operational_status": "1"}])
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "r")
        d.generate_reports(a, prefix)
        assert os.path.exists(prefix + ".md")
        md = open(prefix + ".md").read()
        assert "Score:" in md


def test_generate_json_report():
    import tempfile
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    a = d.analyze([{"sys_id": "c1", "name": "A", "sys_class_name": "cmdb_ci_server", "operational_status": "1"}])
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "r")
        d.generate_reports(a, prefix)
        data = json.load(open(prefix + ".json"))
        assert "score" in data


def test_filter_by_class():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    recs = [
        {"sys_id": "c1", "sys_class_name": "cmdb_ci_server"},
        {"sys_id": "c2", "sys_class_name": "cmdb_ci_db_instance"},
    ]
    filtered = d.filter_by_class(recs, "cmdb_ci_server")
    assert len(filtered) == 1
    assert filtered[0]["sys_id"] == "c1"


def test_empty_cmdb_handling():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    a = d.analyze([])
    assert a["total"] == 0
    assert a["score"] == 0


def test_cli_invocation():
    import subprocess, sys
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run([
        sys.executable, os.path.join(src, "src", "cli.py"),
        "--instance", "https://dev.example.com", "--user", "admin", "--password", "pass",
        "--output", "/tmp/gov_test"
    ], capture_output=True, text=True)
    assert result.returncode != 2


def test_missing_fields_detection():
    d = GovernanceScanner("https://dev.example.com", "admin", "pass")
    recs = [{"sys_id": "c1", "name": "", "sys_class_name": "cmdb_ci_server", "operational_status": "1"}]
    a = d.analyze(recs)
    assert a["missing_count"] >= 1


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
