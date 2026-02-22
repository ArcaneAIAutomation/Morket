"""Property tests for request ID uniqueness.

Validates that every response carries a unique UUID4 in the X-Request-ID header.
"""

from __future__ import annotations

import uuid

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from src.middleware.request_id import RequestIdMiddleware


# ---------------------------------------------------------------------------
# Minimal test app with RequestIdMiddleware
# ---------------------------------------------------------------------------

def _create_test_app() -> FastAPI:
    app = FastAPI()

    @app.get("/ping")
    async def ping() -> JSONResponse:
        return JSONResponse(status_code=200, content={"ok": True})

    app.add_middleware(RequestIdMiddleware)
    return app


_app = _create_test_app()
_client = TestClient(_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Property 3: Request ID uniqueness
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(n=st.integers(min_value=2, max_value=20))
def test_request_ids_are_unique_uuids(n: int) -> None:
    # Feature: scraping-microservices, Property 3: Request ID uniqueness
    # **Validates: Requirements 1.7**
    collected_ids: list[str] = []

    for _ in range(n):
        resp = _client.get("/ping")
        rid = resp.headers.get("X-Request-ID")
        assert rid is not None, "X-Request-ID header must be present"

        # Must be a valid UUID4
        parsed = uuid.UUID(rid, version=4)
        assert str(parsed) == rid

        collected_ids.append(rid)

    # All IDs must be unique
    assert len(set(collected_ids)) == len(collected_ids), "Request IDs must be unique"
