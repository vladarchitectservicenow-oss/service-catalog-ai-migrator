#!/usr/bin/env python3
"""
SN Reports Migrator — ServiceNow Core UI Reports Migration Assistant
Copyright: Vladimir Kapustin
License: AGPL-3.0

Maps legacy Core UI Report definitions to Next Experience compatible report
definitions.
"""

import json
import copy
from typing import List, Dict, Any, Optional


DEFAULT_TYPE = "list"

LEGACY_TO_NEXT_TYPE_MAP = {
    "bar": "bar",
    "column": "column",
    "line": "line",
    "pie": "pie",
    "doughnut": "doughnut",
    "funnel": "funnel",
    "map": "map",
    "single_score": "single_score",
    "single_score_percentage": "single_score",
    "list": "list",
    "calendar": "calendar",
    "gantt": "gantt",
    "report_builder": "list",
    "legacy_chart": "bar",
    "pivot": "list",
}


def _get_next_type(legacy_type: str) -> str:
    return LEGACY_TO_NEXT_TYPE_MAP.get(legacy_type, DEFAULT_TYPE)


def transform_filter(filter_dict: Optional[Dict[str, Any]]) -> str:
    """
    Convert a legacy structured filter dict into an encoded query string.

    Supports a simple list of conditions under 'conditions':
    [
      {"field": "active", "operator": "=", "value": "true"},
      {"field": "priority", "operator": "!=", "value": "1"},
    ]
    """
    if not isinstance(filter_dict, dict):
        return ""

    conditions = filter_dict.get("conditions", [])
    if not isinstance(conditions, list):
        return ""

    parts: List[str] = []
    for cond in conditions:
        if not isinstance(cond, dict):
            continue
        field = str(cond.get("field", ""))
        operator = str(cond.get("operator", ""))
        value = str(cond.get("value", ""))
        if not field or not operator:
            continue
        parts.append(f"{field}{operator}{value}")

    return "^".join(parts)


def transform_group_by(group_by: Optional[str]) -> List[str]:
    """Legacy group_by may be a comma-separated string. Return a list."""
    if not group_by:
        return []
    return [g.strip() for g in str(group_by).split(",") if g.strip()]


def transform_aggregation(aggregation: Optional[str]) -> str:
    """Normalize aggregation value or default to COUNT."""
    valid = {"COUNT", "MIN", "MAX", "AVG", "SUM"}
    if aggregation and str(aggregation).upper() in valid:
        return str(aggregation).upper()
    return "COUNT"


def transform_order_by(order_by: Optional[str]) -> List[Dict[str, str]]:
    """
    Convert a comma-separated order_by string into a structured list.
    e.g. "-number,name" -> [{"field": "number", "direction": "desc"}, ...]
    """
    if not order_by:
        return []

    result: List[Dict[str, str]] = []
    for token in str(order_by).split(","):
        token = token.strip()
        if not token:
            continue
        if token.startswith("-"):
            result.append({"field": token[1:], "direction": "desc"})
        else:
            result.append({"field": token, "direction": "asc"})
    return result


def migrate_report(legacy: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform a single legacy Core UI report record into a Next Experience
    compatible report definition dict.
    """
    migrated = copy.deepcopy(legacy)

    migrated["report_type"] = _get_next_type(legacy.get("type", DEFAULT_TYPE))

    raw_filter = legacy.get("filter")
    if isinstance(raw_filter, dict):
        migrated["query"] = transform_filter(raw_filter)
    elif isinstance(raw_filter, str):
        migrated["query"] = raw_filter
    else:
        migrated["query"] = ""

    migrated["group_by"] = transform_group_by(legacy.get("group_by"))
    migrated["aggregation"] = transform_aggregation(legacy.get("aggregation"))
    migrated["order_by"] = transform_order_by(legacy.get("order_by"))

    # Preserve scheduling metadata if present
    schedule = legacy.get("schedule")
    if isinstance(schedule, dict):
        migrated["frequency"] = schedule.get("frequency", "")
        migrated["recipients"] = schedule.get("recipients", [])

    # Remove legacy-only keys that have no Next Experience equivalent
    migrated.pop("type", None)
    migrated.pop("filter", None)
    migrated.pop("schedule", None)

    return migrated


def batch_migrate(legacy_reports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Migrate a batch of legacy report definitions."""
    return [migrate_report(r) for r in legacy_reports]


def export_json(migrated_reports: List[Dict[str, Any]], filepath: str) -> None:
    """Write migrated reports to a JSON file."""
    with open(filepath, "w", encoding="utf-8") as fh:
        json.dump(migrated_reports, fh, indent=2, ensure_ascii=False)


def import_json(filepath: str) -> List[Dict[str, Any]]:
    """Read legacy or migrated reports from a JSON file."""
    with open(filepath, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        return [data]
    return list(data)


def validate_migration(original: Dict[str, Any], migrated: Dict[str, Any]) -> Optional[str]:
    """
    Compare an original record with its migrated counterpart.
    Returns a human-readable string if validation fails, otherwise None.
    """
    if not migrated.get("table"):
        return "Missing 'table' field in migrated record."

    expected_type = _get_next_type(original.get("type", DEFAULT_TYPE))
    if migrated.get("report_type") != expected_type:
        return f"Expected report_type='{expected_type}', got '{migrated.get('report_type')}'."

    if not isinstance(migrated.get("group_by", []), list):
        return "'group_by' must be a list."

    if migrated.get("aggregation", "") not in {"COUNT", "MIN", "MAX", "AVG", "SUM"}:
        return "Invalid or missing 'aggregation'."

    return None


def batch_validate(original_reports: List[Dict[str, Any]],
                   migrated_reports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Validate a full batch pairwise.
    Returns a list of dicts with keys: index, status, message.
    """
    results: List[Dict[str, Any]] = []
    for idx, (orig, mig) in enumerate(zip(original_reports, migrated_reports)):
        msg = validate_migration(orig, mig)
        if msg:
            results.append({"index": idx, "status": "FAIL", "message": msg})
        else:
            results.append({"index": idx, "status": "PASS", "message": "OK"})
    return results
