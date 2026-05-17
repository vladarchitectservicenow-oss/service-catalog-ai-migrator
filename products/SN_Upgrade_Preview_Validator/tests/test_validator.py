#!/usr/bin/env python3
"""
Tests for SN Upgrade Preview Validator
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys, hashlib, tempfile
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.validator import UpgradePreviewValidator


class FakeResp:
    def __init__(self, json_data, status=200):
        self._json = json_data
        self.status_code = status
    def json(self):
        return self._json
    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception("HTTP error")


def test_fetch_skipped_records():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    mock_data = {
        "result": [
            {"sys_id": "a1", "target_name": "Script include Foo", "table_name": "sys_script_include", "payload": "<?xml\u003efoo</?>", "type": "skip"},
            {"sys_id": "a2", "target_name": "Business Rule Bar", "table_name": "sys_script", "payload": "<script>//bar</script>", "type": "skip"},
            {"sys_id": "a3", "target_name": "UI Action Baz", "table_name": "sys_ui_action", "payload": "<ui>//baz</ui>", "type": "skipped"},
        ]
    }
    with patch("src.validator.requests.get", return_value=FakeResp(mock_data)):
        recs = v.fetch_skipped_records()
    assert len(recs) == 3
    assert recs[0]["sys_id"] == "a1"


def test_baseline_load():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump([{"sys_id": "a1", "payload": "old"}, {"sys_id": "a2", "payload": "old2"}], f)
        path = f.name
    try:
        base = v.load_baseline(path)
        assert "a1" in base
        assert "a2" in base
    finally:
        os.unlink(path)
    assert v.load_baseline(None) == {}
    assert v.load_baseline("/tmp/nonexistent_xyz.json") == {}


def test_delta_added():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [{"sys_id": "a1", "payload": "cur"}, {"sys_id": "b1", "payload": "new"}]
    baseline = {"a1": {"sys_id": "a1", "payload": "cur"}}
    delta = v.compute_delta(skipped, baseline)
    assert len(delta["added"]) == 1
    assert delta["added"][0]["sys_id"] == "b1"


def test_delta_removed():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [{"sys_id": "a1", "payload": "cur"}]
    baseline = {"a1": {"sys_id": "a1", "payload": "cur"}, "c1": {"sys_id": "c1", "payload": "old"}}
    delta = v.compute_delta(skipped, baseline)
    assert len(delta["removed"]) == 1
    assert delta["removed"][0]["sys_id"] == "c1"


def test_delta_modified():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [{"sys_id": "a1", "payload": "changed"}]
    baseline = {"a1": {"sys_id": "a1", "payload": "old"}}
    delta = v.compute_delta(skipped, baseline)
    assert len(delta["modified"]) == 1


def test_delta_hash_unchanged():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [{"sys_id": "a1", "payload": "same"}]
    baseline = {"a1": {"sys_id": "a1", "payload": "same"}}
    delta = v.compute_delta(skipped, baseline)
    assert len(delta["safe"]) == 1
    assert len(delta["modified"]) == 0


def test_report_markdown_output():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    delta = {"added": [{"sys_id":"n1","target_name":"New","table_name":"tbl"}], "removed":[], "modified":[], "safe":[]}
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "report")
        v.generate_reports(delta, prefix)
        md = open(prefix + ".md").read()
        assert "Added" in md
        assert "New" in md
        assert "| Added" in md


def test_report_json_structure():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    delta = {"added": [], "removed": [], "modified": [], "safe": [{"sys_id":"s1","target_name":"Okay"}]}
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "r")
        v.generate_reports(delta, prefix)
        data = json.load(open(prefix + ".json"))
        assert "summary" in data
        assert "details" in data
        assert data["summary"]["safe"] == 1


def test_filter_by_table():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [
        {"sys_id": "a1", "table_name": "sys_script", "payload": "p"},
        {"sys_id": "a2", "table_name": "sys_ui_action", "payload": "p"},
    ]
    filtered = [r for r in skipped if r.get("table_name") == "sys_script"]
    delta = v.compute_delta(filtered, {})
    assert len(delta["added"]) == 1


def test_empty_baseline():
    v = UpgradePreviewValidator("https://dev.example.com", "admin", "pass")
    skipped = [{"sys_id": "a1", "payload": "p"}]
    delta = v.compute_delta(skipped, {})
    assert len(delta["added"]) == 1


def test_cli_run():
    import subprocess, sys
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run([
        sys.executable, os.path.join(src, "src", "cli.py"),
        "--instance", "https://dev.example.com",
        "--user", "admin", "--password", "pass",
        "--output", "/tmp/cli_test_out"
    ], capture_output=True, text=True)
    # CLI calls requests.get to real instance — expect failure unless mocked at subprocess level.
    # For unit test we verify argparse by checking it fails with connection error (not arg error).
    assert result.returncode != 2  # argparse error would be 2


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
