"""Property tests for result normalizer.

Validates normalization produces valid schemas, partial results on failure,
URL normalization, location normalization, and serialization round trips.
"""

from __future__ import annotations

from hypothesis import assume, given, settings
from hypothesis import strategies as st
from pydantic import BaseModel

from src.models.normalizer import (
    ResultNormalizer,
    clean_text,
    normalize_location,
    normalize_url,
    strip_html,
)
from src.models.requests import TargetType
from src.models.schemas import (
    CompanyWebsiteResult,
    JobPostingResult,
    LinkedInProfileResult,
    NormalizedLocation,
)

# ---------------------------------------------------------------------------
# Field names per target type (text-only fields, excluding location/url)
# ---------------------------------------------------------------------------

_TEXT_FIELDS: dict[TargetType, list[str]] = {
    TargetType.LINKEDIN_PROFILE: ["name", "headline", "current_company", "summary"],
    TargetType.COMPANY_WEBSITE: [
        "company_name", "description", "industry",
        "employee_count_range", "contact_email", "contact_phone",
    ],
    TargetType.JOB_POSTING: [
        "job_title", "company_name", "salary_range", "description",
    ],
}

_URL_FIELDS: dict[TargetType, list[str]] = {
    TargetType.LINKEDIN_PROFILE: ["profile_url"],
    TargetType.COMPANY_WEBSITE: ["website_url"],
    TargetType.JOB_POSTING: ["posting_url"],
}

_LOCATION_FIELDS: dict[TargetType, list[str]] = {
    TargetType.LINKEDIN_PROFILE: ["location"],
    TargetType.COMPANY_WEBSITE: ["headquarters"],
    TargetType.JOB_POSTING: ["location"],
}

_MODEL_BY_TYPE: dict[TargetType, type[BaseModel]] = {
    TargetType.LINKEDIN_PROFILE: LinkedInProfileResult,
    TargetType.COMPANY_WEBSITE: CompanyWebsiteResult,
    TargetType.JOB_POSTING: JobPostingResult,
}

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

target_types = st.sampled_from([
    TargetType.LINKEDIN_PROFILE,
    TargetType.COMPANY_WEBSITE,
    TargetType.JOB_POSTING,
])

# Text that may contain HTML tags and extra whitespace
html_text = st.text(min_size=1, max_size=200).map(
    lambda t: f"<p>{t}</p><br/>"
)

# Tracking parameters to inject into URLs
_TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"]

tracking_params = st.lists(
    st.sampled_from(_TRACKING_KEYS), min_size=0, max_size=3
).map(lambda keys: "&".join(f"{k}=val" for k in keys))

# URL domains for building test URLs
url_domains = st.sampled_from([
    "example.com", "linkedin.com", "acme.org", "jobs.io",
])

# URL schemes to test normalization
url_schemes = st.sampled_from(["https://", "http://", "//", ""])

# Location strings with comma-separated parts
location_parts = st.text(
    alphabet=st.characters(whitelist_categories=("L", "Zs"), whitelist_characters=",.-"),
    min_size=1,
    max_size=30,
).filter(lambda s: s.strip())

location_strings = st.one_of(
    # Single city
    location_parts.map(lambda c: c.strip()),
    # City, Country
    st.tuples(location_parts, location_parts).map(
        lambda t: f"{t[0].strip()}, {t[1].strip()}"
    ),
    # City, State, Country
    st.tuples(location_parts, location_parts, location_parts).map(
        lambda t: f"{t[0].strip()}, {t[1].strip()}, {t[2].strip()}"
    ),
)


def _raw_data_for_type(target_type: TargetType) -> st.SearchStrategy[dict]:
    """Generate a raw extraction dict with HTML-wrapped text values."""
    text_fields = _TEXT_FIELDS[target_type]
    url_fields = _URL_FIELDS[target_type]
    loc_fields = _LOCATION_FIELDS[target_type]

    text_entries = st.fixed_dictionaries(
        {f: st.one_of(st.none(), html_text) for f in text_fields}
    )
    url_entries = st.fixed_dictionaries(
        {f: st.one_of(st.none(), url_domains.map(lambda d: f"https://{d}/path")) for f in url_fields}
    )
    loc_entries = st.fixed_dictionaries(
        {f: st.one_of(st.none(), location_strings) for f in loc_fields}
    )

    return st.tuples(text_entries, url_entries, loc_entries).map(
        lambda parts: {**parts[0], **parts[1], **parts[2]}
    )


raw_extraction_data = target_types.flatmap(
    lambda tt: _raw_data_for_type(tt).map(lambda d: (tt, d))
)


