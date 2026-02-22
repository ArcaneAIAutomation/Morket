"""Global error hierarchy and FastAPI exception handlers.

All scraper-specific errors extend ScraperError. The FastAPI exception handlers
catch these errors (plus Pydantic's RequestValidationError and unhandled exceptions)
and return a consistent JSON envelope: { success, data, error, meta }.
"""

from __future__ import annotations

import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class ScraperError(Exception):
    """Base error for all scraper-specific errors."""

    status_code: int = 500
    message: str = "Internal server error"

    def __init__(self, message: str | None = None, **kwargs: object) -> None:
        self.message = message or self.__class__.message
        self.details = kwargs
        super().__init__(self.message)


class ValidationError(ScraperError):
    """Pydantic / payload validation failures — includes field-level details."""

    status_code = 422
    message = "Validation error"


class AuthenticationError(ScraperError):
    """Invalid or missing service key."""

    status_code = 401
    message = "Invalid or missing service key"


class PoolExhaustedError(ScraperError):
    """Browser pool exhausted — no instances available."""

    status_code = 503
    message = "Browser pool exhausted — no instances available"


class QueueFullError(ScraperError):
    """Task queue is full."""

    status_code = 503
    message = "Task queue is full"


class CircuitOpenError(ScraperError):
    """Circuit breaker open for target domain."""

    status_code = 503
    message = "Circuit breaker open for target domain"


class NoHealthyProxiesError(ScraperError):
    """No healthy proxies available."""

    status_code = 503
    message = "No healthy proxies available"


class CredentialNotFoundError(ScraperError):
    """Missing credentials for provider."""

    status_code = 502
    message = "Missing credentials for provider"


class TaskNotFoundError(ScraperError):
    """Task not found."""

    status_code = 404
    message = "Task not found"


class JobNotFoundError(ScraperError):
    """Job not found."""

    status_code = 404
    message = "Job not found"


class TaskTimeoutError(ScraperError):
    """Task execution timed out."""

    status_code = 504
    message = "Task execution timed out"


# ---------------------------------------------------------------------------
# FastAPI exception handlers
# ---------------------------------------------------------------------------


def _envelope(
    status_code: int,
    error: str,
    meta: dict | None = None,
) -> JSONResponse:
    """Build a JSON envelope error response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": error,
            "meta": meta,
        },
    )


async def _scraper_error_handler(_request: Request, exc: ScraperError) -> JSONResponse:
    """Handle ScraperError subclasses."""
    meta = exc.details if exc.details else None
    return _envelope(exc.status_code, exc.message, meta=meta)


async def _validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handle FastAPI / Pydantic RequestValidationError (422)."""
    field_errors = [
        {
            "field": " -> ".join(str(loc) for loc in err["loc"]),
            "message": err["msg"],
            "type": err["type"],
        }
        for err in exc.errors()
    ]
    return _envelope(
        status_code=422,
        error="Validation error",
        meta={"fields": field_errors},
    )


async def _unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions — log traceback, return generic 500."""
    logger.error(
        "Unhandled exception: %s\n%s",
        exc,
        traceback.format_exc(),
    )
    return _envelope(status_code=500, error="Internal server error")


# ---------------------------------------------------------------------------
# Registration helper
# ---------------------------------------------------------------------------


def register_error_handlers(app: FastAPI) -> None:
    """Wire up all exception handlers on the FastAPI application."""
    app.add_exception_handler(ScraperError, _scraper_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_error_handler)  # type: ignore[arg-type]
