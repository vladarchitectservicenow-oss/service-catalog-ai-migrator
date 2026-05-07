"""Discovery engine orchestrating parallel fetches against a ServiceNow instance."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from src.models import DiscoveryResult
from src.servicenow.client import ServiceNowClient
from src.servicenow.fetchers import (
    fetch_business_rules,
    fetch_catalog_items,
    fetch_integrations,
    fetch_request_history,
    fetch_script_includes,
    fetch_workflows,
)

logger = logging.getLogger(__name__)


class DiscoveryEngine:
    """Orchestrates a full ServiceNow instance discovery.

    All six fetchers run in parallel via ``asyncio.gather`` so the total
    wall-clock time is roughly the slowest individual query.  A
    configurable dictionary controls behaviour (limits, date ranges,
    inclusion of inactive records).
    """

    def __init__(self, client: ServiceNowClient, config: dict[str, Any] | None = None) -> None:
        """*client* — a ready-to-use :class:`ServiceNowClient`.

        *config* accepts these optional keys:

        ==================== ======= ==========================================
        key                  default description
        ==================== ======= ==========================================
        ``max_catalog_items`` 500     max catalog items returned
        ``history_days``      365    lookback window for request history
        ``include_inactive``  False  when ``True`` include inactive records
        ==================== ======= ==========================================
        """
        self.client = client
        self.config = config or {}
        self.max_catalog_items: int = int(self.config.get("max_catalog_items", 500))
        self.history_days: int = int(self.config.get("history_days", 365))
        self.include_inactive: bool = bool(self.config.get("include_inactive", False))

    async def discover_all(self) -> DiscoveryResult:
        """Run every fetcher concurrently and return a complete
        :class:`DiscoveryResult`.

        If a single fetcher fails the error is logged and its
        corresponding list stays empty — the rest of the discovery
        continues.
        """
        logger.info("Starting full ServiceNow discovery against %s ...", self.client.instance_url)
        start = datetime.utcnow()

        results = await asyncio.gather(
            fetch_catalog_items(self.client, self.max_catalog_items, self.include_inactive),
            fetch_workflows(self.client),
            fetch_script_includes(self.client),
            fetch_business_rules(self.client),
            fetch_integrations(self.client),
            fetch_request_history(self.client, self.history_days),
            return_exceptions=True,
        )

        # Unpack with guard — any exception becomes an empty list
        catalog_items = self._unwrap(results[0], "catalog_items")
        workflows = self._unwrap(results[1], "workflows")
        script_includes = self._unwrap(results[2], "script_includes")
        business_rules = self._unwrap(results[3], "business_rules")
        integrations = self._unwrap(results[4], "integrations")
        history = self._unwrap(results[5], "history")

        elapsed = (datetime.utcnow() - start).total_seconds()
        logger.info(
            "Discovery complete in %.1fs — items=%d, wf=%d, si=%d, br=%d, int=%d, hist=%d",
            elapsed,
            len(catalog_items),
            len(workflows),
            len(script_includes),
            len(business_rules),
            len(integrations),
            len(history),
        )

        return DiscoveryResult(
            instance_url=self.client.instance_url,
            catalog_items=catalog_items,
            workflows=workflows,
            script_includes=script_includes,
            business_rules=business_rules,
            integrations=integrations,
            history=history,
        )

    @staticmethod
    def _unwrap(result: Any, label: str) -> list:
        """Return *result* if it's a list; on exception return empty list."""
        if isinstance(result, Exception):
            logger.error("Fetcher '%s' raised: %s", label, result)
            return []
        if not isinstance(result, list):
            logger.warning("Fetcher '%s' returned non-list %r — treating as empty", label, type(result))
            return []
        return result
