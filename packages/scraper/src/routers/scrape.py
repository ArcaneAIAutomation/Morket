"""Scrape task endpoints.

- POST /api/v1/scrape — submit async scrape task
- POST /api/v1/scrape/sync — submit sync scrape task (blocks until result)
- GET  /api/v1/scrape/{task_id} — get task status and result
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request

from src.middleware.error_handler import TaskNotFoundError
from src.models.requests import (
    ScrapeRequest,
    ScrapeTaskState,
    SyncScrapeRequest,
    TaskStatus,
)
from src.models.responses import ApiResponse

logger = logging.getLogger(__name__)


def create_scrape_router(
    *,
    task_queue: Any = None,
    task_executor: Any = None,
    task_store: dict[str, ScrapeTaskState] | None = None,
) -> APIRouter:
    """Factory that creates the scrape router with injected dependencies.

    Parameters
    ----------
    task_queue:
        TaskQueue instance for async task submission.
    task_executor:
        TaskExecutor instance for sync task execution.
    task_store:
        Shared dict mapping task_id -> ScrapeTaskState for status lookups.
    """
    scrape_router = APIRouter(prefix="/api/v1/scrape", tags=["scrape"])
    _store = task_store if task_store is not None else {}

    @scrape_router.post("")
    async def create_task(body: ScrapeRequest, request: Request) -> dict:
        """Submit an async scrape task. Returns 202 with task_id and status 'queued'."""
        task = ScrapeTaskState(
            id=str(uuid4()),
            job_id=None,
            target_type=body.target_type,
            target_url=body.target_url,
            requested_fields=body.requested_fields,
            workspace_id=body.workspace_id,
            status=TaskStatus.QUEUED,
        )
        _store[task.id] = task

        if task_queue:
            await task_queue.enqueue(task, job_size=0)

        return ApiResponse(
            success=True,
            data={"task_id": task.id, "status": task.status.value},
        ).model_dump()

    @scrape_router.post("/sync")
    async def create_sync_task(body: SyncScrapeRequest, request: Request) -> dict:
        """Submit a sync scrape task. Blocks until result or timeout."""
        task = ScrapeTaskState(
            id=str(uuid4()),
            job_id=None,
            target_type=body.target_type,
            target_url=body.target_url,
            requested_fields=body.requested_fields,
            workspace_id=body.workspace_id,
            status=TaskStatus.QUEUED,
        )
        _store[task.id] = task

        if task_executor:
            try:
                task = await asyncio.wait_for(
                    task_executor.execute(task),
                    timeout=body.timeout_seconds,
                )
            except asyncio.TimeoutError:
                task.status = TaskStatus.FAILED
                task.error = f"Sync task timed out after {body.timeout_seconds}s"

        _store[task.id] = task

        return ApiResponse(
            success=task.status == TaskStatus.COMPLETED,
            data={
                "task_id": task.id,
                "status": task.status.value,
                "result": task.result,
                "error": task.error,
            },
        ).model_dump()

    @scrape_router.get("/{task_id}")
    async def get_task(task_id: str) -> dict:
        """Get task status and result (result only if completed)."""
        task = _store.get(task_id)
        if task is None:
            raise TaskNotFoundError(f"Task '{task_id}' not found")

        data: dict = {
            "task_id": task.id,
            "status": task.status.value,
            "target_type": task.target_type.value,
            "target_url": task.target_url,
            "created_at": task.created_at.isoformat(),
        }

        if task.status == TaskStatus.COMPLETED:
            data["result"] = task.result
        if task.status == TaskStatus.FAILED:
            data["error"] = task.error

        return ApiResponse(
            success=True,
            data=data,
        ).model_dump()

    return scrape_router
