"""Unit tests for Pydantic request/response models."""

from datetime import datetime

import pytest
from pydantic import ValidationError

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


# ---------------------------------------------------------------------------
# ApiResponse envelope
# ---------------------------------------------------------------------------


class TestApiResponse:
    def test_success_response_with_data(self):
        resp = ApiResponse(success=True, data={"key": "value"})
        assert resp.success is True
        assert resp.data == {"key": "value"}
        assert resp.error is None
        assert resp.meta is None

    def test_error_response(self):
        resp = ApiResponse(success=False, error="Something went wrong")
        assert resp.success is False
        assert resp.data is None
        assert resp.error == "Something went wrong"

    def test_response_with_meta(self):
        resp = ApiResponse(success=True, data="ok", meta={"request_id": "abc-123"})
        assert resp.meta == {"request_id": "abc-123"}

    def test_serialization_round_trip(self):
        resp = ApiResponse(success=True, data={"items": [1, 2, 3]}, meta={"page": 1})
        json_str = resp.model_dump_json()
        restored = ApiResponse.model_validate_json(json_str)
        assert restored == resp

    def test_generic_with_string_data(self):
        resp = ApiResponse[str](success=True, data="hello")
        assert resp.data == "hello"

    def test_generic_with_list_data(self):
        resp = ApiResponse[list[int]](success=True, data=[1, 2, 3])
        assert resp.data == [1, 2, 3]


# ---------------------------------------------------------------------------
# TargetType enum
# ---------------------------------------------------------------------------


class TestTargetType:
    def test_enum_values(self):
        assert TargetType.LINKEDIN_PROFILE == "linkedin_profile"
        assert TargetType.COMPANY_WEBSITE == "company_website"
        assert TargetType.JOB_POSTING == "job_posting"

    def test_enum_from_string(self):
        assert TargetType("linkedin_profile") is TargetType.LINKEDIN_PROFILE

    def test_invalid_target_type(self):
        with pytest.raises(ValueError):
            TargetType("invalid_type")


# ---------------------------------------------------------------------------
# ScrapeRequest
# ---------------------------------------------------------------------------


class TestScrapeRequest:
    def test_valid_request(self):
        req = ScrapeRequest(
            target_type=TargetType.LINKEDIN_PROFILE,
            target_url="https://linkedin.com/in/johndoe",
            workspace_id="ws-123",
        )
        assert req.target_type == TargetType.LINKEDIN_PROFILE
        assert req.target_url == "https://linkedin.com/in/johndoe"
        assert req.workspace_id == "ws-123"
        assert req.requested_fields is None
        assert req.callback_url is None

    def test_with_optional_fields(self):
        req = ScrapeRequest(
            target_type=TargetType.COMPANY_WEBSITE,
            target_url="https://example.com",
            requested_fields=["name", "description"],
            workspace_id="ws-456",
            callback_url="https://backend.io/callback",
        )
        assert req.requested_fields == ["name", "description"]
        assert req.callback_url == "https://backend.io/callback"

    def test_missing_required_field_raises(self):
        with pytest.raises(ValidationError):
            ScrapeRequest(
                target_type=TargetType.LINKEDIN_PROFILE,
                target_url="https://linkedin.com/in/johndoe",
                # missing workspace_id
            )

    def test_invalid_target_type_raises(self):
        with pytest.raises(ValidationError):
            ScrapeRequest(
                target_type="not_a_type",
                target_url="https://example.com",
                workspace_id="ws-1",
            )

    def test_serialization_round_trip(self):
        req = ScrapeRequest(
            target_type=TargetType.JOB_POSTING,
            target_url="https://jobs.example.com/123",
            requested_fields=["title", "salary"],
            workspace_id="ws-789",
        )
        json_str = req.model_dump_json()
        restored = ScrapeRequest.model_validate_json(json_str)
        assert restored == req


# ---------------------------------------------------------------------------
# BatchScrapeRequest
# ---------------------------------------------------------------------------


