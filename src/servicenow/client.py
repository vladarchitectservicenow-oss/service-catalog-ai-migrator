"""Async ServiceNow REST API client with retry, pagination, and rate limiting."""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class ServiceNowClient:
    """Async HTTPX client for ServiceNow REST API.

    Uses basic auth. Handles rate limiting (429), pagination,
    and exponential backoff automatically.
    """

    instance_url: str
    username: str
    password: str
    timeout: float = 30.0
    max_retries: int = 3
    backoff_base: float = 2.0
    _client: Optional[httpx.AsyncClient] = field(default=None, init=False)
    _closed: bool = field(default=False, init=False)

    def __post_init__(self):
        if not self.instance_url or not self.password:
            raise ValueError("instance_url and password are required")
        self.instance_url = self.instance_url.rstrip("/")

    async def _ensure_client(self):
        if self._closed:
            raise RuntimeError("Client is closed")
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.instance_url,
                auth=(self.username, self.password),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(self.timeout),
            )

    async def close(self):
        if self._client and not self._closed:
            await self._client.aclose()
            self._closed = True

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
        json_body: Optional[dict] = None,
    ) -> httpx.Response:
        """Send request with retry and exponential backoff."""
        await self._ensure_client()
        last_exc = None
        for attempt in range(self.max_retries):
            try:
                r = await self._client.request(method, path, params=params, json=json_body)
                if r.status_code == 429:
                    retry_after = int(r.headers.get("Retry-After", self.backoff_base**attempt))
                    logger.warning(f"Rate limited, waiting {retry_after}s (attempt {attempt+1})")
                    await asyncio.sleep(retry_after)
                    continue
                r.raise_for_status()
                return r
            except httpx.TimeoutException as e:
                last_exc = e
                wait = self.backoff_base**attempt
                logger.warning(f"Timeout, retrying in {wait}s (attempt {attempt+1})")
                await asyncio.sleep(wait)
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500:
                    wait = self.backoff_base**attempt
                    logger.warning(f"Server error {e.response.status_code}, retrying in {wait}s")
                    await asyncio.sleep(wait)
                    last_exc = e
                else:
                    raise
        raise last_exc or RuntimeError("Max retries exceeded")

    async def get_records(
        self,
        table: str,
        query: str = "",
        limit: int = 500,
        offset: int = 0,
        fields: Optional[list[str]] = None,
    ) -> list[dict]:
        """Fetch records from a ServiceNow table.

        Args:
            table: Table name (e.g. 'sc_cat_item', 'sc_req_item').
            query: Encoded query string (ServiceNow filter syntax).
            limit: Max records per page (max 10000).
            offset: Offset for pagination.
            fields: Specific field names to return (comma-separated).

        Returns:
            List of record dicts.
        """
        params = {
            "sysparm_limit": min(limit, 10000),
            "sysparm_offset": offset,
        }
        if query:
            params["sysparm_query"] = query
        if fields:
            params["sysparm_fields"] = ",".join(fields)

        r = await self._request("GET", f"/api/now/table/{table}", params=params)
        return r.json()["result"]

    async def get_all_records(
        self,
        table: str,
        query: str = "",
        page_size: int = 500,
        fields: Optional[list[str]] = None,
    ) -> list[dict]:
        """Fetch ALL records from a table using automatic pagination.

        Args:
            table: Table name.
            query: Encoded query filter string.
            page_size: Records per page (max 500 for efficiency).
            fields: Specific field names.

        Returns:
            Complete list of all matching record dicts.
        """
        all_records = []
        offset = 0
        while True:
            batch = await self.get_records(
                table, query=query, limit=page_size, offset=offset, fields=fields
            )
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return all_records

    async def get_record(self, table: str, sys_id: str) -> Optional[dict]:
        """Fetch a single record by sys_id."""
        r = await self._request("GET", f"/api/now/table/{table}/{sys_id}")
        result = r.json()["result"]
        return result if result else None

    async def count_records(self, table: str, query: str = "") -> int:
        """Count records matching a query."""
        params = {"sysparm_count": "true"}
        if query:
            params["sysparm_query"] = query
        r = await self._request("GET", f"/api/now/table/{table}", params=params)
        return int(r.headers.get("X-Total-Count", 0))

    async def aggregate(self, table: str, query: str = "", **agg_params) -> dict:
        """Run an aggregate query on a table.

        Args:
            table: Table name.
            query: Encoded query string.
            **agg_params: Aggregation params (avg, count, sum, min, max, group_by).

        Returns:
            Aggregate result dict.
        """
        params = {"sysparm_query": query} if query else {}
        params.update(agg_params)
        r = await self._request("GET", f"/api/now/stats/{table}", params=params)
        return r.json()["result"]

    async def test_connection(self) -> bool:
        """Test that the connection works — returns True if authenticated."""
        try:
            await self.count_records("sys_user", query="sys_id=0")
            return True
        except Exception:
            return False
