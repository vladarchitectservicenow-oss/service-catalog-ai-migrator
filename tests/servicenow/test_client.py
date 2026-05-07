"""Tests for ServiceNow REST client."""

import pytest
from src.servicenow.client import ServiceNowClient


class TestServiceNowClient:
    def test_client_requires_password(self):
        with pytest.raises(ValueError, match="password"):
            ServiceNowClient(instance_url="https://x.service-now.com", username="admin", password="")

    def test_client_requires_instance_url(self):
        with pytest.raises(ValueError, match="instance_url"):
            ServiceNowClient(instance_url="", username="admin", password="pass")

    def test_client_construction(self):
        client = ServiceNowClient(
            instance_url="https://demo.service-now.com",
            username="admin",
            password="secure",
        )
        assert client.instance_url == "https://demo.service-now.com"
        assert client.timeout == 30.0
        assert client.max_retries == 3

    def test_client_strips_trailing_slash(self):
        client = ServiceNowClient(
            instance_url="https://demo.service-now.com/",
            username="admin",
            password="pass",
        )
        assert client.instance_url == "https://demo.service-now.com"

    @pytest.mark.asyncio
    async def test_closed_client_raises(self):
        client = ServiceNowClient(
            instance_url="https://demo.service-now.com",
            username="admin",
            password="pass",
        )
        client._closed = True
        with pytest.raises(RuntimeError):
            await client._ensure_client()


class TestServiceNowClientIntegration:
    """Integration tests requiring a live ServiceNow instance."""

    @pytest.fixture
    def client(self):
        import os

        instance_url = os.environ.get("SN_INSTANCE_URL")
        username = os.environ.get("SN_USERNAME")
        password = os.environ.get("SN_PASSWORD")

        if not all([instance_url, username, password]):
            pytest.skip("SN_INSTANCE_URL, SN_USERNAME, SN_PASSWORD env vars not set")

        return ServiceNowClient(instance_url=instance_url, username=username, password=password)

    @pytest.mark.asyncio
    async def test_count_records(self, client):
        """Test counting records (lightweight connectivity check)."""
        count = await client.count_records("sys_user")
        assert count >= 0
