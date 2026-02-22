"""Request ID middleware.

Generates (or propagates) a UUID request ID for every incoming request,
stores it in ``request.state.request_id``, and adds an ``X-Request-ID``
response header.
"""

from __future__ import annotations

import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that assigns a unique request ID to each request.

    If the incoming request already carries an ``X-Request-ID`` header the
    provided value is reused; otherwise a new UUID4 is generated.

    The ID is stored in ``request.state.request_id`` and returned in the
    ``X-Request-ID`` response header.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Reuse caller-provided ID or generate a fresh one.
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
