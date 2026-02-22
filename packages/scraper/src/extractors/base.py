"""Abstract base class for target-specific page extractors.

Each extractor handles a single TargetType and encapsulates the navigation,
wait conditions, and CSS/XPath selectors needed to extract structured data
from that target type.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from src.models.requests import TargetType

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = logging.getLogger(__name__)


class BaseExtractor(ABC):
    """Abstract base extractor that all target-specific extractors extend.

    Subclasses MUST set ``target_type`` as a class attribute and implement
    the ``extract`` method.  The helper methods ``wait_for_content`` and
    ``scroll_for_content`` are provided for common page-interaction patterns.
    """

    target_type: TargetType

    @abstractmethod
    async def extract(
        self,
        page: "Page",
        target_url: str,
        requested_fields: list[str] | None,
    ) -> dict:
        """Extract structured data from *page* for the given *target_url*.

        Parameters
        ----------
        page:
            A Playwright ``Page`` already navigated to the target URL.
        target_url:
            The URL being scraped (for logging / context).
        requested_fields:
            Optional list of field names the caller wants.  When ``None``,
            extract all available fields.

        Returns
        -------
        dict
            A mapping of field names to extracted values.  Missing fields
            MUST be set to ``None`` rather than omitted.
        """
        ...

    async def wait_for_content(
        self,
        page: "Page",
        selector: str,
        timeout: int = 10_000,
    ) -> None:
        """Wait for a CSS selector to appear on the page.

        Uses Playwright's ``wait_for_selector`` with the given *timeout*
        (milliseconds).  Logs a warning and returns silently if the selector
        does not appear within the timeout — callers should treat the
        corresponding field as ``None``.
        """
        try:
            await page.wait_for_selector(selector, timeout=timeout)
        except Exception:
            logger.warning(
                "Selector %r not found within %dms on %s",
                selector,
                timeout,
                page.url,
            )

    async def scroll_for_content(
        self,
        page: "Page",
        max_scrolls: int = 5,
    ) -> None:
        """Scroll the page incrementally to trigger lazy-loaded content.

        Performs up to *max_scrolls* scroll-to-bottom actions with a short
        pause between each to allow content to load.
        """
        for _ in range(max_scrolls):
            await page.evaluate("window.scrollBy(0, window.innerHeight)")
            await asyncio.sleep(0.3)
