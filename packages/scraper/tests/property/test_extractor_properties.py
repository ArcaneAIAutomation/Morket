"""Property tests for page extractors.

Validates that missing extraction fields default to null (None) rather than
causing errors, by passing partial raw dicts through the ResultNormalizer.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from src.models.normalizer import ResultNormalizer
from src.models.requests import TargetType
from src.models.schemas import (
    CompanyWebsiteResult,
    JobPostingResult,
    LinkedInProfileResult,
    NormalizedLocation,
)

# ---------------------------------------------------------------------------
# Field names per target type (matching the Pydantic output schemas)
# ---------------------------------------------------------------------------

_LINKEDIN_FIELDS = [
    "name", "headline", "current_company", "location", "summary", "profile_url",
]

_COMPANY_FIELDS = [
    "company_name", "description", "industry", "employee_count_range",
    "headquarters", "contact_email", "contact_phone", "website_url",
]

_JOB_FIELDS = [
    "job_title", "company_name", "location", "salary_range",
    "description", "posting_url",
]

_FIELDS_BY_TYPE: dict[TargetType, list[str]] = {
    TargetType.LINKEDIN_PROFILE: _LINKEDIN_FIELDS,
    TargetType.COMPANY_WEBSITE: _COMPANY_FIELDS,
    TargetType.JOB_POSTING: _JOB_FIELDS,
}

_MODEL_BY_TYPE: dict[TargetType, type] = {
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


def _partial_raw_data(target_type: TargetType) -> st.SearchStrategy[dict]:
    """Generate a raw extraction dict with a random subset of fields.

    Some fields are present (with text values), others are deliberately
    omitted to simulate missing extraction fields.
    """
    all_fields = _FIELDS_BY_TYPE[target_type]
    return st.sets(
        st.sampled_from(all_fields), min_size=0, max_size=len(all_fields)
    ).map(
        lambda present: {f: f"value-{f}" if f in present else None for f in all_fields}
    )


# Flatten: pick a target type, then generate partial data for it
partial_extraction = target_types.flatmap(
    lambda tt: _partial_raw_data(tt).map(lambda d: (tt, d))
)


# ---------------------------------------------------------------------------
# Property 13: Missing extraction fields default to null
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(data=partial_extraction)
def test_missing_extraction_fields_default_to_null(
    data: tuple[TargetType, dict],
) -> None:
    # Feature: scraping-microservices, Property 13: Missing extraction fields default to null
    # **Validates: Requirements 5.5**

    target_type, raw_data = data
    normalizer = ResultNormalizer()
    model_cls = _MODEL_BY_TYPE[target_type]
    all_fields = _FIELDS_BY_TYPE[target_type]

    # Normalize the partial raw data — this must NOT raise
    result = normalizer.normalize(raw_data, target_type)

    # Result must be an instance of the correct schema model
    assert isinstance(result, model_cls), (
        f"Expected {model_cls.__name__}, got {type(result).__name__}"
    )

    # Every field in the schema must exist on the result (no KeyError / AttributeError)
    for field in all_fields:
        value = getattr(result, field, "MISSING")
        assert value != "MISSING", (
            f"Field '{field}' missing from result model"
        )

        # If the raw data had None for this field, the result must also be None
        if raw_data.get(field) is None:
            assert value is None, (
                f"Field '{field}' should be None for missing extraction, got {value!r}"
            )
