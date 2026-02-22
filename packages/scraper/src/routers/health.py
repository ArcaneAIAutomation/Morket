"""Health, readiness, and metrics endpoints.

These endpoints do NOT require X-Service-Key authentication.
- GET /health — service status + pool stats
- GET /readiness — 200 only when browser pool and proxy manager are ready
- GET /metrics — operational metrics
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Response

from src.models.responses import ApiResponse

if TYPE_CHECKING:
    from src.browser.pool import BrowserPool
    from src.proxy.manager import ProxyManager
    from src.services.task_queue import TaskQueue

router = APIRouter(tags=["health"])


def create_health_router(
    *,
    browser_pool: Any = None,
    proxy_manager: Any = None,
    task_queue: Any = None,
) -> APIRouter:
    """Factory that creates the health router with injected dependencies."""

    health_router = APIRouter(tags=["health"])

    @health_router.get("/health")
    async def health() -> dict:
        """Service health check with pool statistics."""
        pool_stats = browser_pool.get_stats() if browser_pool else {}
        proxy_stats = proxy_manager.get_stats() if proxy_manager else {}

        return ApiResponse(
            success=True,
            data={
                "status": "healthy",
                "browser_pool": pool_stats,
                "proxy_pool": proxy_stats,
            },
        ).model_dump()

    @health_router.get("/readiness")
    async def readiness(response: Response) -> dict:
        """Readiness probe — 200 iff browser available > 0 AND healthy proxy > 0."""
        pool_stats = browser_pool.get_stats() if browser_pool else {"available": 0}
        proxy_stats = proxy_manager.get_stats() if proxy_manager else {"healthy": 0}

        browser_available = pool_stats.get("available", 0)
        proxy_healthy = proxy_stats.get("healthy", 0)

        is_ready = browser_available > 0 and proxy_healthy > 0

        if not is_ready:
            response.status_code = 503

        return ApiResponse(
            success=is_ready,
            data={
                "ready": is_ready,
                "browser_available": browser_available,
                "proxy_healthy": proxy_healthy,
            },
            error=None if is_ready else "Service not ready",
        ).model_dump()

    @health_router.get("/metrics")
    async def metrics() -> dict:
        """Operational metrics endpoint."""
        pool_stats = browser_pool.get_stats() if browser_pool else {}
        proxy_stats = proxy_manager.get_stats() if proxy_manager else {}
        queue_stats = task_queue.get_stats() if task_queue else {}

        return ApiResponse(
            success=True,
            data={
                "browser_pool": pool_stats,
                "proxy_pool": proxy_stats,
                "task_queue": queue_stats,
            },
        ).model_dump()

    return health_router
