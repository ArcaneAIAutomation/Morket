"""Credential client for retrieving decrypted credentials from the backend API.

Fetches credentials via GET /api/v1/workspaces/:id/credentials/:provider with
X-Service-Key authentication. Implements in-memory caching with configurable TTL
and retry logic with exponential backoff.

SECURITY: Never logs or persists decrypted credential values.
"""

from __future__ import annotations

import logging
import time

import httpx

from src.middleware.error_handler import CredentialNotFoundError

logger = logging.getLogger(__name__)


class CredentialClient:
    """HTTP client for backend credential API with caching and retries.

    Parameters
    ----------
    backend_api_url:
        Base URL for the backend API (e.g. "https://api.morket.io/api/v1").
    service_key:
        X-Service-Key value for authenticating with the backend.
    cache_ttl_seconds:
        TTL for cached credentials (default 300 = 5 min).
    max_retries:
        Maximum retry attempts on transient failures (default 3).
    """

    def __init__(
        self,
        backend_api_url: str,
        service_key: str,
        cache_ttl_seconds: int = 300,
        max_retries: int = 3,
    ) -> None:
        self._backend_api_url = backend_api_url.rstrip("/")
        self._service_key = service_key
        self._cache_ttl_seconds = cache_ttl_seconds
        self._max_retries = max_retries

        # Cache: (workspace_id, provider) -> (credential_dict, expiry_timestamp)
        self._cache: dict[tuple[str, str], tuple[dict, float]] = {}

    async def get_credential(self, workspace_id: str, provider: str) -> dict:
        """Retrieve a credential, returning cached value if within TTL.

        Raises
        ------
        CredentialNotFoundError
            If the backend returns 404 for the requested credential.
        httpx.HTTPStatusError
            If the backend returns a non-404 error after retries are exhausted.
        RuntimeError
            If the backend is unreachable after all retry attempts.
        """
        cache_key = (workspace_id, provider)

        # Check cache
        cached = self._cache.get(cache_key)
        if cached is not None:
            credential, expiry = cached
            if time.monotonic() < expiry:
                logger.debug(
                    "Credential cache hit for workspace_id=%s provider=%s",
                    workspace_id,
                    provider,
                )
                return credential

        # Cache miss or expired — fetch from backend with retries
        credential = await self._fetch_with_retries(workspace_id, provider)

        # Store in cache
        self._cache[cache_key] = (credential, time.monotonic() + self._cache_ttl_seconds)

        return credential

    def invalidate_cache(self, workspace_id: str, provider: str) -> None:
        """Remove a cached credential entry."""
        self._cache.pop((workspace_id, provider), None)

    async def _fetch_with_retries(self, workspace_id: str, provider: str) -> dict:
        """Fetch credential from backend with exponential backoff retries.

        Retry schedule: 1s, 2s, 4s (base 1s, factor 2).
        """
        url = (
            f"{self._backend_api_url}/workspaces/{workspace_id}/credentials/{provider}"
        )
        last_exception: Exception | None = None

        for attempt in range(self._max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        url,
                        headers={"X-Service-Key": self._service_key},
                        timeout=10.0,
                    )

                if response.status_code == 404:
                    logger.warning(
                        "Credential not found: workspace_id=%s provider=%s",
                        workspace_id,
                        provider,
                    )
                    raise CredentialNotFoundError(
                        f"Missing credentials for provider '{provider}' "
                        f"in workspace '{workspace_id}'"
                    )

                response.raise_for_status()

                data = response.json()
                # Extract credential from envelope if present
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                return data

            except CredentialNotFoundError:
                # 404 is not retryable — propagate immediately
                raise

            except (httpx.ConnectError, httpx.TimeoutException, httpx.ConnectTimeout) as exc:
                last_exception = exc
                backoff = 2**attempt  # 1s, 2s, 4s
                logger.warning(
                    "Backend unreachable (attempt %d/%d) for workspace_id=%s provider=%s, "
                    "retrying in %ds",
                    attempt + 1,
                    self._max_retries,
                    workspace_id,
                    provider,
                    backoff,
                )
                if attempt < self._max_retries - 1:
                    import asyncio

                    await asyncio.sleep(backoff)

            except httpx.HTTPStatusError as exc:
                last_exception = exc
                backoff = 2**attempt
                logger.warning(
                    "Backend returned status %d (attempt %d/%d) for workspace_id=%s provider=%s, "
                    "retrying in %ds",
                    exc.response.status_code,
                    attempt + 1,
                    self._max_retries,
                    workspace_id,
                    provider,
                    backoff,
                )
                if attempt < self._max_retries - 1:
                    import asyncio

                    await asyncio.sleep(backoff)

        # All retries exhausted
        logger.error(
            "Failed to fetch credential after %d attempts: workspace_id=%s provider=%s",
            self._max_retries,
            workspace_id,
            provider,
        )
        raise RuntimeError(
            f"Failed to fetch credential for provider '{provider}' "
            f"in workspace '{workspace_id}' after {self._max_retries} attempts"
        ) from last_exception
