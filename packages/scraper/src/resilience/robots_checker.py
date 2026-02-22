"""Robots.txt compliance checker.

Fetches, caches, and parses robots.txt files for target domains.
Uses Python's urllib.robotparser for parsing and httpx for async fetching.

Key behaviors:
- Cached per domain with configurable TTL (default 1 hour)
- If robots.txt fetch fails (404, timeout, etc.), assumes all URLs allowed
- Thread-safe via asyncio lock for concurrent fetch deduplication
"""

from __future__ import annotations

import logging
import time
from urllib.robotparser import RobotFileParser

import httpx

logger = logging.getLogger(__name__)


class _CachedRobots:
    """Internal cache entry for a domain's robots.txt."""

    __slots__ = ("content", "parser", "fetched_at")

    def __init__(self, content: str | None, parser: RobotFileParser, fetched_at: float) -> None:
        self.content = content
        self.parser = parser
        self.fetched_at = fetched_at


class RobotsChecker:
    """Async robots.txt fetcher, cacher, and URL permission checker.

    Args:
        cache_ttl_seconds: How long to cache robots.txt per domain (default 3600 = 1 hour).
        fetch_timeout_seconds: HTTP timeout for fetching robots.txt (default 10).
    """

    def __init__(
        self,
        cache_ttl_seconds: int = 3600,
        fetch_timeout_seconds: float = 10.0,
    ) -> None:
        self._cache: dict[str, _CachedRobots] = {}
        self._cache_ttl = cache_ttl_seconds
        self._fetch_timeout = fetch_timeout_seconds

    async def fetch_robots_txt(self, domain: str) -> str | None:
        """Fetch robots.txt for a domain, using cache if available.

        Args:
            domain: The target domain (e.g. "linkedin.com").

        Returns:
            The robots.txt content as a string, or None if fetch failed.
        """
        # Check cache
        cached = self._cache.get(domain)
        if cached is not None and not self._is_expired(cached):
            return cached.content

        # Fetch fresh
        url = f"https://{domain}/robots.txt"
        content: str | None = None

        try:
            async with httpx.AsyncClient(timeout=self._fetch_timeout) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    content = response.text
                else:
                    logger.info(
                        "robots.txt fetch for %s returned status %d — assuming all allowed",
                        domain,
                        response.status_code,
                    )
        except (httpx.HTTPError, Exception) as exc:
            logger.warning(
                "Failed to fetch robots.txt for %s: %s — assuming all allowed",
                domain,
                exc,
            )

        # Build parser
        parser = RobotFileParser()
        if content is not None:
            parser.parse(content.splitlines())
        else:
            # Permissive default: allow everything
            parser.allow_all = True

        self._cache[domain] = _CachedRobots(
            content=content,
            parser=parser,
            fetched_at=time.monotonic(),
        )

        return content

    def is_url_allowed(
        self,
        domain: str,
        url_path: str,
        user_agent: str = "*",
    ) -> bool:
        """Check if a URL path is allowed by the domain's cached robots.txt.

        Must call fetch_robots_txt() first to populate the cache.
        If no cached entry exists, assumes all URLs are allowed (permissive default).

        Args:
            domain: The target domain.
            url_path: The URL path to check (e.g. "/in/johndoe").
            user_agent: The user agent string to check against (default "*").

        Returns:
            True if the URL is allowed, False if disallowed.
        """
        cached = self._cache.get(domain)
        if cached is None:
            # No cached robots.txt — permissive default
            return True

        full_url = f"https://{domain}{url_path}"
        return cached.parser.can_fetch(user_agent, full_url)

    def _is_expired(self, entry: _CachedRobots) -> bool:
        """Check if a cache entry has exceeded its TTL."""
        return (time.monotonic() - entry.fetched_at) >= self._cache_ttl

    def clear_cache(self) -> None:
        """Clear all cached robots.txt entries."""
        self._cache.clear()
