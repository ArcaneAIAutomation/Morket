"""Public models for the scraper service."""

from src.models.requests import (
    BatchScrapeRequest,
    JobStatus,
    ScrapeJobState,
    ScrapeRequest,
    ScrapeTaskState,
    SyncScrapeRequest,
    TargetType,
    TaskStatus,
)
from src.models.responses import ApiResponse
from src.models.schemas import (
    CompanyWebsiteResult,
    JobPostingResult,
    LinkedInProfileResult,
    NormalizedLocation,
)

__all__ = [
    "ApiResponse",
    "BatchScrapeRequest",
    "CompanyWebsiteResult",
    "JobPostingResult",
    "JobStatus",
    "LinkedInProfileResult",
    "NormalizedLocation",
    "ScrapeJobState",
    "ScrapeRequest",
    "ScrapeTaskState",
    "SyncScrapeRequest",
    "TargetType",
    "TaskStatus",
]
