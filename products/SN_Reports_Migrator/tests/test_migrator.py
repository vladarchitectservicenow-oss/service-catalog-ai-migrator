#!/usr/bin/env python3
"""
SN Reports Migrator — Unit Tests
Copyright: Vladimir Kapustin
License: AGPL-3.0
"""

import json
import os
import tempfile
import pytest

from src.migrator import (
    migrate_report,
    batch_migrate,
    transform_filter,
    transform_group_by,
    transform_aggregation,
    transform_order_by,
    export_json,
    import_json,
    validate_migration,
    batch_validate,
    LEGACY_TO_NEXT_TYPE_MAP,
    DEFAULT_TYPE,
)


# ---------------------------------------------------------------------------
# 1. transform_filter
# ---------------------------------------------------------------------------
def test_transform_filter_conditions():
    data = {
        "conditions": [
            {"field": "active", "operator": "=", "value": "true"},
            {"field": "priority", "operator": "!=", "value": "1"},
        ]
    }
    assert transform_filter(data) == "active=true^priority!=1"


def test_transform_filter_empty():
    assert transform_filter(None) == ""
    assert transform_filter({"conditions": []}) == ""
    assert transform_filter("raw string") == ""  # non-dict handling


# ---------------------------------------------------------------------------
# 2. transform_group_by
# ---------------------------------------------------------------------------
def test_transform_group_by():
    assert transform_group_by("category, subcategory") == ["category", "subcategory"]
    assert transform_group_by(None) == []
    assert transform_group_by("") == []


# ---------------------------------------------------------------------------
# 3. transform_aggregation
# ---------------------------------------------------------------------------
def test_transform_aggregation():
    assert transform_aggregation("sum") == "SUM"
    assert transform_aggregation("AVG") == "AVG"
    assert transform_aggregation("invalid") == "COUNT"
    assert transform_aggregation(None) == "COUNT"


# ---------------------------------------------------------------------------
# 4. transform_order_by
# ---------------------------------------------------------------------------
def test_transform_order_by():
    result = transform_order_by("-number,name")
    assert result == [
        {"field": "number", "direction": "desc"},
        {"field": "name", "direction": "asc"},
    ]
    assert transform_order_by(None) == []
    assert transform_order_by("") == []


# ---------------------------------------------------------------------------
# 5. migrate_report single record
# ---------------------------------------------------------------------------
def test_migrate_report():
    legacy = {
        "sys_id": "abc123",
        "title": "Open Incidents",
        "table": "incident",
        "type": "bar",
        "filter": {
            "conditions": [{"field": "state", "operator": "=", "value": "1"}]
        },
        "group_by": "category",
        "aggregation": "COUNT",
        "order_by": "-opened_at",
    }
    migrated = migrate_report(legacy)

    assert migrated["report_type"] == "bar"
    assert migrated["table"] == "incident"
    assert migrated["query"] == "state=1"
    assert migrated["group_by"] == ["category"]
    assert migrated["aggregation"] == "COUNT"
    assert migrated["order_by"] == [{"field": "opened_at", "direction": "desc"}]
    assert "type" not in migrated
    assert "filter" not in migrated
    assert migrated["sys_id"] == "abc123"


# ---------------------------------------------------------------------------
# 6. batch_migrate
# ---------------------------------------------------------------------------
def test_batch_migrate():
    reports = [
        {"type": "bar", "table": "incident", "filter": None},
        {"type": "line", "table": "problem", "filter": None},
        {"type": "unknown_type", "table": "change_request", "filter": None},
    ]
    migrated = batch_migrate(reports)
    assert len(migrated) == 3
    assert migrated[0]["report_type"] == "bar"
    assert migrated[1]["report_type"] == "line"
    assert migrated[2]["report_type"] == DEFAULT_TYPE


# ---------------------------------------------------------------------------
# 7. unknown type fallback
# ---------------------------------------------------------------------------
def test_unknown_type_fallback():
    legacy = {"type": "nonexistent", "table": "cmdb_ci"}
    migrated = migrate_report(legacy)
    assert migrated["report_type"] == DEFAULT_TYPE


# ---------------------------------------------------------------------------
# 8. schedule preservation
# ---------------------------------------------------------------------------
def test_migrate_report_preserves_schedule():
    legacy = {
        "type": "pie",
        "table": "task",
        "schedule": {"frequency": "daily", "recipients": ["admin@example.com"]},
        "filter": None,
    }
    migrated = migrate_report(legacy)
    assert migrated.get("frequency") == "daily"
    assert migrated.get("recipients") == ["admin@example.com"]
    assert "schedule" not in migrated


# ---------------------------------------------------------------------------
# 9. export_json / import_json round-trip
# ---------------------------------------------------------------------------
def test_export_import_round_trip():
    reports = [
        {"report_type": "list", "table": "incident", "query": "active=true"},
        {"report_type": "bar", "table": "problem", "query": ""},
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "reports.json")
        export_json(reports, path)
        imported = import_json(path)
    assert imported == reports


# ---------------------------------------------------------------------------
# 10. validate_migration / batch_validate
# ---------------------------------------------------------------------------
def test_validate_migration_and_batch():
    original = {
        "type": "column",
        "table": "incident",
        "filter": None,
        "group_by": "state",
        "aggregation": "SUM",
    }
    migrated = migrate_report(original)
    assert validate_migration(original, migrated) is None

    # Force a mismatch
    bad = dict(migrated)
    bad["report_type"] = "list"
    assert validate_migration(original, bad) is not None

    originals = [original, original]
    mig_good = [migrate_report(original), migrate_report(original)]
    results = batch_validate(originals, mig_good)
    assert all(r["status"] == "PASS" for r in results)

    results_fail = batch_validate(originals, [bad, bad])
    assert all(r["status"] == "FAIL" for r in results_fail)

    # Empty file import
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "empty.json")
        export_json([], path)
        assert import_json(path) == []
