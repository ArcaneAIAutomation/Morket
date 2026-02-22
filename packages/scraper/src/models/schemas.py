"""Target-type output schemas for scrape results.

Each schema defines the normalized output format for a specific target type.
All fields are optional (nullable) so that partial extractions succeed —
missing fields are set to None rather than causing validation failures.
"""

from __future__ import annotations

from pydantic import BaseModel


class NormalizedLocation(BaseModel):
    """Normalized location with structured components."""

    city: str | None = None
    state_region: str | None = None
    country: str | None = None
    raw: str | None = None  # Original text before normalization


class LinkedInProfileResult(BaseModel):
    """Output schema for linkedin_profile target type."""

    name: str | None = None
    headline: str | None = None
    current_company: str | None = None
    location: NormalizedLocation | None = None
    summary: str | None = None
    profile_url: str | None = None


class CompanyWebsiteResult(BaseModel):
    """Output schema for company_website target type."""

    company_name: str | None = None
    description: str | None = None
    industry: str | None = None
    employee_count_range: str | None = None
    headquarters: NormalizedLocation | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    website_url: str | None = None


class JobPostingResult(BaseModel):
    """Output schema for job_posting target type."""

    job_title: str | None = None
    company_name: str | None = None
    location: NormalizedLocation | None = None
    salary_range: str | None = None
    description: str | None = None
    posting_url: str | None = None
