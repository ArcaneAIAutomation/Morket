"""Job posting page extractor.

Extracts structured job posting data (job_title, company_name, location,
salary_range, description) from a job posting page using a combination of
CSS selectors, meta tags, and Schema.org structured data (JSON-LD with
``JobPosting`` type).

Because job posting pages vary widely in structure, extraction is best-effort.
Each field extraction is wrapped in try/except so that missing fields are set
to ``None`` rather than failing the entire extraction.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from src.extractors.base import BaseExtractor
from src.models.requests import TargetType

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CSS selectors for common job posting fields
# ---------------------------------------------------------------------------
_SELECTORS = {
    "job_title": [
        "h1.job-title",
        "h1",
        ".job-title",
        ".posting-headline h2",
        'meta[property="og:title"]',
    ],
    "company_name": [
        ".company-name",
        ".employer-name",
        ".hiring-company",
        'meta[property="og:site_name"]',
    ],
    "location": [
        ".job-location",
        ".location",
        'meta[name="geo.placename"]',
    ],
    "salary_range": [
        ".salary",
        ".salary-range",
        ".compensation",
    ],
    "description": [
        ".job-description",
        ".description",
        'meta[property="og:description"]',
        'meta[name="description"]',
    ],
}

# The primary selector we wait for to confirm the page has loaded.
_PRIMARY_WAIT_SELECTOR = "body"

# All extractable field names (order used for iteration).
_ALL_FIELDS = [
    "job_title",
    "company_name",
    "location",
    "salary_range",
    "description",
    "posting_url",
]


class JobPostingExtractor(BaseExtractor):
    """Extractor for ``job_posting`` target type."""

    target_type: TargetType = TargetType.JOB_POSTING

    async def extract(
        self,
        page: "Page",
        target_url: str,
        requested_fields: list[str] | None = None,
    ) -> dict:
        """Extract job posting data from *page*.

        Parameters
        ----------
        page:
            A Playwright ``Page`` already navigated to the job posting URL.
        target_url:
            The posting URL (used to populate ``posting_url``).
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

        # Scroll to trigger lazy-loaded sections (e.g. full description).
        await self.scroll_for_content(page)

        # Pre-fetch JSON-LD structured data once for reuse across fields.
        json_ld = await self._extract_json_ld(page)

        result: dict[str, str | None] = {}

        for field in _ALL_FIELDS:
            if field not in fields_to_extract:
                result[field] = None
                continue

            if field == "posting_url":
                result["posting_url"] = target_url
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
        """Extract the first JobPosting JSON-LD block."""
        try:
            elements = await page.query_selector_all(
                'script[type="application/ld+json"]'
            )
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
                        if isinstance(item, dict) and item.get("@type") == "JobPosting":
                            return item
                elif isinstance(data, dict):
                    if data.get("@type") == "JobPosting":
                        return data
        except Exception:
            logger.debug("Failed to extract JSON-LD from page", exc_info=True)
        return {}

    def _extract_field_from_json_ld(self, data: dict, field: str) -> str | None:
        """Attempt to extract *field* from a JSON-LD JobPosting object."""
        if not data:
            return None

        mapping: dict[str, list[str]] = {
            "job_title": ["title", "name"],
            "company_name": ["hiringOrganization"],
            "location": ["jobLocation"],
            "salary_range": ["baseSalary", "estimatedSalary"],
            "description": ["description"],
        }

        keys = mapping.get(field, [])
        for key in keys:
            value = data.get(key)
            if value is None:
                continue

            # hiringOrganization is typically a dict with a "name" key
            if field == "company_name" and isinstance(value, dict):
                name = value.get("name")
                if isinstance(name, str) and name.strip():
                    return name.strip()
                continue

            # jobLocation may be a dict or list of dicts
            if field == "location":
                return self._parse_job_location(value)

            # baseSalary / estimatedSalary may be a dict with currency + value
            if field == "salary_range" and isinstance(value, dict):
                return self._parse_salary(value)

            if isinstance(value, str):
                value = value.strip()
                return value if value else None

        return None

    def _parse_job_location(self, value: object) -> str | None:
        """Parse a JSON-LD jobLocation value into a location string."""
        try:
            if isinstance(value, list):
                # Take the first location
                value = value[0] if value else None
            if isinstance(value, dict):
                address = value.get("address", value)
                if isinstance(address, dict):
                    parts = [
                        address.get("addressLocality", ""),
                        address.get("addressRegion", ""),
                        address.get("addressCountry", ""),
                    ]
                    combined = ", ".join(p for p in parts if p)
                    return combined if combined else None
                if isinstance(address, str) and address.strip():
                    return address.strip()
            if isinstance(value, str) and value.strip():
                return value.strip()
        except Exception:
            logger.debug("Failed to parse jobLocation", exc_info=True)
        return None

    def _parse_salary(self, value: dict) -> str | None:
        """Parse a JSON-LD baseSalary/estimatedSalary dict into a string."""
        try:
            currency = value.get("currency", "")
            sal_value = value.get("value")
            if isinstance(sal_value, dict):
                min_val = sal_value.get("minValue", "")
                max_val = sal_value.get("maxValue", "")
                if min_val or max_val:
                    return f"{currency} {min_val}-{max_val}".strip()
            elif sal_value is not None:
                return f"{currency} {sal_value}".strip()
        except Exception:
            logger.debug("Failed to parse salary", exc_info=True)
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
