"""Pydantic request models and in-memory state models for scrape tasks and jobs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class TargetType(str, Enum):
    """Supported scrape target types."""

    LINKEDIN_PROFILE = "linkedin_profile"
    COMPANY_WEBSITE = "company_website"
    JOB_POSTING = "job_posting"


class ScrapeRequest(BaseModel):
    """Request model for a single async scrape task."""

    target_type: TargetType
    target_url: str = Field(..., min_length=1)
    requested_fields: list[str] | None = None
    workspace_id: str = Field(..., min_length=1)
    callback_url: str | None = None


class BatchScrapeRequest(BaseModel):
    """Request model for a batch of scrape targets (max 100)."""

    targets: list[ScrapeRequest] = Field(..., min_length=1, max_length=100)
    callback_url: str | None = None


class SyncScrapeRequest(ScrapeRequest):
    """Request model for a synchronous scrape task with configurable timeout."""

    timeout_seconds: int = Field(default=60, ge=5, le=120)


class TaskStatus(str, Enum):
    """Status of an individual scrape task."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobStatus(str, Enum):
    """Status of a batch scrape job."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ScrapeTaskState:
    """In-memory state for a single scrape task."""

    id: str  # UUID
    job_id: str | None
    target_type: TargetType
    target_url: str
    requested_fields: list[str] | None
    workspace_id: str
    status: TaskStatus
    result: dict | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    priority: int = 0  # Lower = higher priority


@dataclass
class ScrapeJobState:
    """In-memory state for a batch scrape job."""

    id: str  # UUID
    task_ids: list[str]
    status: JobStatus
    total_tasks: int
    completed_tasks: int = 0
    failed_tasks: int = 0
    callback_url: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
