"""Async fetchers for each ServiceNow table in the discovery process.

Each function fetches data from one logical domain (catalog items,
workflows, script includes, business rules, REST integrations,
and request history).  All functions take a ServiceNowClient as their
first argument and return typed lists of Pydantic models.  Errors are
logged and swallowed — a failing table never crashes the discovery.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from src.models import (
    BusinessRule,
    CatalogItem,
    RequestHistory,
    RESTIntegration,
    ScriptInclude,
    Workflow,
    WorkflowActivity,
)
from src.servicenow.client import ServiceNowClient

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────


def _to_bool(val: str | bool | None, default: bool = True) -> bool:
    """Normalise ServiceNow boolean strings into Python bools."""
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    return str(val).lower() in ("true", "1", "yes")


def _to_int(val: str | int | None, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _to_float(val: str | float | None, default: float | None = None) -> float | None:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_sys_id(rec: dict) -> str:
    return rec.get("sys_id", "") or ""


# ── Catalog Items ──────────────────────────────────────────────────────────


async def fetch_catalog_items(
    client: ServiceNowClient,
    max_items: int = 500,
    include_inactive: bool = False,
) -> list[CatalogItem]:
    """Fetch all catalog items with their variables and workflow links.

    For each catalog item the function:

    * queries ``sc_item_option`` (variable definitions) via ``cat_item``
    * queries ``sc_cat_item_producer`` to find an associated workflow
    """
    try:
        query = "" if include_inactive else "active=true"
        records = await client.get_all_records(
            "sc_cat_item",
            query=query,
            page_size=500,
            fields=[
                "sys_id",
                "name",
                "short_description",
                "description",
                "category",
                "active",
                "sys_class_name",
            ],
        )
    except Exception as exc:
        logger.error("Failed to fetch catalog items from sc_cat_item: %s", exc)
        return []

    # Respect caller's limit
    records = records[:max_items]
    logger.info("Fetched %d catalog item record(s); resolving variables + workflows...", len(records))

    items: list[CatalogItem] = []
    for rec in records:
        sid = _safe_sys_id(rec)

        # ── Variables (variable definitions) ───────────────────────────
        variables: list[dict] = []
        try:
            options = await client.get_all_records(
                "sc_item_option",
                query=f"cat_item={sid}",
                fields=["sys_id", "name", "type", "mandatory", "default_value", "question_text"],
            )
            variables = options
        except Exception as exc:
            logger.warning("Variables lookup failed for catalog item %s: %s", sid, exc)

        # ── Workflow link via sc_cat_item_producer ─────────────────────
        workflow_id: str | None = None
        try:
            producers = await client.get_all_records(
                "sc_cat_item_producer",
                query=f"producer={sid}",
                fields=["workflow"],
            )
            if producers:
                workflow_id = producers[0].get("workflow") or None
        except Exception as exc:
            logger.warning("Producer/workflow lookup failed for catalog item %s: %s", sid, exc)

        items.append(
            CatalogItem(
                sys_id=sid,
                name=rec.get("name", "") or "",
                short_description=rec.get("short_description"),
                description=rec.get("description"),
                category=rec.get("category"),
                active=_to_bool(rec.get("active"), True),
                workflow_id=workflow_id,
                variables=variables,
            )
        )

    logger.info("Resolved %d CatalogItem(s)", len(items))
    return items


# ── Workflows ──────────────────────────────────────────────────────────────


async def fetch_workflows(client: ServiceNowClient) -> list[Workflow]:
    """Fetch all workflow definitions and their activities.

    Queries ``wf_workflow`` and, for every row, collects matching
    ``wf_activity`` rows.
    """
    try:
        wf_records = await client.get_all_records(
            "wf_workflow",
            fields=["sys_id", "name", "table", "active"],
        )
    except Exception as exc:
        logger.error("Failed to fetch wf_workflow: %s", exc)
        return []

    logger.info("Fetched %d workflow record(s); resolving activities...", len(wf_records))

    workflows: list[Workflow] = []
    for wf in wf_records:
        wf_sid = _safe_sys_id(wf)

        # ── Activities ─────────────────────────────────────────────────
        activities: list[WorkflowActivity] = []
        try:
            act_records = await client.get_all_records(
                "wf_activity",
                query=f"workflow={wf_sid}",
                fields=["sys_id", "name", "activity_definition", "description", "condition"],
            )
            for a in act_records:
                # activity_definition often contains the type (e.g. "Approval", "Run Script", ...)
                act_def = a.get("activity_definition") or a.get("name") or ""
                activities.append(
                    WorkflowActivity(
                        sys_id=_safe_sys_id(a),
                        name=a.get("name") or "",
                        activity_type=act_def,
                        description=a.get("description"),
                        condition=a.get("condition"),
                    )
                )
        except Exception as exc:
            logger.warning("Activity lookup failed for workflow %s: %s", wf_sid, exc)

        workflows.append(
            Workflow(
                sys_id=wf_sid,
                name=wf.get("name") or "",
                table=wf.get("table") or "sc_req_item",
                active=_to_bool(wf.get("active"), True),
                activities=activities,
            )
        )

    logger.info("Resolved %d Workflow(s)", len(workflows))
    return workflows


# ── Script Includes ────────────────────────────────────────────────────────


async def fetch_script_includes(client: ServiceNowClient) -> list[ScriptInclude]:
    """Fetch all server-side Script Includes."""
    try:
        records = await client.get_all_records(
            "sys_script_include",
            fields=["sys_id", "name", "script", "description", "active", "access", "api_name"],
        )
    except Exception as exc:
        logger.error("Failed to fetch sys_script_include: %s", exc)
        return []

    logger.info("Fetched %d script include(s)", len(records))

    return [
        ScriptInclude(
            sys_id=_safe_sys_id(r),
            name=r.get("name") or "",
            script=r.get("script") or "",
            description=r.get("description"),
            active=_to_bool(r.get("active"), True),
            access=r.get("access") or "package_private",
            api_name=r.get("api_name"),
        )
        for r in records
    ]


# ── Business Rules ─────────────────────────────────────────────────────────


async def fetch_business_rules(client: ServiceNowClient) -> list[BusinessRule]:
    """Fetch all Business Rules."""
    try:
        records = await client.get_all_records(
            "sys_script",
            query="",
            fields=[
                "sys_id",
                "name",
                "collection",
                "when",
                "order",
                "active",
                "condition",
                "script",
                "action_insert",
                "action_update",
                "action_delete",
                "action_query",
            ],
        )
    except Exception as exc:
        logger.error("Failed to fetch sys_script: %s", exc)
        return []

    logger.info("Fetched %d business rule(s)", len(records))

    return [
        BusinessRule(
            sys_id=_safe_sys_id(r),
            name=r.get("name") or "",
            table=r.get("collection") or "",
            when=r.get("when") or "",
            order=_to_int(r.get("order"), 100),
            active=_to_bool(r.get("active"), True),
            condition=r.get("condition"),
            script=r.get("script"),
            action_insert=_to_bool(r.get("action_insert"), True),
            action_update=_to_bool(r.get("action_update"), True),
            action_delete=_to_bool(r.get("action_delete"), False),
            action_query=_to_bool(r.get("action_query"), False),
        )
        for r in records
    ]


# ── REST Integrations ──────────────────────────────────────────────────────


async def fetch_integrations(client: ServiceNowClient) -> list[RESTIntegration]:
    """Fetch all outbound REST message definitions."""
    try:
        records = await client.get_all_records(
            "sys_rest_message",
            fields=["sys_id", "name", "endpoint", "http_method", "description", "active"],
        )
    except Exception as exc:
        logger.error("Failed to fetch sys_rest_message: %s", exc)
        return []

    logger.info("Fetched %d integration(s)", len(records))

    return [
        RESTIntegration(
            sys_id=_safe_sys_id(r),
            name=r.get("name") or "",
            endpoint=r.get("endpoint") or "",
            http_method=r.get("http_method") or "GET",
            description=r.get("description"),
            active=_to_bool(r.get("active"), True),
        )
        for r in records
    ]


# ── Request History ────────────────────────────────────────────────────────


async def fetch_request_history(
    client: ServiceNowClient,
    history_days: int = 365,
) -> list[RequestHistory]:
    """Aggregate request history statistics per catalog item.

    Uses ``/api/now/stats/sc_req_item`` to collect:

    * total request count (grouped by ``cat_item``)
    * SLA breach count (filtered by ``approval=rejected``)
    * average fulfillment duration (``closed_at - opened_at``)

    Returns one ``RequestHistory`` per catalog item.
    """
    cutoff = datetime.utcnow() - timedelta(days=history_days)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    history_map: dict[str, RequestHistory] = {}

    # ── 1. Total request count per catalog item ─────────────────────────
    try:
        agg_result = await client.aggregate(
            "sc_req_item",
            query=f"opened_at>={cutoff_str}",
            count="true",
            group_by="cat_item",
        )
        # The stats API returns a list of buckets in result["stats"]["values"],
        # but the exact shape varies.  We handle both common shapes.
        buckets = _extract_aggregation_buckets(agg_result)
    except Exception as exc:
        logger.error("Failed to aggregate sc_req_item counts: %s", exc)
        return []

    for bucket in buckets:
        cat_sys_id = str(_extract_group_value(bucket, "cat_item") or "")
        if not cat_sys_id:
            continue
        count = _to_int(_extract_stat(bucket, "count"))
        history_map[cat_sys_id] = RequestHistory(
            catalog_item_sys_id=cat_sys_id,
            catalog_item_name="",  # resolved later
            total_requests=count,
        )

    if not history_map:
        logger.info("No request history found in the last %d days", history_days)
        return []

    # ── 2. SLA breach count per catalog item ────────────────────────────
    try:
        sla_agg = await client.aggregate(
            "sc_req_item",
            query=f"opened_at>={cutoff_str}^approval=rejected",
            count="true",
            group_by="cat_item",
        )
        sla_buckets = _extract_aggregation_buckets(sla_agg)
    except Exception as exc:
        logger.warning("SLA breach aggregation failed: %s", exc)
        sla_buckets = []

    for bucket in sla_buckets:
        cat_sys_id = str(_extract_group_value(bucket, "cat_item") or "")
        count = _to_int(_extract_stat(bucket, "count"))
        if cat_sys_id in history_map and count:
            history_map[cat_sys_id].sla_breaches = count

    # ── 3. Average fulfillment time per catalog item ────────────────────
    # ServiceNow stats API can compute AVG of a field.  We use
    # the sysparm_avg param on the duration-like field if available.
    try:
        dur_agg = await client.aggregate(
            "sc_req_item",
            query=f"opened_at>={cutoff_str}^closed_atISNOTEMPTY",
            avg="calendar_duration",
            group_by="cat_item",
        )
        dur_buckets = _extract_aggregation_buckets(dur_agg)
    except Exception as exc:
        logger.warning("Duration aggregation failed: %s", exc)
        dur_buckets = []

    for bucket in dur_buckets:
        cat_sys_id = str(_extract_group_value(bucket, "cat_item") or "")
        avg_ms = _to_float(_extract_stat(bucket, "avg"))
        if cat_sys_id in history_map and avg_ms is not None:
            # calendar_duration is milliseconds; convert to hours
            history_map[cat_sys_id].avg_fulfillment_hours = round(avg_ms / 3_600_000, 2)

    # ── 4. Resolve catalog item names ───────────────────────────────────
    all_cat_ids = list(history_map.keys())
    try:
        cat_records = await client.get_all_records(
            "sc_cat_item",
            query=f"sys_idIN{','.join(all_cat_ids)}",
            fields=["sys_id", "name"],
        )
        for cr in cat_records:
            sid = _safe_sys_id(cr)
            if sid in history_map:
                history_map[sid].catalog_item_name = cr.get("name") or sid
    except Exception as exc:
        logger.warning("Name resolution for history items failed: %s", exc)

    # Fill unresolved names
    for h in history_map.values():
        if not h.catalog_item_name:
            h.catalog_item_name = h.catalog_item_sys_id

    logger.info("Resolved %d RequestHistory entries", len(history_map))
    return sorted(history_map.values(), key=lambda h: h.total_requests, reverse=True)


# ── Aggregation helpers (handle varying ServiceNow stats API shapes) ──────


def _extract_aggregation_buckets(agg_result: dict) -> list[dict]:
    """Pull the list of stat buckets from an aggregate result.

    ServiceNow's ``/api/now/stats/`` endpoint returns shapes like:

        {"stats": {"values": [{...}, ...]}}
        {"result": {"stats": {"values": [...]}}}

    We try to normalise this.
    """
    # Unwrap top-level 'result'
    if isinstance(agg_result, dict) and "result" in agg_result:
        result = agg_result["result"]
        if isinstance(result, dict):
            agg_result = result

    stats = agg_result.get("stats") if isinstance(agg_result, dict) else {}
    if isinstance(stats, dict):
        values = stats.get("values")
        if isinstance(values, list):
            return values
    # Sometimes the raw list is returned
    if isinstance(agg_result, list):
        return agg_result
    return []


def _extract_group_value(bucket: dict, field: str) -> str | None:
    """Extract the group-by value from a single aggregation bucket."""
    # Bucket shape: {"groupby_fields": [{"field": "cat_item", "value": "abc123"}], ...}
    for g in bucket.get("groupby_fields", []) or []:
        if isinstance(g, dict) and g.get("field") == field:
            return g.get("value")
    # Fallback: direct key
    return bucket.get(field)


def _extract_stat(bucket: dict, stat_name: str) -> str | int | float | None:
    """Return a named stat from a bucket's stats dict."""
    stats = bucket.get("stats", {}) if isinstance(bucket, dict) else {}
    if isinstance(stats, dict):
        for s in stats.get("values", []) or []:
            if isinstance(s, dict):
                if s.get("stat") == stat_name:
                    return s.get("value")
    # Direct key fallback
    return bucket.get(stat_name)
