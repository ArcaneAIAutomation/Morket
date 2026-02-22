"""Unit tests for the credential client."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.integration.credential_client import CredentialClient
from src.middleware.error_handler import CredentialNotFoundError


@pytest.fixture
def client() -> CredentialClient:
    return CredentialClient(
        backend_api_url="https://api.morket.io/api/v1",
        service_key="test-service-key",
        cache_ttl_seconds=300,
        max_retries=3,
    )


@pytest.fixture
def mock_credential() -> dict:
    return {"api_key": "decrypted-secret-value", "provider": "linkedin"}


class TestGetCredential:
    """Tests for CredentialClient.get_credential()."""

    @pytest.mark.asyncio
    async def test_fetches_credential_from_backend(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """Successful fetch returns credential data from envelope."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
            result = await client.get_credential("ws-123", "linkedin")

        assert result == mock_credential

    @pytest.mark.asyncio
    async def test_returns_cached_credential_within_ttl(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """Second call within TTL returns cached value without HTTP call."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            first = await client.get_credential("ws-123", "linkedin")
            second = await client.get_credential("ws-123", "linkedin")

        assert first == mock_credential
        assert second == mock_credential
        # Only one HTTP call — second was served from cache
        assert mock_get.call_count == 1

    @pytest.mark.asyncio
    async def test_refetches_after_ttl_expires(
        self, mock_credential: dict,
    ) -> None:
        """After TTL expires, a fresh fetch is made."""
        short_ttl_client = CredentialClient(
            backend_api_url="https://api.morket.io/api/v1",
            service_key="test-service-key",
            cache_ttl_seconds=0,  # Immediate expiry
            max_retries=3,
        )

        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            await short_ttl_client.get_credential("ws-123", "linkedin")
            await short_ttl_client.get_credential("ws-123", "linkedin")

        # Both calls hit the backend since TTL=0
        assert mock_get.call_count == 2

    @pytest.mark.asyncio
    async def test_raises_credential_not_found_on_404(
        self, client: CredentialClient
    ) -> None:
        """404 from backend raises CredentialNotFoundError immediately (no retries)."""
        mock_response = httpx.Response(
            404,
            json={"success": False, "error": "Not found"},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            with pytest.raises(CredentialNotFoundError, match="Missing credentials"):
                await client.get_credential("ws-123", "unknown_provider")

        # 404 is not retried
        assert mock_get.call_count == 1

    @pytest.mark.asyncio
    async def test_retries_on_connection_error(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """Retries on ConnectError and succeeds on subsequent attempt."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.ConnectError("Connection refused")
            return mock_response

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=side_effect):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await client.get_credential("ws-123", "linkedin")

        assert result == mock_credential
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_raises_runtime_error_after_retries_exhausted(
        self, client: CredentialClient
    ) -> None:
        """RuntimeError raised when all retries fail."""
        with patch(
            "httpx.AsyncClient.get",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(RuntimeError, match="Failed to fetch credential"):
                    await client.get_credential("ws-123", "linkedin")

    @pytest.mark.asyncio
    async def test_sends_service_key_header(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """X-Service-Key header is included in the request."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            await client.get_credential("ws-123", "linkedin")

        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs.kwargs["headers"]["X-Service-Key"] == "test-service-key"

    @pytest.mark.asyncio
    async def test_constructs_correct_url(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """URL is correctly constructed from backend_api_url, workspace_id, and provider."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            await client.get_credential("ws-abc", "apollo")

        expected_url = "https://api.morket.io/api/v1/workspaces/ws-abc/credentials/apollo"
        mock_get.assert_called_once()
        assert mock_get.call_args.args[0] == expected_url

    @pytest.mark.asyncio
    async def test_handles_non_envelope_response(
        self, client: CredentialClient
    ) -> None:
        """If backend returns raw dict (no envelope), return it directly."""
        raw_cred = {"api_key": "raw-value"}
        mock_response = httpx.Response(
            200,
            json=raw_cred,
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
            result = await client.get_credential("ws-123", "linkedin")

        assert result == raw_cred


class TestInvalidateCache:
    """Tests for CredentialClient.invalidate_cache()."""

    @pytest.mark.asyncio
    async def test_invalidate_forces_refetch(
        self, client: CredentialClient, mock_credential: dict
    ) -> None:
        """After invalidation, next call fetches from backend."""
        mock_response = httpx.Response(
            200,
            json={"success": True, "data": mock_credential},
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            await client.get_credential("ws-123", "linkedin")
            client.invalidate_cache("ws-123", "linkedin")
            await client.get_credential("ws-123", "linkedin")

        assert mock_get.call_count == 2

    def test_invalidate_nonexistent_key_is_noop(self, client: CredentialClient) -> None:
        """Invalidating a key that doesn't exist does not raise."""
        client.invalidate_cache("nonexistent", "provider")  # Should not raise


class TestCacheIsolation:
    """Tests for cache key isolation."""

    @pytest.mark.asyncio
    async def test_different_providers_cached_separately(
        self, client: CredentialClient
    ) -> None:
        """Different providers for same workspace are cached independently."""
        cred_a = {"api_key": "key-a"}
        cred_b = {"api_key": "key-b"}

        call_count = 0

        async def side_effect(url, **kwargs):
            nonlocal call_count
            call_count += 1
            data = cred_a if "apollo" in url else cred_b
            return httpx.Response(
                200,
                json={"success": True, "data": data},
                request=httpx.Request("GET", url),
            )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=side_effect):
            result_a = await client.get_credential("ws-123", "apollo")
            result_b = await client.get_credential("ws-123", "clearbit")

        assert result_a == cred_a
        assert result_b == cred_b
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_different_workspaces_cached_separately(
        self, client: CredentialClient
    ) -> None:
        """Same provider in different workspaces are cached independently."""
        cred_a = {"api_key": "key-ws1"}
        cred_b = {"api_key": "key-ws2"}

        call_count = 0

        async def side_effect(url, **kwargs):
            nonlocal call_count
            call_count += 1
            data = cred_a if "ws-1" in url else cred_b
            return httpx.Response(
                200,
                json={"success": True, "data": data},
                request=httpx.Request("GET", url),
            )

        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=side_effect):
            result_a = await client.get_credential("ws-1", "apollo")
            result_b = await client.get_credential("ws-2", "apollo")

        assert result_a == cred_a
        assert result_b == cred_b
        assert call_count == 2
