"""Playwright browser pool management.

Manages a fixed-size pool of headless Chromium instances. Each instance
tracks pages processed and is recycled after a configurable threshold to
prevent memory leaks. Crash recovery is handled via Playwright's
``disconnected`` event — crashed instances are removed and replaced.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from src.middleware.error_handler import PoolExhaustedError

if TYPE_CHECKING:
    from playwright.async_api import Browser, Page, Playwright
    from src.proxy.types import ProxyEndpoint

logger = logging.getLogger(__name__)

# Chromium flags for containerized / headless operation
CHROMIUM_ARGS: list[str] = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]


@dataclass
class BrowserInstance:
    """A single managed browser instance in the pool."""

    id: str
    browser: Any  # playwright.async_api.Browser at runtime
    pages_processed: int = 0
    created_at: float = field(default_factory=time.monotonic)

    async def new_page(self, proxy: "ProxyEndpoint | None" = None) -> "Page":
        """Create a new page, optionally routed through *proxy*."""
        context_kwargs: dict = {}
        if proxy is not None:
            context_kwargs["proxy"] = {"server": proxy.url}
        context = await self.browser.new_context(**context_kwargs)
        page = await context.new_page()
        return page

    def needs_recycling(self, max_pages: int) -> bool:
        """Return ``True`` if this instance should be recycled."""
        return self.pages_processed >= max_pages


class BrowserPool:
    """Manages a pool of Playwright Chromium browser instances.

    Lifecycle
    ---------
    1. ``initialize(pool_size)`` — launch *pool_size* Chromium instances.
    2. ``acquire(timeout)`` — get an available instance (blocks up to *timeout* s).
    3. ``release(instance)`` — return instance; clears state, recycles if needed.
    4. ``shutdown()`` — close all browsers and the Playwright process.

    Crash recovery is automatic: a ``disconnected`` callback on each browser
    removes the crashed instance and launches a replacement.
    """

    def __init__(self) -> None:
        self._playwright: Any = None  # Playwright instance (lazy import)
        self._available: asyncio.Queue[BrowserInstance] = asyncio.Queue()
        self._in_use: dict[str, BrowserInstance] = {}
        self._all: dict[str, BrowserInstance] = {}
        self._lock = asyncio.Lock()
        self._pool_size: int = 0
        self._page_limit: int = 100
        self._pages_processed: int = 0
        self._recycled_count: int = 0
        self._initialized: bool = False
        self._shutting_down: bool = False

    # ------------------------------------------------------------------
    # initialize
    # ------------------------------------------------------------------

    async def initialize(self, pool_size: int, *, page_limit: int = 100) -> None:
        """Launch *pool_size* Chromium instances and populate the pool."""
        from playwright.async_api import async_playwright

        self._pool_size = pool_size
        self._page_limit = page_limit
        self._playwright = await async_playwright().start()

        for _ in range(pool_size):
            instance = await self._launch_instance()
            self._available.put_nowait(instance)

        self._initialized = True
        logger.info(
            "Browser pool initialized: size=%d, page_limit=%d",
            pool_size,
            page_limit,
        )

    # ------------------------------------------------------------------
    # acquire
    # ------------------------------------------------------------------

    async def acquire(self, timeout: float = 10.0) -> BrowserInstance:
        """Return an available browser instance.

        Blocks up to *timeout* seconds. Raises :class:`PoolExhaustedError`
        if no instance becomes available in time.
        """
        try:
            instance = await asyncio.wait_for(
                self._available.get(), timeout=timeout
            )
        except asyncio.TimeoutError:
            raise PoolExhaustedError(
                "No browser instance available within "
                f"{timeout}s timeout"
            )

        # Guard against instances that were removed (e.g. crash) while queued
        if instance.id not in self._all:
            # Instance was removed — try again with remaining timeout
            return await self.acquire(timeout=0.1)

        self._in_use[instance.id] = instance
        logger.debug("Acquired browser instance %s", instance.id)
        return instance

    # ------------------------------------------------------------------
    # release
    # ------------------------------------------------------------------

    async def release(self, instance: BrowserInstance) -> None:
        """Return *instance* to the pool after clearing state.

        If the instance has exceeded the page limit it is recycled
        (terminated and replaced with a fresh one).
        """
        # Remove from in-use tracking
        self._in_use.pop(instance.id, None)

        # Increment page counter
        instance.pages_processed += 1
        self._pages_processed += 1

        if self._shutting_down:
            # During shutdown, just close — don't replace
            await self._close_instance(instance)
            return

        if instance.needs_recycling(self._page_limit):
            logger.info(
                "Recycling browser instance %s after %d pages",
                instance.id,
                instance.pages_processed,
            )
            await self._recycle_instance(instance)
            return

        # Clear cookies / storage for all contexts
        try:
            for context in instance.browser.contexts:
                await context.clear_cookies()
                # Storage is per-context; clearing cookies is the primary
                # isolation mechanism. For full isolation we close all
                # pages in the context.
                for page in context.pages:
                    await page.close()
        except Exception:
            logger.warning(
                "Failed to clear state on instance %s — recycling",
                instance.id,
                exc_info=True,
            )
            await self._recycle_instance(instance)
            return

        self._available.put_nowait(instance)
        logger.debug("Released browser instance %s back to pool", instance.id)

    # ------------------------------------------------------------------
    # shutdown
    # ------------------------------------------------------------------

    async def shutdown(self) -> None:
        """Gracefully close all browser instances and stop Playwright."""
        self._shutting_down = True
        logger.info("Shutting down browser pool…")

        # Close all tracked instances
        for instance in list(self._all.values()):
            await self._close_instance(instance)

        self._all.clear()
        self._in_use.clear()

        # Drain the available queue
        while not self._available.empty():
            try:
                self._available.get_nowait()
            except asyncio.QueueEmpty:
                break

        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

        self._initialized = False
        logger.info("Browser pool shut down")

    # ------------------------------------------------------------------
    # get_stats
    # ------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return pool statistics for the health endpoint."""
        return {
            "total": len(self._all),
            "available": self._available.qsize(),
            "in_use": len(self._in_use),
            "pages_processed": self._pages_processed,
            "recycled_count": self._recycled_count,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _launch_instance(self) -> BrowserInstance:
        """Launch a new Chromium browser and return a BrowserInstance."""
        assert self._playwright is not None, "Playwright not started"

        browser = await self._playwright.chromium.launch(
            headless=True,
            args=CHROMIUM_ARGS,
        )

        instance_id = str(uuid4())
        instance = BrowserInstance(id=instance_id, browser=browser)
        self._all[instance_id] = instance

        # Register crash recovery callback
        browser.on(
            "disconnected",
            lambda: asyncio.ensure_future(
                self._on_disconnected(instance_id)
            ),
        )

        logger.debug("Launched browser instance %s", instance_id)
        return instance

    async def _on_disconnected(self, instance_id: str) -> None:
        """Handle a browser crash / unexpected disconnect."""
        if self._shutting_down:
            return

        logger.warning("Browser instance %s disconnected — replacing", instance_id)

        async with self._lock:
            # Remove the crashed instance from all tracking structures
            self._all.pop(instance_id, None)
            self._in_use.pop(instance_id, None)
            # Note: we cannot remove it from the asyncio.Queue directly,
            # but the acquire() method guards against stale entries.

            try:
                replacement = await self._launch_instance()
                self._available.put_nowait(replacement)
                logger.info(
                    "Replaced crashed instance %s with %s",
                    instance_id,
                    replacement.id,
                )
            except Exception:
                logger.error(
                    "Failed to replace crashed instance %s",
                    instance_id,
                    exc_info=True,
                )

    async def _recycle_instance(self, instance: BrowserInstance) -> None:
        """Terminate *instance* and launch a replacement."""
        await self._close_instance(instance)
        self._recycled_count += 1

        if not self._shutting_down:
            try:
                replacement = await self._launch_instance()
                self._available.put_nowait(replacement)
                logger.debug(
                    "Recycled instance %s → new instance %s",
                    instance.id,
                    replacement.id,
                )
            except Exception:
                logger.error(
                    "Failed to launch replacement after recycling %s",
                    instance.id,
                    exc_info=True,
                )

    async def _close_instance(self, instance: BrowserInstance) -> None:
        """Safely close a browser instance."""
        self._all.pop(instance.id, None)
        try:
            await instance.browser.close()
        except Exception:
            logger.debug(
                "Error closing browser instance %s (may already be closed)",
                instance.id,
                exc_info=True,
            )