class TestBatchScrapeRequest:
    def _make_target(self, idx: int = 0) -> ScrapeRequest:
        return ScrapeRequest(
            target_type=TargetType.LINKEDIN_PROFILE,
            target_url=f"https://linkedin.com/in/user{idx}",
            workspace_id="ws-1",
        )

    def test_valid_batch(self):
        batch = BatchScrapeRequest(targets=[self._make_target(0), self._make_target(1)])
        assert len(batch.targets) == 2
        assert batch.callback_url is None

    def test_batch_with_callback(self):
        batch = BatchScrapeRequest(
            targets=[self._make_target()],
            callback_url="https://backend.io/webhook",
        )
        assert batch.callback_url == "https://backend.io/webhook"

    def test_batch_max_100_targets(self):
        targets = [self._make_target(i) for i in range(100)]
        batch = BatchScrapeRequest(targets=targets)
        assert len(batch.targets) == 100

    def test_batch_over_100_raises(self):
        targets = [self._make_target(i) for i in range(101)]
        with pytest.raises(ValidationError):
            BatchScrapeRequest(targets=targets)

    def test_empty_targets_raises(self):
        # An empty batch is rejected — at least one target is required
        with pytest.raises(ValidationError):
            BatchScrapeRequest(targets=[])


# ---------------------------------------------------------------------------
# SyncScrapeRequest
# ---------------------------------------------------------------------------


class TestSyncScrapeRequest:
    def test_default_timeout(self):
        req = SyncScrapeRequest(
            target_type=TargetType.COMPANY_WEBSITE,
            target_url="https://example.com",
            workspace_id="ws-1",
        )
        assert req.timeout_seconds == 60

    def test_custom_timeout(self):
        req = SyncScrapeRequest(
            target_type=TargetType.COMPANY_WEBSITE,
            target_url="https://example.com",
            workspace_id="ws-1",
            timeout_seconds=30,
        )
        assert req.timeout_seconds == 30

    def test_timeout_below_minimum_raises(self):
        with pytest.raises(ValidationError):
            SyncScrapeRequest(
                target_type=TargetType.COMPANY_WEBSITE,
                target_url="https://example.com",
                workspace_id="ws-1",
                timeout_seconds=4,
            )

    def test_timeout_above_maximum_raises(self):
        with pytest.raises(ValidationError):
            SyncScrapeRequest(
                target_type=TargetType.COMPANY_WEBSITE,
                target_url="https://example.com",
                workspace_id="ws-1",
                timeout_seconds=121,
            )

    def test_inherits_scrape_request_fields(self):
        req = SyncScrapeRequest(
            target_type=TargetType.JOB_POSTING,
            target_url="https://jobs.example.com/42",
            requested_fields=["title"],
            workspace_id="ws-2",
            callback_url="https://cb.io",
            timeout_seconds=90,
        )
        assert req.target_type == TargetType.JOB_POSTING
        assert req.callback_url == "https://cb.io"
        assert req.timeout_seconds == 90


# ---------------------------------------------------------------------------
# TaskStatus and JobStatus enums
# ---------------------------------------------------------------------------


class TestTaskStatus:
    def test_values(self):
        assert TaskStatus.QUEUED == "queued"
        assert TaskStatus.RUNNING == "running"
        assert TaskStatus.COMPLETED == "completed"
        assert TaskStatus.FAILED == "failed"

    def test_from_string(self):
        assert TaskStatus("queued") is TaskStatus.QUEUED


class TestJobStatus:
    def test_values(self):
        assert JobStatus.QUEUED == "queued"
        assert JobStatus.RUNNING == "running"
        assert JobStatus.COMPLETED == "completed"
        assert JobStatus.PARTIALLY_COMPLETED == "partially_completed"
        assert JobStatus.FAILED == "failed"
        assert JobStatus.CANCELLED == "cancelled"

    def test_from_string(self):
        assert JobStatus("partially_completed") is JobStatus.PARTIALLY_COMPLETED


# ---------------------------------------------------------------------------
# ScrapeTaskState dataclass
# ---------------------------------------------------------------------------


