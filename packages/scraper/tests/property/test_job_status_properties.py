"""Property tests for the job service.

Validates batch job creation, job status derivation from task outcomes,
job results filtering, and job cancellation behaviour.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from src.config.settings import ScraperSettings
from src.models.requests import (
    JobStatus,
    ScrapeJobState,
    ScrapeRequest,
    ScrapeTaskState,
    TargetType,
    TaskStatus,
)
from src.services.job_service import JobService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings() -> ScraperSettings:
    return ScraperSettings(
        service_key="test-key",
        backend_api_url="http://localhost:3000/api/v1",
        backend_service_key="test-backend-key",
        webhook_secret="test-secret",
    )


class _MockTaskQueue:
    """Minimal mock that records enqueued tasks."""

    def __init__(self) -> None:
        self.enqueued: list[ScrapeTaskState] = []

    async def enqueue_batch(
        self, tasks: list[ScrapeTaskState], job_size: int | None = None
    ) -> None:
        self.enqueued.extend(tasks)

    async def cancel_job_tasks(self, job_id: str) -> int:
        return 0


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

target_types = st.sampled_from(list(TargetType))

scrape_targets = st.builds(
    ScrapeRequest,
    target_type=target_types,
    target_url=st.just("https://example.com/page"),
    workspace_id=st.uuids().map(str),
)

# Number of targets in a batch (1–100)
batch_sizes = st.integers(min_value=1, max_value=100)

# Completed / failed counts for job status derivation
positive_ints = st.integers(min_value=1, max_value=100)


# ---------------------------------------------------------------------------
# Property 8: Batch job creates correct task count
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(num_targets=batch_sizes)
def test_batch_job_creates_correct_task_count(num_targets: int) -> None:
    # Feature: scraping-microservices, Property 8: Batch job creates correct task count
    # **Validates: Requirements 3.1**

    async def _run() -> None:
        mock_queue = _MockTaskQueue()
        svc = JobService(
            task_queue=mock_queue,  # type: ignore[arg-type]
            settings=_make_settings(),
        )

        # Build N targets
        targets = [
            ScrapeRequest(
                target_type=TargetType.LINKEDIN_PROFILE,
                target_url=f"https://example.com/{i}",
                workspace_id="ws-test",
            )
            for i in range(num_targets)
        ]

        job = await svc.create_job(targets)

        # Job must have exactly N tasks
        assert job.total_tasks == num_targets, (
            f"Expected total_tasks={num_targets}, got {job.total_tasks}"
        )
        assert len(job.task_ids) == num_targets, (
            f"Expected {num_targets} task_ids, got {len(job.task_ids)}"
        )

        # Job ID must be a valid UUID
        uuid.UUID(job.id)  # raises ValueError if invalid

        # All task IDs must be valid UUIDs and unique
        seen: set[str] = set()
        for tid in job.task_ids:
            uuid.UUID(tid)
            assert tid not in seen, f"Duplicate task ID: {tid}"
            seen.add(tid)

        # Mock queue should have received exactly N tasks
        assert len(mock_queue.enqueued) == num_targets

    asyncio.get_event_loop().run_until_complete(_run())


# ---------------------------------------------------------------------------
# Property 9: Job status derived from task outcomes
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(completed=positive_ints)
def test_all_completed_yields_completed_status(completed: int) -> None:
    # Feature: scraping-microservices, Property 9: Job status derived from task outcomes
    # **Validates: Requirements 3.4**

    svc = JobService(
        task_queue=_MockTaskQueue(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    job = ScrapeJobState(
        id=str(uuid.uuid4()),
        task_ids=[],
        status=JobStatus.RUNNING,
        total_tasks=completed,
        completed_tasks=completed,
        failed_tasks=0,
    )

    assert svc.compute_final_status(job) == JobStatus.COMPLETED


@settings(max_examples=100)
@given(failed=positive_ints)
def test_all_failed_yields_failed_status(failed: int) -> None:
    # Feature: scraping-microservices, Property 9: Job status derived from task outcomes
    # **Validates: Requirements 3.4**

    svc = JobService(
        task_queue=_MockTaskQueue(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    job = ScrapeJobState(
        id=str(uuid.uuid4()),
        task_ids=[],
        status=JobStatus.RUNNING,
        total_tasks=failed,
        completed_tasks=0,
        failed_tasks=failed,
    )

    assert svc.compute_final_status(job) == JobStatus.FAILED


@settings(max_examples=100)
@given(completed=positive_ints, failed=positive_ints)
def test_mixed_outcomes_yields_partially_completed(
    completed: int, failed: int
) -> None:
    # Feature: scraping-microservices, Property 9: Job status derived from task outcomes
    # **Validates: Requirements 3.4**

    svc = JobService(
        task_queue=_MockTaskQueue(),  # type: ignore[arg-type]
        settings=_make_settings(),
    )

    job = ScrapeJobState(
        id=str(uuid.uuid4()),
        task_ids=[],
        status=JobStatus.RUNNING,
        total_tasks=completed + failed,
        completed_tasks=completed,
        failed_tasks=failed,
    )

    assert svc.compute_final_status(job) == JobStatus.PARTIALLY_COMPLETED


# ---------------------------------------------------------------------------
# Property 10: Job results contain only completed tasks
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    outcomes=st.lists(
        st.sampled_from([TaskStatus.COMPLETED, TaskStatus.FAILED]),
        min_size=1,
        max_size=50,
    ),
)
def test_job_results_contain_only_completed_tasks(
    outcomes: list[TaskStatus],
) -> None:
    # Feature: scraping-microservices, Property 10: Job results contain only completed tasks
    # **Validates: Requirements 3.3**

    async def _run() -> None:
        mock_queue = _MockTaskQueue()
        svc = JobService(
            task_queue=mock_queue,  # type: ignore[arg-type]
            settings=_make_settings(),
        )

        num = len(outcomes)
        targets = [
            ScrapeRequest(
                target_type=TargetType.COMPANY_WEBSITE,
                target_url=f"https://example.com/{i}",
                workspace_id="ws-test",
            )
            for i in range(num)
        ]

        job = await svc.create_job(targets)

        # Simulate task completions
        expected_completed = 0
        for i, outcome in enumerate(outcomes):
            task_id = job.task_ids[i]
            task = svc._tasks[task_id]
            task.status = outcome
            if outcome == TaskStatus.COMPLETED:
                task.result = {"data": f"result-{i}"}
                expected_completed += 1
            else:
                task.error = "simulated failure"
            svc.update_task_result(task)

        results = svc.get_job_results(job.id)

        # Results count must match completed tasks
        assert len(results) == expected_completed, (
            f"Expected {expected_completed} results, got {len(results)}"
        )
        assert len(results) == svc.get_job(job.id).completed_tasks

        # Every result must have a non-None result dict
        for r in results:
            assert r["result"] is not None

    asyncio.get_event_loop().run_until_complete(_run())


# ---------------------------------------------------------------------------
# Property 11: Job cancellation preserves running tasks
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(num_targets=st.integers(min_value=1, max_value=50))
def test_job_cancellation_sets_cancelled_status(num_targets: int) -> None:
    # Feature: scraping-microservices, Property 11: Job cancellation preserves running tasks
    # **Validates: Requirements 3.5**

    async def _run() -> None:
        mock_queue = _MockTaskQueue()
        svc = JobService(
            task_queue=mock_queue,  # type: ignore[arg-type]
            settings=_make_settings(),
        )

        targets = [
            ScrapeRequest(
                target_type=TargetType.JOB_POSTING,
                target_url=f"https://example.com/{i}",
                workspace_id="ws-test",
            )
            for i in range(num_targets)
        ]

        job = await svc.create_job(targets)

        cancelled_job = await svc.cancel_job(job.id)

        # Job status must be CANCELLED
        assert cancelled_job.status == JobStatus.CANCELLED

        # Verify via get_job as well
        fetched = svc.get_job(job.id)
        assert fetched.status == JobStatus.CANCELLED

    asyncio.get_event_loop().run_until_complete(_run())
