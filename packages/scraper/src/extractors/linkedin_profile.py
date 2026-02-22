"""LinkedIn profile page extractor.

Extracts structured profile data (name, headline, current company, location,
summary) from a LinkedIn profile page using CSS selectors.  Each field
extraction is wrapped in try/except so that missing fields are set to ``None``
rather than failing the entire extraction.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from src.extractors.base import BaseExtractor
from src.models.requests import TargetType

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSS selectors for LinkedIn profile fields
# ---------------------------------------------------------------------------
_SELECTORS = {
    "name": ".text-heading-xlarge",
    "headline": ".text-body-medium.break-words",
    "current_company": "button[aria-label*='current company'] span",
    "location": ".text-body-small.inline.t-black--light.break-words",
    "summary": "section.summary .inline-show-more-text",
}

# The primary selector we wait for to confirm the profile has loaded.
_PRIMARY_WAIT_SELECTOR = ".text-heading-xlarge"

# All extractable field names (order used for iteration).
_ALL_FIELDS = ["name", "headline", "current_company", "location", "summary", "profile_url"]


class LinkedInProfileExtractor(BaseExtractor):
    """Extractor for ``linkedin_profile`` target type."""

    target_type: TargetType = TargetType.LINKEDIN_PROFILE

    async def extract(
        self,
        page: "Page",
        target_url: str,
        requested_fields: list[str] | None = None,
    ) -> dict:
        """Extract LinkedIn profile data from *page*.

        Parameters
        ----------
        page:
            A Playwright ``Page`` already navigated to the LinkedIn profile URL.
        target_url:
            The profile URL (used to populate ``profile_url``).
        requested_fields:
            Optional subset of fields to extract.  When ``None`` all fields
            are extracted.

        Returns
        -------
        dict
            Mapping of field names → extracted values.  Missing fields are
            ``None``.
        """
        fields_to_extract = requested_fields if requested_fields else _ALL_FIELDS

        # Wait for the primary content indicator to appear.
        await self.wait_for_content(page, _PRIMARY_WAIT_SELECTOR)

        # Scroll to trigger lazy-loaded sections (e.g. summary / about).
        await self.scroll_for_content(page)

        result: dict[str, str | None] = {}

        for field in _ALL_FIELDS:
            if field not in fields_to_extract:
                result[field] = None
                continue

            if field == "profile_url":
                result["profile_url"] = target_url
                continue

            result[field] = await self._extract_field(page, field)

        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _extract_field(self, page: "Page", field: str) -> str | None:
        """Extract a single *field* from *page*, returning ``None`` on failure."""
        selector = _SELECTORS.get(field)
        if selector is None:
            return None

        try:
            element = await page.query_selector(selector)
            if element is None:
                logger.debug("Selector %r returned no element for field '%s'", selector, field)
                return None

            text = await element.text_content()
            if text is None:
                return None

            text = text.strip()
            return text if text else None
        except Exception:
            logger.warning("Failed to extract field '%s' from page", field, exc_info=True)
            return None