class TestScrapeTaskState:
    def test_creation_with_required_fields(self):
        task = ScrapeTaskState(
            id="task-uuid-1",
            job_id=None,
            target_type=TargetType.LINKEDIN_PROFILE,
            target_url="https://linkedin.com/in/johndoe",
            requested_fields=None,
            workspace_id="ws-1",
            status=TaskStatus.QUEUED,
        )
        assert task.id == "task-uuid-1"
        assert task.job_id is None
        assert task.status == TaskStatus.QUEUED
        assert task.result is None
        assert task.error is None
        assert task.started_at is None
        assert task.completed_at is None
        assert task.priority == 0
        assert isinstance(task.created_at, datetime)

    def test_creation_with_all_fields(self):
        now = datetime.utcnow()
        task = ScrapeTaskState(
            id="task-uuid-2",
            job_id="job-uuid-1",
            target_type=TargetType.COMPANY_WEBSITE,
            target_url="https://example.com",
            requested_fields=["name", "industry"],
            workspace_id="ws-2",
            status=TaskStatus.COMPLETED,
            result={"name": "Acme Corp"},
            error=None,
            created_at=now,
            started_at=now,
            completed_at=now,
            priority=5,
        )
        assert task.job_id == "job-uuid-1"
        assert task.result == {"name": "Acme Corp"}
        assert task.priority == 5

    def test_task_with_error(self):
        task = ScrapeTaskState(
            id="task-uuid-3",
            job_id=None,
            target_type=TargetType.JOB_POSTING,
            target_url="https://jobs.example.com/1",
            requested_fields=None,
            workspace_id="ws-3",
            status=TaskStatus.FAILED,
            error="Navigation timeout",
        )
        assert task.status == TaskStatus.FAILED
        assert task.error == "Navigation timeout"


# ---------------------------------------------------------------------------
# ScrapeJobState dataclass
# ---------------------------------------------------------------------------


class TestScrapeJobState:
    def test_creation_with_required_fields(self):
        job = ScrapeJobState(
            id="job-uuid-1",
            task_ids=["t1", "t2", "t3"],
            status=JobStatus.QUEUED,
            total_tasks=3,
        )
        assert job.id == "job-uuid-1"
        assert len(job.task_ids) == 3
        assert job.status == JobStatus.QUEUED
        assert job.total_tasks == 3
        assert job.completed_tasks == 0
        assert job.failed_tasks == 0
        assert job.callback_url is None
        assert isinstance(job.created_at, datetime)
        assert isinstance(job.updated_at, datetime)

    def test_creation_with_all_fields(self):
        now = datetime.utcnow()
        job = ScrapeJobState(
            id="job-uuid-2",
            task_ids=["t1", "t2"],
            status=JobStatus.PARTIALLY_COMPLETED,
            total_tasks=2,
            completed_tasks=1,
            failed_tasks=1,
            callback_url="https://backend.io/webhook",
            created_at=now,
            updated_at=now,
        )
        assert job.completed_tasks == 1
        assert job.failed_tasks == 1
        assert job.callback_url == "https://backend.io/webhook"

    def test_cancelled_job(self):
        job = ScrapeJobState(
            id="job-uuid-3",
            task_ids=["t1"],
            status=JobStatus.CANCELLED,
            total_tasks=1,
        )
        assert job.status == JobStatus.CANCELLED


# ---------------------------------------------------------------------------
# __init__.py re-exports
# ---------------------------------------------------------------------------


class TestModuleExports:
    def test_all_symbols_importable_from_models(self):
        from src.models import (
            ApiResponse,
            BatchScrapeRequest,
            JobStatus,
            ScrapeJobState,
            ScrapeRequest,
            ScrapeTaskState,
            SyncScrapeRequest,
            TargetType,
            TaskStatus,
        )

        # Verify they are the correct types
        assert ApiResponse is not None
        assert TargetType.LINKEDIN_PROFILE == "linkedin_profile"
        assert TaskStatus.QUEUED == "queued"
        assert JobStatus.CANCELLED == "cancelled"
