"""Batch job endpoints.

- POST /api/v1/scrape/batch — submit batch scrape job (max 100 targets)
- GET  /api/v1/scrape/jobs/{job_id} — get job status and progress
- GET  /api/v1/scrape/jobs/{job_id}/results — get completed task results
- POST /api/v1/scrape/jobs/{job_id}/cancel — cancel queued tasks in job
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from src.models.requests import BatchScrapeRequest
from src.models.responses import ApiResponse
from src.validators.url_validator import validate_url

logger = logging.getLogger(__name__)


def create_jobs_router(*, job_service: Any = None) -> APIRouter:
    """Factory that creates the jobs router with injected dependencies."""

    jobs_router = APIRouter(prefix="/api/v1/scrape", tags=["jobs"])

    @jobs_router.post("/batch")
    async def create_batch(body: BatchScrapeRequest) -> dict:
        """Submit a batch scrape job. Returns 202 with job_id."""
        invalid_urls = []
        for target in body.targets:
            if not await validate_url(target.target_url):
                invalid_urls.append(target.target_url)
        if invalid_urls:
            raise HTTPException(
                status_code=400,
                detail="Invalid target URLs: only http/https schemes to public IPs are allowed",
            )

        job = await job_service.create_job(
            targets=body.targets,
            callback_url=body.callback_url,
        )

        return ApiResponse(
            success=True,
            data={
                "job_id": job.id,
                "total_tasks": job.total_tasks,
                "status": job.status.value,
            },
        ).model_dump()

    @jobs_router.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> dict:
        """Get job status and progress."""
        job = job_service.get_job(job_id)

        return ApiResponse(
            success=True,
            data={
                "job_id": job.id,
                "status": job.status.value,
                "total_tasks": job.total_tasks,
                "completed_tasks": job.completed_tasks,
                "failed_tasks": job.failed_tasks,
                "created_at": job.created_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
            },
        ).model_dump()

    @jobs_router.get("/jobs/{job_id}/results")
    async def get_job_results(job_id: str) -> dict:
        """Get completed task results for a job."""
        results = job_service.get_job_results(job_id)

        return ApiResponse(
            success=True,
            data={"results": results, "count": len(results)},
        ).model_dump()

    @jobs_router.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict:
        """Cancel queued tasks in a job. Running tasks are allowed to complete."""
        job = await job_service.cancel_job(job_id)

        return ApiResponse(
            success=True,
            data={
                "job_id": job.id,
                "status": job.status.value,
                "completed_tasks": job.completed_tasks,
                "failed_tasks": job.failed_tasks,
            },
        ).model_dump()

    return jobs_router
