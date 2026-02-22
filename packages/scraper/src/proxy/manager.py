"""Proxy rotation manager with round-robin selection, health checks, and per-domain cooldown.

Proxies are loaded from a list of URL strings (e.g. ["http://proxy1:8080", "socks5://proxy2:1080"]).
Selection uses round-robin rotation, skipping unhealthy proxies and proxies recently used for the
same target domain (per-domain cooldown). A background health check loop periodically tests
unhealthy proxies and restores them when reachable.
"""

from __future__ import annotations

import asyncio
import logging
import time
from urllib.parse import urlparse

import httpx

from src.middleware.error_handler import NoHealthyProxiesError
from src.proxy.types import ProxyEndpoint

logger = logging.getLogger(__name__)


class ProxyManager:
    """Manages a pool of proxy endpoints with round-robin rotation and health tracking."""

    def __init__(
        self,
        domain_cooldown_seconds: int = 30,
        health_check_interval_seconds: int = 60,
    ) -> None:
        self._proxies: list[ProxyEndpoint] = []
        self._index: int = 0
        self._domain_cooldown_seconds = domain_cooldown_seconds
        self._health_check_interval_seconds = health_check_interval_seconds
        self._health_check_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    async def initialize(self, endpoints: list[str]) -> None:
        """Parse proxy URL strings and create ProxyEndpoint objects.

        Each URL's scheme is used as the protocol (http, https, socks5).
        """
        self._proxies = []
        self._index = 0

        for raw_url in endpoints:
            parsed = urlparse(raw_url)
            protocol = parsed.scheme.lower() if parsed.scheme else "http"
            self._proxies.append(
                ProxyEndpoint(
                    url=raw_url,
                    protocol=protocol,
                )
            )

        logger.info("Proxy manager initialized with %d endpoints", len(self._proxies))

    # ------------------------------------------------------------------
    # Selection
    # ------------------------------------------------------------------

    def select(self, target_domain: str) -> ProxyEndpoint:
        """Select the next healthy proxy using round-robin, respecting per-domain cooldown.

        Raises ``NoHealthyProxiesError`` if no suitable proxy is available after a
        full rotation through the pool.
        """
        if not self._proxies:
            raise NoHealthyProxiesError()

        pool_size = len(self._proxies)
        now = time.monotonic()

        for _ in range(pool_size):
            proxy = self._proxies[self._index % pool_size]
            self._index = (self._index + 1) % pool_size

            # Skip unhealthy
            if not proxy.is_healthy:
                continue

            # Skip if same domain was used within cooldown
            last_used = proxy.last_used_domains.get(target_domain)
            if last_used is not None and (now - last_used) < self._domain_cooldown_seconds:
                continue

            # Record domain usage
            proxy.last_used_domains[target_domain] = now
            return proxy

        raise NoHealthyProxiesError()

    # ------------------------------------------------------------------
    # Health tracking
    # ------------------------------------------------------------------

    def mark_unhealthy(self, proxy: ProxyEndpoint) -> None:
        """Mark a proxy as unhealthy and increment its failure counter."""
        proxy.is_healthy = False
        proxy.failure_count += 1
        logger.warning("Proxy marked unhealthy: %s (failures: %d)", proxy.url, proxy.failure_count)

    def mark_success(self, proxy: ProxyEndpoint) -> None:
        """Record a successful request through the proxy."""
        proxy.success_count += 1

    # ------------------------------------------------------------------
    # Background health checks
    # ------------------------------------------------------------------

    async def health_check_loop(self) -> None:
        """Periodically test unhealthy proxies and restore them on success.

        Runs every ``health_check_interval_seconds``. For each unhealthy proxy,
        attempts a lightweight HTTP HEAD request through the proxy. On success the
        proxy is restored to healthy status.
        """
        while True:
            await asyncio.sleep(self._health_check_interval_seconds)
            await self._run_health_checks()

    async def _run_health_checks(self) -> None:
        """Execute a single round of health checks on all unhealthy proxies."""
        for proxy in self._proxies:
            if proxy.is_healthy:
                continue

            try:
                async with httpx.AsyncClient(
                    proxy=proxy.url,
                    timeout=httpx.Timeout(10.0),
                ) as client:
                    response = await client.head("https://httpbin.org/status/200")
                    if response.status_code < 500:
                        proxy.is_healthy = True
                        logger.info("Proxy restored to healthy: %s", proxy.url)
            except Exception:  # noqa: BLE001
                logger.debug("Health check failed for proxy: %s", proxy.url)

    # ------------------------------------------------------------------
    # Stats / metrics
    # ------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return proxy pool statistics for the health endpoint."""
        total = len(self._proxies)
        healthy = sum(1 for p in self._proxies if p.is_healthy)
        unhealthy = total - healthy

        per_proxy = [
            {
                "url": p.url,
                "protocol": p.protocol,
                "is_healthy": p.is_healthy,
                "success_count": p.success_count,
                "failure_count": p.failure_count,
            }
            for p in self._proxies
        ]

        return {
            "total": total,
            "healthy": healthy,
            "unhealthy": unhealthy,
            "proxies": per_proxy,
        }
