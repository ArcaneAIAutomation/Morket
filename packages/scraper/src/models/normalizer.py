"""Result normalization logic.

Transforms raw extraction dicts into validated Pydantic models matching
the enrichment pipeline's expected output schemas. Handles:
- HTML tag stripping from all string values
- Whitespace normalization (collapse multiple spaces/newlines to single space)
- Leading/trailing whitespace trimming
- URL normalization (ensure https:// scheme, remove tracking params)
- Location string parsing into NormalizedLocation
- Partial result construction on validation failure
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from pydantic import BaseModel, ValidationError

from src.models.requests import TargetType
from src.models.schemas import (
    CompanyWebsiteResult,
    JobPostingResult,
    LinkedInProfileResult,
    NormalizedLocation,
)

# Regex for stripping HTML tags
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Tracking query parameters to remove from URLs
_TRACKING_PARAMS = frozenset({
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
})

# Map target types to their Pydantic output models
_TARGET_TYPE_MODELS: dict[TargetType, type[BaseModel]] = {
    TargetType.LINKEDIN_PROFILE: LinkedInProfileResult,
    TargetType.COMPANY_WEBSITE: CompanyWebsiteResult,
    TargetType.JOB_POSTING: JobPostingResult,
}

# Fields that contain URLs, keyed by target type
_URL_FIELDS: dict[TargetType, set[str]] = {
    TargetType.LINKEDIN_PROFILE: {"profile_url"},
    TargetType.COMPANY_WEBSITE: {"website_url"},
    TargetType.JOB_POSTING: {"posting_url"},
}

# Fields that contain location strings, keyed by target type
_LOCATION_FIELDS: dict[TargetType, set[str]] = {
    TargetType.LINKEDIN_PROFILE: {"location"},
    TargetType.COMPANY_WEBSITE: {"headquarters"},
    TargetType.JOB_POSTING: {"location"},
}


def strip_html(text: str) -> str:
    """Strip HTML tags from a string."""
    return _HTML_TAG_RE.sub("", text)


def normalize_whitespace(text: str) -> str:
    """Collapse multiple whitespace characters into a single space and trim."""
    return re.sub(r"\s+", " ", text).strip()


def clean_text(text: str) -> str:
    """Strip HTML tags, normalize whitespace, and trim a text value."""
    return normalize_whitespace(strip_html(text))


def normalize_url(url: str) -> str:
    """Normalize a URL: ensure https:// scheme and remove tracking parameters."""
    url = url.strip()
    if not url:
        return url

    # Ensure scheme is present
    if not url.startswith(("http://", "https://", "//")):
        url = "https://" + url
    elif url.startswith("//"):
        url = "https:" + url

    parsed = urlparse(url)

    # Force https scheme
    scheme = "https"

    # Remove tracking query parameters
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=True)
        filtered = {
            k: v
            for k, v in params.items()
            if k.lower() not in _TRACKING_PARAMS
            and not k.lower().startswith("utm_")
        }
        query = urlencode(filtered, doseq=True)
    else:
        query = ""

    normalized = urlunparse((
        scheme,
        parsed.netloc,
        parsed.path,
        parsed.params,
        query,
        "",  # drop fragment
    ))
    return normalized


def normalize_location(raw: str) -> NormalizedLocation:
    """Parse a location string into a NormalizedLocation.

    Heuristic: split on commas and assign parts based on count:
    - 1 part  → city only
    - 2 parts → city, country
    - 3+ parts → city, state_region, country (extra parts ignored)
    """
    cleaned = clean_text(raw)
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]

    city = None
    state_region = None
    country = None

    if len(parts) == 1:
        city = parts[0]
    elif len(parts) == 2:
        city = parts[0]
        country = parts[1]
    elif len(parts) >= 3:
        city = parts[0]
        state_region = parts[1]
        country = parts[2]

    return NormalizedLocation(
        city=city or None,
        state_region=state_region or None,
        country=country or None,
        raw=raw,
    )


class ResultNormalizer:
    """Transforms raw extraction dicts into validated Pydantic models."""

    def normalize(self, raw_data: dict, target_type: TargetType) -> BaseModel:
        """Normalize raw extraction data into a validated Pydantic model.

        Steps:
        1. Clean all string values (strip HTML, normalize whitespace, trim)
        2. Normalize URL fields (ensure https://, remove tracking params)
        3. Normalize location fields into NormalizedLocation objects
        4. Validate against the target-type Pydantic schema
        5. On validation failure, return partial result with only valid fields
        """
        model_cls = _TARGET_TYPE_MODELS[target_type]
        url_fields = _URL_FIELDS.get(target_type, set())
        location_fields = _LOCATION_FIELDS.get(target_type, set())

        normalized: dict = {}
        for key, value in raw_data.items():
            if value is None:
                normalized[key] = None
                continue

            if key in location_fields:
                if isinstance(value, str):
                    normalized[key] = normalize_location(value)
                elif isinstance(value, dict):
                    # Already structured — pass through with text cleaning
                    normalized[key] = NormalizedLocation(
                        city=clean_text(value.get("city", "")) or None,
                        state_region=clean_text(value.get("state_region", "")) or None,
                        country=clean_text(value.get("country", "")) or None,
                        raw=value.get("raw"),
                    )
                else:
                    normalized[key] = value
            elif key in url_fields:
                if isinstance(value, str):
                    normalized[key] = normalize_url(value)
                else:
                    normalized[key] = value
            elif isinstance(value, str):
                normalized[key] = clean_text(value)
            else:
                normalized[key] = value

        # Attempt full validation
        try:
            return model_cls.model_validate(normalized)
        except ValidationError:
            # Build partial result with only valid fields
            return self._build_partial(normalized, model_cls)

    def _build_partial(
        self, data: dict, model_cls: type[BaseModel]
    ) -> BaseModel:
        """Build a partial model with only the fields that individually validate."""
        valid_fields: dict = {}
        for field_name in model_cls.model_fields:
            if field_name not in data:
                continue
            try:
                # Validate single field by constructing with just that field
                model_cls.model_validate({field_name: data[field_name]})
                valid_fields[field_name] = data[field_name]
            except ValidationError:
                # Skip this field — it doesn't validate
                continue
        return model_cls.model_validate(valid_fields)
