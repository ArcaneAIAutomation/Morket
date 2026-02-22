"""Property tests for credential client cache TTL behavior.

# Feature: scraping-microservices, Property 30: Credential cache TTL behavior
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from hypothesis import given, settings, strategies as st

from src.integration.credential_client import CredentialClient


@settings(max_examples=100)
@given(
    workspace_id=st.uuids().map(str),
    provider=st.sampled_from(["apollo", "clearbit", "hunter", "linkedin"]),
    ttl=st.integers(min_value=1, max_value=60),
    credential_value=st.dictionaries(
        keys=st.text(min_size=1, max_size=10, alphabet="abcdefghijklmnopqrstuvwxyz"),
        values=st.text(min_size=1, max_size=20),
        min_size=1,
        max_size=3,
    ),
)
@pytest.mark.asyncio
async def test_credential_cache_returns_cached_within_ttl(
    workspace_id: str,
    provider: str,
    ttl: int,
    credential_value: dict,
) -> None:
    """Property 30: Credential cache TTL behavior — cached value returned within TTL.

    For any credential retrieval, if the credential was fetched within the TTL
    window, the cached value SHALL be returned without a backend API call.
    """
    # Feature: scraping-microservices, Property 30: Credential cache TTL behavior

    client = CredentialClient(
        backend_api_url="https://api.morket.io/api/v1",
        service_key="test-key",
        cache_ttl_seconds=ttl,
    )

    # Manually seed the cache with a future expiry
    cache_key = (workspace_id, provider)
    client._cache[cache_key] = (credential_value, time.monotonic() + ttl)

    # Patch _fetch_with_retries to track if it's called
    with patch.object(client, "_fetch_with_retries", new_callable=AsyncMock) as mock_fetch:
        result = await client.get_credential(workspace_id, provider)

        # Cached value should be returned
        assert result == credential_value
        # Backend should NOT be called
        mock_fetch.assert_not_called()


@settings(max_examples=100)
@given(
    workspace_id=st.uuids().map(str),
    provider=st.sampled_from(["apollo", "clearbit", "hunter", "linkedin"]),
    credential_value=st.dictionaries(
        keys=st.text(min_size=1, max_size=10, alphabet="abcdefghijklmnopqrstuvwxyz"),
        values=st.text(min_size=1, max_size=20),
        min_size=1,
        max_size=3,
    ),
    fresh_value=st.dictionaries(
        keys=st.text(min_size=1, max_size=10, alphabet="abcdefghijklmnopqrstuvwxyz"),
        values=st.text(min_size=1, max_size=20),
        min_size=1,
        max_size=3,
    ),
)
@pytest.mark.asyncio
async def test_credential_cache_fetches_fresh_after_ttl_expiry(
    workspace_id: str,
    provider: str,
    credential_value: dict,
    fresh_value: dict,
) -> None:
    """Property 30: Credential cache TTL behavior — fresh fetch after TTL expiry.

    For any credential retrieval, if the TTL has expired, a fresh credential
    SHALL be fetched from the backend.
    """
    # Feature: scraping-microservices, Property 30: Credential cache TTL behavior

    client = CredentialClient(
        backend_api_url="https://api.morket.io/api/v1",
        service_key="test-key",
        cache_ttl_seconds=1,
    )

    # Seed cache with an EXPIRED entry (expiry in the past)
    cache_key = (workspace_id, provider)
    client._cache[cache_key] = (credential_value, time.monotonic() - 1)

    # Patch _fetch_with_retries to return fresh value
    with patch.object(
        client, "_fetch_with_retries", new_callable=AsyncMock, return_value=fresh_value
    ) as mock_fetch:
        result = await client.get_credential(workspace_id, provider)

        # Fresh value should be returned
        assert result == fresh_value
        # Backend SHOULD be called
        mock_fetch.assert_called_once_with(workspace_id, provider)

        # Cache should now contain the fresh value
        cached, expiry = client._cache[cache_key]
        assert cached == fresh_value
        assert expiry > time.monotonic()
