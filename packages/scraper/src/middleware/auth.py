"""X-Service-Key authentication middleware.

Validates the X-Service-Key header against the configured service key from
ScraperSettings. Health endpoints (/health, /readiness, /metrics) are excluded
from authentication.

Uses ``hmac.compare_digest`` for constant-time comparison to prevent timing
attacks on the service key.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from src.middleware.error_handler import AuthenticationError, _envelope

logger = logging.getLogger(__name__)

# Paths that do NOT require authentication.
_PUBLIC_PATHS: set[str] = {"/health", "/readiness", "/metrics"}


class ServiceKeyAuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that enforces X-Service-Key authentication.

    Requests to public health endpoints are allowed through without a key.
    All other requests must carry a valid ``X-Service-Key`` header matching
    the configured ``service_key``.

    Uses constant-time comparison (``hmac.compare_digest``) to prevent
    timing-based side-channel attacks.
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
        source_ip = request.client.host if request.client else "unknown"
        requested_path = request.url.path

        if not provided_key:
            logger.warning(
                "Missing X-Service-Key header",
                extra={
                    "event": "auth_failure",
                    "reason": "missing_service_key",
                    "source_ip": source_ip,
                    "path": requested_path,
                },
            )
            return _envelope(
                status_code=AuthenticationError.status_code,
                error=AuthenticationError.message,
            )

        if not hmac.compare_digest(provided_key, self._service_key):
            logger.warning(
                "Invalid X-Service-Key",
                extra={
                    "event": "auth_failure",
                    "reason": "invalid_service_key",
                    "source_ip": source_ip,
                    "path": requested_path,
                },
            )
            return _envelope(
                status_code=AuthenticationError.status_code,
                error=AuthenticationError.message,
            )

        return await call_next(request)
