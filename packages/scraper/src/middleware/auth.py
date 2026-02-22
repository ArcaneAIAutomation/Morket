"""X-Service-Key authentication middleware.

Validates the X-Service-Key header against the configured service key from
ScraperSettings. Health endpoints (/health, /readiness, /metrics) are excluded
from authentication.
"""

from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from src.middleware.error_handler import AuthenticationError, _envelope

# Paths that do NOT require authentication.
_PUBLIC_PATHS: set[str] = {"/health", "/readiness", "/metrics"}


class ServiceKeyAuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that enforces X-Service-Key authentication.

    Requests to public health endpoints are allowed through without a key.
    All other requests must carry a valid ``X-Service-Key`` header matching
    the configured ``service_key``.
    """

    def __init__(self, app, service_key: str) -> None:  # noqa: ANN001
        super().__init__(app)
        self._service_key = service_key

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Allow health/readiness/metrics through without auth.
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        provided_key = request.headers.get("x-service-key")

        if not provided_key or provided_key != self._service_key:
            return _envelope(
                status_code=AuthenticationError.status_code,
                error=AuthenticationError.message,
            )

        return await call_next(request)