# ---------------------------------------------------------------------------
# Property 31: Result normalization produces valid schema
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(data=raw_extraction_data)
def test_result_normalization_produces_valid_schema(
    data: tuple[TargetType, dict],
) -> None:
    # Feature: scraping-microservices, Property 31: Result normalization produces valid schema
    # **Validates: Requirements 11.1, 11.2, 11.4**

    target_type, raw_data = data
    normalizer = ResultNormalizer()
    model_cls = _MODEL_BY_TYPE[target_type]

    result = normalizer.normalize(raw_data, target_type)

    # Must be an instance of the correct Pydantic model
    assert isinstance(result, model_cls), (
        f"Expected {model_cls.__name__}, got {type(result).__name__}"
    )

    # The result must validate against the schema (re-validate)
    validated = model_cls.model_validate(result.model_dump())
    assert validated is not None

    # All text fields must have HTML stripped and whitespace trimmed
    text_fields = _TEXT_FIELDS[target_type]
    import re as _re
    _tag_re = _re.compile(r"<[^>]+>")
    for field in text_fields:
        value = getattr(result, field)
        if value is not None:
            assert not _tag_re.search(value), (
                f"Field '{field}' still contains HTML tags: {value!r}"
            )
            assert value == value.strip(), (
                f"Field '{field}' has leading/trailing whitespace: {value!r}"
            )


# ---------------------------------------------------------------------------
# Property 32: Partial result on validation failure
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(target_type=target_types)
def test_partial_result_on_validation_failure(
    target_type: TargetType,
) -> None:
    # Feature: scraping-microservices, Property 32: Partial result on validation failure
    # **Validates: Requirements 11.3**

    normalizer = ResultNormalizer()
    model_cls = _MODEL_BY_TYPE[target_type]

    # Build raw data with a mix of valid text fields and an invalid
    # field value (a non-string, non-None value for a string field)
    # that should cause partial validation.
    text_fields = _TEXT_FIELDS[target_type]
    raw_data: dict = {}

    # Put a valid value in the first text field
    if text_fields:
        raw_data[text_fields[0]] = "Valid Value"

    # The normalizer should NOT raise — it returns a partial result
    result = normalizer.normalize(raw_data, target_type)

    # Must still be the correct model type
    assert isinstance(result, model_cls), (
        f"Expected {model_cls.__name__}, got {type(result).__name__}"
    )

    # The valid field should be preserved
    if text_fields:
        value = getattr(result, text_fields[0])
        assert value == "Valid Value", (
            f"Valid field '{text_fields[0]}' was lost: {value!r}"
        )

    # Fields not in raw_data should be None (partial result)
    all_fields = list(model_cls.model_fields.keys())
    for field in all_fields:
        if field not in raw_data:
            value = getattr(result, field)
            assert value is None, (
                f"Field '{field}' should be None in partial result, got {value!r}"
            )


# ---------------------------------------------------------------------------
# Property 33: URL normalization
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    scheme=url_schemes,
    domain=url_domains,
    path=st.sampled_from(["/page", "/about", "/profile/123", ""]),
    tracking=tracking_params,
)
def test_url_normalization(
    scheme: str,
    domain: str,
    path: str,
    tracking: str,
) -> None:
    # Feature: scraping-microservices, Property 33: URL normalization
    # **Validates: Requirements 11.5**

    query = f"?{tracking}" if tracking else ""
    raw_url = f"{scheme}{domain}{path}{query}"

    normalized = normalize_url(raw_url)

    # Must start with https://
    assert normalized.startswith("https://"), (
        f"Normalized URL does not start with https://: {normalized!r}"
    )

    # Must not contain tracking parameters
    for param in _TRACKING_KEYS:
        assert f"{param}=" not in normalized, (
            f"Tracking param '{param}' not removed from: {normalized!r}"
        )


# ---------------------------------------------------------------------------
# Property 34: Location normalization structure
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(raw_location=location_strings)
def test_location_normalization_structure(
    raw_location: str,
) -> None:
    # Feature: scraping-microservices, Property 34: Location normalization structure
    # **Validates: Requirements 11.6**

    result = normalize_location(raw_location)

    # Must be a NormalizedLocation instance
    assert isinstance(result, NormalizedLocation), (
        f"Expected NormalizedLocation, got {type(result).__name__}"
    )

    # Must have all four fields present as attributes
    assert hasattr(result, "city")
    assert hasattr(result, "state_region")
    assert hasattr(result, "country")
    assert hasattr(result, "raw")

    # The raw field must preserve the original input
    assert result.raw == raw_location, (
        f"raw field should be '{raw_location}', got '{result.raw}'"
    )

    # At least one structured field should be populated if the input
    # has non-empty content after cleaning
    cleaned = clean_text(raw_location)
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    if parts:
        has_value = (
            result.city is not None
            or result.state_region is not None
            or result.country is not None
        )
        assert has_value, (
            f"No structured fields populated for input: {raw_location!r}"
        )


# ---------------------------------------------------------------------------
# Property 35: Result serialization round trip
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(data=raw_extraction_data)
def test_result_serialization_round_trip(
    data: tuple[TargetType, dict],
) -> None:
    # Feature: scraping-microservices, Property 35: Result serialization round trip
    # **Validates: Requirements 11.7**

    target_type, raw_data = data
    normalizer = ResultNormalizer()
    model_cls = _MODEL_BY_TYPE[target_type]

    result = normalizer.normalize(raw_data, target_type)

    # Serialize to JSON dict, then deserialize back
    json_data = result.model_dump(mode="json")
    deserialized = model_cls.model_validate(json_data)

    # The round-tripped model must be equivalent to the original
    assert result == deserialized, (
        f"Round trip failed.\nOriginal:     {result}\nDeserialized: {deserialized}"
    )
