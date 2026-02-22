"""Company website page extractor.

Extracts structured company data (company_name, description, industry,
employee_count_range, headquarters, contact_email, contact_phone) from a
company's website using a combination of meta tags, CSS selectors, and
Schema.org structured data (JSON-LD).

Because company websites vary widely in structure, extraction is best-effort.
Each field extraction is wrapped in try/except so that missing fields are set
to ``None`` rather than failing the entire extraction.
"""

from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING

from src.extractors.base import BaseExtractor
from src.models.requests import TargetType

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSS selectors for common company website fields
# ---------------------------------------------------------------------------
_SELECTORS = {
    "company_name": [
        'meta[property="og:site_name"]',
        'meta[property="og:title"]',
        "h1",
        ".company-name",
        'meta[name="application-name"]',
    ],
    "description": [
        'meta[property="og:description"]',
        'meta[name="description"]',
        ".company-description",
        ".about-us p",
    ],
    "industry": [
        'meta[name="industry"]',
        ".industry",
        ".company-industry",
    ],
    "employee_count_range": [
        ".employee-count",
        ".company-size",
    ],
    "headquarters": [
        ".headquarters",
        ".company-location",
        ".address",
        'address',
    ],
    "contact_email": [
        'a[href^="mailto:"]',
    ],
    "contact_phone": [
        'a[href^="tel:"]',
    ],
}

# The primary selector we wait for to confirm the page has loaded.
_PRIMARY_WAIT_SELECTOR = "body"

# All extractable field names (order used for iteration).
_ALL_FIELDS = [
    "company_name",
    "description",
    "industry",
    "employee_count_range",
    "headquarters",
    "contact_email",
    "contact_phone",
    "website_url",
]


class CompanyWebsiteExtractor(BaseExtractor):
    """Extractor for ``company_website`` target type."""

    target_type: TargetType = TargetType.COMPANY_WEBSITE

    async def extract(
        self,
        page: "Page",
        target_url: str,
        requested_fields: list[str] | None = None,
    ) -> dict:
        """Extract company data from *page*.

        Parameters
        ----------
        page:
            A Playwright ``Page`` already navigated to the company website.
        target_url:
            The website URL (used to populate ``website_url``).
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

        # Scroll to trigger lazy-loaded sections (e.g. about, contact).
        await self.scroll_for_content(page)

        # Pre-fetch JSON-LD structured data once for reuse across fields.
        json_ld = await self._extract_json_ld(page)

        result: dict[str, str | None] = {}

        for field in _ALL_FIELDS:
            if field not in fields_to_extract:
                result[field] = None
                continue

            if field == "website_url":
                result["website_url"] = target_url
                continue

            # Try JSON-LD first, then fall back to CSS selectors.
            value = self._extract_field_from_json_ld(json_ld, field)
            if value is None:
                value = await self._extract_field(page, field)

            result[field] = value

        return result

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _extract_json_ld(self, page: "Page") -> dict:
        """Extract the first Organization/LocalBusiness JSON-LD block."""
        try:
            elements = await page.query_selector_all('script[type="application/ld+json"]')
            for el in elements:
                raw = await el.text_content()
                if raw is None:
                    continue
                try:
                    data = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    continue

                # Handle @graph arrays
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and item.get("@type") in (
                            "Organization",
                            "LocalBusiness",
                            "Corporation",
                        ):
                            return item
                elif isinstance(data, dict):
                    if data.get("@type") in (
                        "Organization",
                        "LocalBusiness",
                        "Corporation",
                    ):
                        return data
        except Exception:
            logger.debug("Failed to extract JSON-LD from page", exc_info=True)
        return {}

    def _extract_field_from_json_ld(self, data: dict, field: str) -> str | None:
        """Attempt to extract *field* from a JSON-LD Organization object."""
        if not data:
            return None

        mapping: dict[str, list[str]] = {
            "company_name": ["name", "legalName"],
            "description": ["description"],
            "industry": ["industry"],
            "employee_count_range": ["numberOfEmployees"],
            "headquarters": ["address"],
            "contact_email": ["email"],
            "contact_phone": ["telephone"],
        }

        keys = mapping.get(field, [])
        for key in keys:
            value = data.get(key)
            if value is None:
                continue

            # numberOfEmployees may be a dict with a range
            if field == "employee_count_range" and isinstance(value, dict):
                min_val = value.get("minValue", "")
                max_val = value.get("maxValue", "")
                if min_val or max_val:
                    return f"{min_val}-{max_val}".strip("-")
                return None

            # address may be a dict
            if field == "headquarters" and isinstance(value, dict):
                parts = [
                    value.get("streetAddress", ""),
                    value.get("addressLocality", ""),
                    value.get("addressRegion", ""),
                    value.get("addressCountry", ""),
                ]
                combined = ", ".join(p for p in parts if p)
                return combined if combined else None

            if isinstance(value, str):
                value = value.strip()
                return value if value else None

        return None

    async def _extract_field(self, page: "Page", field: str) -> str | None:
        """Extract a single *field* from *page* using CSS selectors.

        Returns ``None`` on failure.
        """
        selectors = _SELECTORS.get(field, [])

        for selector in selectors:
            try:
                element = await page.query_selector(selector)
                if element is None:
                    continue

                # Meta tags use the content attribute.
                tag_name = await element.evaluate("el => el.tagName.toLowerCase()")

                if tag_name == "meta":
                    text = await element.get_attribute("content")
                elif field == "contact_email":
                    href = await element.get_attribute("href")
                    if href and href.startswith("mailto:"):
                        text = href.replace("mailto:", "").split("?")[0]
                    else:
                        text = await element.text_content()
                elif field == "contact_phone":
                    href = await element.get_attribute("href")
                    if href and href.startswith("tel:"):
                        text = href.replace("tel:", "")
                    else:
                        text = await element.text_content()
                else:
                    text = await element.text_content()

                if text is None:
                    continue

                text = text.strip()
                if text:
                    return text

            except Exception:
                logger.warning(
                    "Failed to extract field '%s' with selector %r",
                    field,
                    selector,
                    exc_info=True,
                )

        return None
