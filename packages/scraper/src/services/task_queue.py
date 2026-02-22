"""Asyncio-based priority task queue with concurrency control.

Manages concurrent scrape task execution using an asyncio.PriorityQueue.
Tasks from smaller jobs are prioritized over tasks from larger jobs, and
standalone tasks (no job_id) get the highest priority.

Workers are asyncio tasks that loop pulling from the priority queue and
delegating execution to the TaskExecutor. The queue enforces a max depth
and per-task timeout.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import datetime

from src.middleware.error_handler import QueueFullError
from src.models.requests import ScrapeTaskState, TaskStatus
from src.services.task_executor import TaskExecutor

logger = logging.getLogger(__name__)


class _PriorityEntry:
    """Wrapper for priority queue ordering.

    Priority key: ``(job_size, created_at_ts)``
    - Standalone tasks (job_id is None): job_size = 0 (highest priority)
    - Batch tasks: job_size = number of tasks in the job
    - Within the same job_size, FIFO by created_at timestamp
    """

    __slots__ = ("priority", "created_ts", "task")

    def __init__(self, task: ScrapeTaskState, job_size: int) -> None:
        self.priority = job_size if task.job_id is not None else 0
        self.created_ts = task.created_at.timestamp()
        self.task = task

    def __lt__(self, other: _PriorityEntry) -> bool:
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.created_ts < other.created_ts


class TaskQueue:
    """Asyncio-based priority queue for scrape tasks.

    Parameters
    ----------
    task_executor:
        Executor that runs individual scrape tasks through the full pipeline.
    max_concurrency:
        Maximum number of concurrent workers (default = browser pool size).
    max_queue_depth:
        Maximum number of pending tasks in the queue. Rejects with
        ``QueueFullError`` when full.
    task_timeout_seconds:
        Per-task execution timeout in seconds.
    on_task_complete:
        Optional callback invoked when a task finishes (for job service tracking).
    """

    def __init__(
        self,
        *,
        task_executor: TaskExecutor,
        max_concurrency: int = 5,
        max_queue_depth: int = 500,
        task_timeout_seconds: float = 60.0,
        on_task_complete: Callable[[ScrapeTaskState], None] | None = None,
    ) -> None:
        self._executor = task_executor
        self._max_concurrency = max_concurrency
        self._max_queue_depth = max_queue_depth
        self._task_timeout = task_timeout_seconds
        self._on_task_complete = on_task_complete

        # Internal asyncio priority queue (unbounded — we enforce depth manually)
        self._queue: asyncio.PriorityQueue[_PriorityEntry] = asyncio.PriorityQueue()

        # Track pending count separately because PriorityQueue.qsize() includes
        # items that have been get()'d but not yet task_done()'d in join() semantics.
        # We need a count of items *waiting* to be picked up by workers.
        self._pending_count = 0

        # Cancelled job IDs — workers skip tasks whose job_id is in this set
        self._cancelled_jobs: set[str] = set()

        # Worker asyncio tasks
        self._workers: list[asyncio.Task[None]] = []

        # Draining flag — when True, enqueue() rejects new tasks
        self._draining = False

        # Active worker count (currently executing a task)
        self._active_workers = 0

        # Stats tracking
        self._completed_count = 0
        self._total_duration_ms = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(self, task: ScrapeTaskState, job_size: int = 0) -> None:
        """Add a single task to the priority queue.

        Parameters
        ----------
        task:
            The scrape task to enqueue.
        job_size:
            Total number of tasks in the parent job (0 for standalone).

        Raises
        ------
        QueueFullError
            If the queue has reached ``max_queue_depth``.
        """
        if self._draining:
            raise QueueFullError("Task queue is draining — not accepting new tasks")

        if self._pending_count >= self._max_queue_depth:
            raise QueueFullError(
                f"Task queue is full ({self._max_queue_depth} pending tasks)"
            )

        entry = _PriorityEntry(task, job_size)
        self._queue.put_nowait(entry)
        self._pending_count += 1
        logger.debug(
            "Enqueued task %s (job=%s, priority=%d, queue_depth=%d)",
            task.id,
            task.job_id,
            entry.priority,
            self._pending_count,
        )

    async def enqueue_batch(
        self, tasks: list[ScrapeTaskState], job_size: int | None = None
    ) -> None:
        """Enqueue multiple tasks from the same job.

        Parameters
        ----------
        tasks:
            List of scrape tasks to enqueue.
        job_size:
            Total number of tasks in the job. Defaults to ``len(tasks)``.
        """
        if not tasks:
            return

        size = job_size if job_size is not None else len(tasks)

        # Pre-check capacity for the entire batch
        if self._draining:
            raise QueueFullError("Task queue is draining — not accepting new tasks")

        if self._pending_count + len(tasks) > self._max_queue_depth:
            raise QueueFullError(
                f"Task queue cannot accept batch of {len(tasks)} "
                f"(current depth {self._pending_count}, max {self._max_queue_depth})"
            )

        for task in tasks:
            entry = _PriorityEntry(task, size)
            self._queue.put_nowait(entry)
            self._pending_count += 1

        logger.debug(
            "Enqueued batch of %d tasks (job_size=%d, queue_depth=%d)",
            len(tasks),
            size,
            self._pending_count,
        )

    async def cancel_job_tasks(self, job_id: str) -> int:
        """Mark all queued tasks for a job as cancelled.

        Tasks already being executed by workers are not interrupted.
        Returns the number of tasks that will be skipped.
        """
        self._cancelled_jobs.add(job_id)
        # We can't remove items from PriorityQueue, so workers will
        # check the cancelled set and skip them. Count how many pending
        # entries belong to this job by draining and re-inserting.
        cancelled = 0
        remaining: list[_PriorityEntry] = []

        # Drain the queue to count and filter
        while not self._queue.empty():
            try:
                entry = self._queue.get_nowait()
                if entry.task.job_id == job_id:
                    entry.task.status = TaskStatus.FAILED
                    entry.task.error = "Cancelled"
                    entry.task.completed_at = datetime.utcnow()
                    cancelled += 1
                    self._pending_count -= 1
                    # Notify callback so job service can track
                    if self._on_task_complete:
                        try:
                            self._on_task_complete(entry.task)
                        except Exception:
                            logger.exception("on_task_complete callback error")
                else:
                    remaining.append(entry)
            except asyncio.QueueEmpty:
                break

        # Re-insert non-cancelled entries
        for entry in remaining:
            self._queue.put_nowait(entry)

        logger.info(
            "Cancelled %d queued tasks for job %s", cancelled, job_id
        )
        return cancelled

    async def start_workers(self) -> None:
        """Start the worker pool. Each worker loops pulling tasks from the queue."""
        if self._workers:
            logger.warning("Workers already started — skipping")
            return

        for i in range(self._max_concurrency):
            worker = asyncio.create_task(
                self._worker_loop(i), name=f"task-queue-worker-{i}"
            )
            self._workers.append(worker)

        logger.info("Started %d task queue workers", self._max_concurrency)

    async def drain(self, timeout: float = 30.0) -> None:
        """Stop accepting new tasks and wait for in-progress tasks to finish.

        Parameters
        ----------
        timeout:
            Maximum seconds to wait for workers to finish.
        """
        self._draining = True
        logger.info("Draining task queue (timeout=%.1fs)…", timeout)

        # Signal all workers to stop by putting sentinel entries
        for _ in self._workers:
            # Use a sentinel with very high priority so real tasks finish first
            self._queue.put_nowait(_Sentinel())

        # Wait for workers to finish within timeout
        if self._workers:
            done, pending = await asyncio.wait(
                self._workers, timeout=timeout
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        self._workers.clear()
        logger.info("Task queue drained")

    def get_stats(self) -> dict:
        """Return current queue statistics.

        Returns
        -------
        dict with keys:
            queue_depth, active_workers, completed_count, avg_duration_ms
        """
        avg_ms = (
            self._total_duration_ms / self._completed_count
            if self._completed_count > 0
            else 0.0
        )
        return {
            "queue_depth": self._pending_count,
            "active_workers": self._active_workers,
            "completed_count": self._completed_count,
            "avg_duration_ms": round(avg_ms, 2),
        }

    # ------------------------------------------------------------------
    # Worker loop
    # ------------------------------------------------------------------

    async def _worker_loop(self, worker_id: int) -> None:
        """Worker coroutine — pulls tasks from the queue and executes them."""
        logger.debug("Worker %d started", worker_id)

        while True:
            try:
                entry = await self._queue.get()
            except asyncio.CancelledError:
                break

            # Check for sentinel (drain signal)
            if isinstance(entry, _Sentinel):
                break

            self._pending_count -= 1
            task = entry.task

            # Skip cancelled job tasks
            if task.job_id and task.job_id in self._cancelled_jobs:
                if task.status != TaskStatus.FAILED:
                    task.status = TaskStatus.FAILED
                    task.error = "Cancelled"
                    task.completed_at = datetime.utcnow()
                    if self._on_task_complete:
                        try:
                            self._on_task_complete(task)
                        except Exception:
                            logger.exception("on_task_complete callback error")
                continue

            # Execute the task with timeout
            self._active_workers += 1
            start_time = time.monotonic()

            try:
                task = await asyncio.wait_for(
                    self._executor.execute(task),
                    timeout=self._task_timeout,
                )
            except asyncio.TimeoutError:
                task.status = TaskStatus.FAILED
                task.error = f"Task timed out after {self._task_timeout}s"
                task.completed_at = datetime.utcnow()
                logger.error(
                    "Worker %d: task %s timed out", worker_id, task.id
                )
            except asyncio.CancelledError:
                # Worker is being shut down — mark task failed
                task.status = TaskStatus.FAILED
                task.error = "Worker cancelled during drain"
                task.completed_at = datetime.utcnow()
                self._active_workers -= 1
                if self._on_task_complete:
                    try:
                        self._on_task_complete(task)
                    except Exception:
                        logger.exception("on_task_complete callback error")
                raise
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error = str(exc)
                task.completed_at = datetime.utcnow()
                logger.error(
                    "Worker %d: task %s unexpected error: %s",
                    worker_id,
                    task.id,
                    exc,
                )

            elapsed_ms = (time.monotonic() - start_time) * 1000
            self._active_workers -= 1
            self._completed_count += 1
            self._total_duration_ms += elapsed_ms

            # Invoke callback
            if self._on_task_complete:
                try:
                    self._on_task_complete(task)
                except Exception:
                    logger.exception(
                        "on_task_complete callback error for task %s", task.id
                    )

        logger.debug("Worker %d stopped", worker_id)


class _Sentinel:
    """Sentinel value placed in the queue to signal workers to stop.

    Compares as greater than any ``_PriorityEntry`` so real tasks are
    processed first during drain.
    """

    def __lt__(self, other: object) -> bool:
        # Sentinel is never higher priority than a real entry
        return False

    def __gt__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return isinstance(other, _Sentinel)

    def __ge__(self, other: object) -> bool:
        return True
