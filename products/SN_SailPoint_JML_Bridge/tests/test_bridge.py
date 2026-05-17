#!/usr/bin/env python3
"""
Tests for SN SailPoint JML Bridge
Copyright (C) 2026  Vladimir Kapustin
License: AGPL-3.0
"""
import json, os, sys, tempfile
from unittest.mock import patch, MagicMock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.bridge import SailPointBridge


def test_parse_hr_event():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get", return_value=MagicMock(status_code=200, json=lambda: {"result": {"sys_id": "u1", "user_name": "jdoe", "email": "jdoe@ex.com"}})):
        u = b.fetch_user("u1")
    assert u["user_name"] == "jdoe"


def test_fetch_active_user_roles():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get", return_value=MagicMock(status_code=200, json=lambda: {"result": [{"role": {"name": "itil"}}]})):
        roles = b.fetch_user_roles("u1")
    assert "itil" in roles


def test_map_to_sailpoint_roles():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    assert set(b.map_roles(["itil", "admin"])) == set(["ITIL Analyst", "System Administrator"])


def test_create_identity_request():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.post", return_value=MagicMock(status_code=201, json=lambda: {"id": "r1"})):
        r = b.create_identity_request({"user_name": "jdoe", "email": "jdoe@ex.com"}, ["ITIL Analyst"], "join")
    assert r["status"] == "submitted"
    assert "request_id" in r


def test_handle_join_event():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get") as mg:
        mg.side_effect = [
            MagicMock(status_code=200, json=lambda: {"result": {"user_name": "jdoe", "email": "jdoe@ex.com", "department": "IT"}}),
            MagicMock(status_code=200, json=lambda: {"result": [{"role": {"name": "itil"}}]}),
        ]
        with patch("src.bridge.requests.post", return_value=MagicMock(status_code=201, json=lambda: {"id": "r1"})):
            res = b.process_event("join", "u1")
    assert res["event"] == "join"
    assert "ITIL Analyst" in res["sp_roles"]


def test_handle_move_event():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get") as mg:
        mg.side_effect = [
            MagicMock(status_code=200, json=lambda: {"result": {"user_name": "jdoe", "email": "jdoe@ex.com"}}),
            MagicMock(status_code=200, json=lambda: {"result": []}),
        ]
        with patch("src.bridge.requests.post", return_value=MagicMock(status_code=201)):
            res = b.process_event("move", "u1")
    assert res["event"] == "move"


def test_handle_leave_event():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get") as mg:
        mg.side_effect = [
            MagicMock(status_code=200, json=lambda: {"result": {"user_name": "jdoe", "email": "jdoe@ex.com"}}),
            MagicMock(status_code=200, json=lambda: {"result": [{"role": {"name": "admin"}}]}),
        ]
        with patch("src.bridge.requests.post", return_value=MagicMock(status_code=201)):
            res = b.process_event("leave", "u1")
    assert res["event"] == "leave"


def test_audit_trail_generation():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    events = [{"event": "join", "user": "jdoe"}]
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "audit.json")
        b.generate_audit(events, path)
        data = json.load(open(path))
        assert data["count"] == 1


def test_error_handling():
    b = SailPointBridge("https://sn", "admin", "pass", "https://sp", "tok")
    with patch("src.bridge.requests.get", return_value=MagicMock(status_code=500, json=lambda: {}, raise_for_status=lambda: (_ for _ in ()).throw(Exception("fail")))):
        res = b.process_event("join", "u1")
    assert res["status"] == "error"


def test_cli_invocation():
    import subprocess, sys
    src = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    result = subprocess.run([
        sys.executable, os.path.join(src, "src", "cli.py"),
        "--sn-url", "https://sn", "--sn-user", "admin", "--sn-pass", "pass",
        "--sp-url", "https://sp", "--sp-token", "tok",
        "--event", "join", "--user", "u1"
    ], capture_output=True, text=True)
    assert result.returncode != 2


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-q"])
