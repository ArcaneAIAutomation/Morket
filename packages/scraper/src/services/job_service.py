"""Batch job lifecycle management.

The JobService manages the lifecycle of scrape jobs — creating jobs from
batch requests, tracking task completion, computing final job status, and
triggering webhook callbacks when jobs reach terminal states.

All state is held in-memory. The backend (Module 2) is the system of record;
on service restart, in-flight jobs are lost and the backend's Temporal
workflows handle retries.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from uuid import uuid4

from src.config.settings import ScraperSettings
from src.middleware.error_handler import JobNotFoundError
from src.models.requests import (
    JobStatus,
    ScrapeJobState,
    ScrapeRequest,
    ScrapeTaskState,
    TaskStatus,
)
from src.services.task_queue import TaskQueue

logger = logging.getLogger(__name__)

# Threshold for including full results in webhook payload
_WEBHOOK_FULL_RESULTS_LIMIT = 100


class JobService:
    """Manages batch scrape job lifecycle.

    Parameters
    ----------
    task_queue:
        The asyncio task queue used to enqueue individual scrape tasks.
    settings:
        Scraper configuration (used for default webhook URL, etc.).
    webhook_callback:
        Optional webhook delivery component. May be ``None`` if not yet
        wired up (task 12.3).
    """

    def __init__(
        self,
        *,
        task_queue: TaskQueue,
        settings: ScraperSettings,
        webhook_callback: object | None = None,
    ) -> None:
        self._task_queue = task_queue
        self._settings = settings
        self._webhook_callback = webhook_callback

        # In-memory stores
        self._jobs: dict[str, ScrapeJobState] = {}
        self._tasks: dict[str, ScrapeTaskState] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def create_job(
        self,
        targets: list[ScrapeRequest],
        callback_url: str | None = None,
    ) -> ScrapeJobState:
        """Create a batch job with one task per target and enqueue all tasks.

        Parameters
        ----------
        targets:
            List of scrape requests (max 100).
        callback_url:
            Optional webhook callback URL override. Falls back to the
            default configured URL if not provided.

        Returns
        -------
        ScrapeJobState with status QUEUED and all task IDs populated.
        """
        job_id = str(uuid4())
        now = datetime.utcnow()
        job_size = len(targets)

        # Create a ScrapeTaskState for each target
        task_states: list[ScrapeTaskState] = []
        task_ids: list[str] = []

        for target in targets:
            task_id = str(uuid4())
            task = ScrapeTaskState(
                id=task_id,
                job_id=job_id,
                target_type=target.target_type,
                target_url=target.target_url,
                requested_fields=target.requested_fields,
                workspace_id=target.workspace_id,
                status=TaskStatus.QUEUED,
                created_at=now,
                priority=job_size,
            )
            task_states.append(task)
            task_ids.append(task_id)
            self._tasks[task_id] = task

        # Resolve callback URL: request override > default setting
        resolved_callback = callback_url or self._settings.default_webhook_url

        # Create the job
        job = ScrapeJobState(
            id=job_id,
            task_ids=task_ids,
            status=JobStatus.QUEUED,
            total_tasks=job_size,
            completed_tasks=0,
            failed_tasks=0,
            callback_url=resolved_callback,
            created_at=now,
            updated_at=now,
        )
        self._jobs[job_id] = job

        # Enqueue all tasks via the task queue
        await self._task_queue.enqueue_batch(task_states, job_size=job_size)

        logger.info(
            "Created job %s with %d tasks (callback=%s)",
            job_id,
            job_size,
            resolved_callback,
        )
        return job

    def update_task_result(self, task: ScrapeTaskState) -> None:
        """Update task status and increment job counters.

        Called by the task queue's ``on_task_complete`` callback when a
        task finishes (completed or failed).
        """
        # Update our local task reference
        if task.id in self._tasks:
            self._tasks[task.id] = task

        job_id = task.job_id
        if job_id is None or job_id not in self._jobs:
            return

        job = self._jobs[job_id]

        # Update job status to RUNNING on first task completion
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.RUNNING

        # Increment counters based on task outcome
        if task.status == TaskStatus.COMPLETED:
            job.completed_tasks += 1
        elif task.status == TaskStatus.FAILED:
            job.failed_tasks += 1

        job.updated_at = datetime.utcnow()

        # Check if all tasks are done
        done_count = job.completed_tasks + job.failed_tasks
        if done_count >= job.total_tasks:
            job.status = self.compute_final_status(job)
            logger.info(
                "Job %s reached terminal state: %s "
                "(completed=%d, failed=%d, total=%d)",
                job_id,
                job.status.value,
                job.completed_tasks,
                job.failed_tasks,
                job.total_tasks,
            )
            self._trigger_webhook(job)

    def compute_final_status(self, job: ScrapeJobState) -> JobStatus:
        """Derive job status from task outcomes.

        - All tasks completed successfully → COMPLETED
        - All tasks failed → FAILED
        - Mix of completed and failed → PARTIALLY_COMPLETED
        """
        if job.failed_tasks == 0:
            return JobStatus.COMPLETED
        if job.completed_tasks == 0:
            return JobStatus.FAILED
        return JobStatus.PARTIALLY_COMPLETED

    async def cancel_job(self, job_id: str) -> ScrapeJobState:
        """Cancel queued tasks in a job, allow running tasks to complete.

        Parameters
        ----------
        job_id:
            The job to cancel.

        Returns
        -------
        Updated ScrapeJobState with status CANCELLED.

        Raises
        ------
        JobNotFoundError
            If the job ID is not found.
        """
        if job_id not in self._jobs:
            raise JobNotFoundError(f"Job not found: {job_id}")

        job = self._jobs[job_id]

        # Cancel queued tasks via the task queue
        await self._task_queue.cancel_job_tasks(job_id)

        job.status = JobStatus.CANCELLED
        job.updated_at = datetime.utcnow()

        logger.info("Cancelled job %s", job_id)
        self._trigger_webhook(job)
        return job

    def get_job(self, job_id: str) -> ScrapeJobState:
        """Return job status and progress.

        Raises
        ------
        JobNotFoundError
            If the job ID is not found.
        """
        if job_id not in self._jobs:
            raise JobNotFoundError(f"Job not found: {job_id}")
        return self._jobs[job_id]

    def get_job_results(self, job_id: str) -> list[dict]:
        """Return results for completed tasks in a job.

        Only tasks with status COMPLETED and a non-None result are included.

        Raises
        ------
        JobNotFoundError
            If the job ID is not found.
        """
        if job_id not in self._jobs:
            raise JobNotFoundError(f"Job not found: {job_id}")

        job = self._jobs[job_id]
        results: list[dict] = []

        for task_id in job.task_ids:
            task = self._tasks.get(task_id)
            if task and task.status == TaskStatus.COMPLETED and task.result is not None:
                results.append(
                    {
                        "task_id": task.id,
                        "target_type": task.target_type.value,
                        "target_url": task.target_url,
                        "result": task.result,
                    }
                )

        return results

    # ------------------------------------------------------------------
    # Webhook delivery
    # ------------------------------------------------------------------

    def _trigger_webhook(self, job: ScrapeJobState) -> None:
        """Fire-and-forget webhook delivery for a terminal job state.

        If no webhook_callback is configured or no callback_url is set,
        this is a no-op.
        """
        if self._webhook_callback is None:
            return
        if job.callback_url is None:
            return

        summary = {
            "total": job.total_tasks,
            "completed": job.completed_tasks,
            "failed": job.failed_tasks,
        }

        # Include full results for small jobs, summary only for large ones
        results: list[dict] | None = None
        if job.total_tasks <= _WEBHOOK_FULL_RESULTS_LIMIT:
            results = self.get_job_results(job.id)

        # Schedule delivery as a background task so we don't block
        # the on_task_complete callback
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                self._deliver_webhook(
                    url=job.callback_url,
                    job_id=job.id,
                    status=job.status.value,
                    results=results,
                    summary=summary,
                )
            )
        except RuntimeError:
            # No running event loop (e.g. in sync tests) — log and skip
            logger.warning(
                "No event loop available for webhook delivery (job %s)",
                job.id,
            )

    async def _deliver_webhook(
        self,
        url: str,
        job_id: str,
        status: str,
        results: list[dict] | None,
        summary: dict,
    ) -> None:
        """Deliver webhook callback, logging errors without raising."""
        try:
            await self._webhook_callback.deliver(  # type: ignore[union-attr]
                url=url,
                job_id=job_id,
                status=status,
                results=results,
                summary=summary,
            )
            logger.info("Webhook delivered for job %s to %s", job_id, url)
        except Exception:
            logger.exception(
                "Failed to deliver webhook for job %s to %s", job_id, url
            )
