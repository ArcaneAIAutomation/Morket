"""Property tests for the asyncio-based priority task queue.

Validates priority ordering by job size (smaller jobs first, standalone
tasks highest priority) and queue stats accuracy (queue_depth and
active_workers match actual state).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from src.models.requests import ScrapeTaskState, TargetType, TaskStatus
from src.services.task_queue import TaskQueue, _PriorityEntry


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

target_types = st.sampled_from(list(TargetType))

# Job sizes: 0 means standalone, 1-100 for batch jobs
job_sizes = st.integers(min_value=0, max_value=100)

# Non-zero job sizes for batch tasks
batch_job_sizes = st.integers(min_value=1, max_value=100)


def _make_task(
    *,
    job_id: str | None = None,
    created_at: datetime | None = None,
    target_type: TargetType = TargetType.LINKEDIN_PROFILE,
) -> ScrapeTaskState:
    """Create a minimal ScrapeTaskState for testing."""
    return ScrapeTaskState(
        id=str(uuid.uuid4()),
        job_id=job_id,
        target_type=target_type,
        target_url="https://example.com/page",
        requested_fields=None,
        workspace_id="ws-test",
        status=TaskStatus.QUEUED,
        created_at=created_at or datetime.utcnow(),
    )


# ---------------------------------------------------------------------------
# Property 36: Priority queue ordering by job size
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    sizes=st.lists(batch_job_sizes, min_size=2, max_size=20),
)
def test_priority_ordering_smaller_jobs_dequeued_first(
    sizes: list[int],
) -> None:
    # Feature: scraping-microservices, Property 36: Priority queue ordering by job size
    # **Validates: Requirements 12.2**

    # Create entries with distinct job sizes and a fixed base time so
    # FIFO within the same priority doesn't interfere.
    base_time = datetime(2024, 1, 1)
    entries: list[_PriorityEntry] = []
    for i, size in enumerate(sizes):
        task = _make_task(
            job_id=f"job-{i}",
            created_at=base_time + timedelta(seconds=i),
        )
        entries.append(_PriorityEntry(task, job_size=size))

    # Sort using the __lt__ comparison (same as PriorityQueue ordering)
    sorted_entries = sorted(entries)

    # Verify: entries are ordered by ascending priority (= job_size)
    for i in range(len(sorted_entries) - 1):
        current = sorted_entries[i]
        nxt = sorted_entries[i + 1]
        assert current.priority <= nxt.priority, (
            f"Entry at index {i} has priority {current.priority} "
            f"but next entry has priority {nxt.priority}"
        )


@settings(max_examples=100)
@given(
    batch_size=batch_job_sizes,
)
def test_standalone_tasks_have_highest_priority(
    batch_size: int,
) -> None:
    # Feature: scraping-microservices, Property 36: Priority queue ordering by job size
    # **Validates: Requirements 12.2**

    base_time = datetime(2024, 1, 1)

    # Standalone task (job_id=None) should get priority 0
    standalone_task = _make_task(job_id=None, created_at=base_time)
    standalone_entry = _PriorityEntry(standalone_task, job_size=batch_size)

    # Batch task with job_id set should get priority = batch_size
    batch_task = _make_task(
        job_id="job-batch",
        created_at=base_time + timedelta(seconds=1),
    )
    batch_entry = _PriorityEntry(batch_task, job_size=batch_size)

    # Standalone always has priority 0 regardless of job_size passed
    assert standalone_entry.priority == 0
    assert batch_entry.priority == batch_size

    # Standalone should sort before batch (since batch_size >= 1)
    assert standalone_entry < batch_entry


@settings(max_examples=100)
@given(
    sizes=st.lists(job_sizes, min_size=2, max_size=30),
)
def test_priority_queue_dequeue_order(
    sizes: list[int],
) -> None:
    # Feature: scraping-microservices, Property 36: Priority queue ordering by job size
    # **Validates: Requirements 12.2**

    async def _run() -> None:
        pq: asyncio.PriorityQueue[_PriorityEntry] = asyncio.PriorityQueue()
        base_time = datetime(2024, 1, 1)

        # Enqueue entries with varying job sizes
        for i, size in enumerate(sizes):
            job_id = f"job-{i}" if size > 0 else None
            task = _make_task(
                job_id=job_id,
                created_at=base_time + timedelta(seconds=i),
            )
            entry = _PriorityEntry(task, job_size=size)
            pq.put_nowait(entry)

        # Dequeue all and verify ordering
        dequeued: list[_PriorityEntry] = []
        while not pq.empty():
            dequeued.append(pq.get_nowait())

        for i in range(len(dequeued) - 1):
            current = dequeued[i]
            nxt = dequeued[i + 1]
            # Must be ordered by priority, then by created_ts within same priority
            if current.priority == nxt.priority:
                assert current.created_ts <= nxt.created_ts, (
                    f"FIFO violated: same priority {current.priority} but "
                    f"created_ts {current.created_ts} > {nxt.created_ts}"
                )
            else:
                assert current.priority < nxt.priority, (
                    f"Priority ordering violated: {current.priority} >= {nxt.priority}"
                )

    asyncio.get_event_loop().run_until_complete(_run())


# ---------------------------------------------------------------------------
# Property 37: Queue stats accuracy
# ---------------------------------------------------------------------------


class _MockExecutor:
    """Minimal mock executor that returns the task unchanged after a short delay."""

    async def execute(self, task: ScrapeTaskState) -> ScrapeTaskState:
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime.utcnow()
        return task


@settings(max_examples=100)
@given(
    num_tasks=st.integers(min_value=0, max_value=50),
)
def test_queue_depth_matches_enqueued_count(
    num_tasks: int,
) -> None:
    # Feature: scraping-microservices, Property 37: Queue stats accuracy
    # **Validates: Requirements 12.6**

    async def _run() -> None:
        executor = _MockExecutor()
        tq = TaskQueue(
            task_executor=executor,  # type: ignore[arg-type]
            max_concurrency=5,
            max_queue_depth=500,
            task_timeout_seconds=60.0,
        )

        # Enqueue N tasks without starting workers
        for _ in range(num_tasks):
            task = _make_task(job_id=None)
            await tq.enqueue(task, job_size=0)

        stats = tq.get_stats()
        assert stats["queue_depth"] == num_tasks, (
            f"Expected queue_depth={num_tasks}, got {stats['queue_depth']}"
        )
        # No workers started, so active_workers must be 0
        assert stats["active_workers"] == 0, (
            f"Expected active_workers=0, got {stats['active_workers']}"
        )

    asyncio.get_event_loop().run_until_complete(_run())


@settings(max_examples=100)
@given(
    num_tasks=st.integers(min_value=1, max_value=20),
)
def test_queue_depth_zero_after_all_tasks_processed(
    num_tasks: int,
) -> None:
    # Feature: scraping-microservices, Property 37: Queue stats accuracy
    # **Validates: Requirements 12.6**

    async def _run() -> None:
        executor = _MockExecutor()
        tq = TaskQueue(
            task_executor=executor,  # type: ignore[arg-type]
            max_concurrency=5,
            max_queue_depth=500,
            task_timeout_seconds=60.0,
        )

        # Enqueue tasks
        for _ in range(num_tasks):
            task = _make_task(job_id=None)
            await tq.enqueue(task, job_size=0)

        assert tq.get_stats()["queue_depth"] == num_tasks

        # Start workers and let them process everything
        await tq.start_workers()

        # Give workers time to drain the queue
        for _ in range(50):
            await asyncio.sleep(0.05)
            stats = tq.get_stats()
            if stats["queue_depth"] == 0 and stats["active_workers"] == 0:
                break

        stats = tq.get_stats()
        assert stats["queue_depth"] == 0, (
            f"Expected queue_depth=0 after processing, got {stats['queue_depth']}"
        )
        assert stats["active_workers"] == 0, (
            f"Expected active_workers=0 after processing, got {stats['active_workers']}"
        )
        assert stats["completed_count"] == num_tasks, (
            f"Expected completed_count={num_tasks}, got {stats['completed_count']}"
        )

        # Clean up workers
        await tq.drain(timeout=5.0)

    asyncio.get_event_loop().run_until_complete(_run())
