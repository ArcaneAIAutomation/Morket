"""Property tests for JSON envelope consistency.

Validates that all API responses conform to the { success, data, error, meta }
envelope schema, with correct success/error semantics based on HTTP status code.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from src.middleware.error_handler import (
    AuthenticationError,
    CircuitOpenError,
    CredentialNotFoundError,
    JobNotFoundError,
    NoHealthyProxiesError,
    PoolExhaustedError,
    QueueFullError,
    ScraperError,
    TaskNotFoundError,
    TaskTimeoutError,
    ValidationError,
    register_error_handlers,
)


# ---------------------------------------------------------------------------
# Minimal test app
# ---------------------------------------------------------------------------

def _create_test_app() -> FastAPI:
    """Create a minimal FastAPI app with error handlers registered."""
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/ok")
    async def ok_endpoint() -> JSONResponse:
        return JSONResponse(
            status_code=200,
            content={"success": True, "data": {"msg": "ok"}, "error": None, "meta": None},
        )

    @app.get("/raise-scraper-error")
    async def raise_scraper_error(status_code: int = 500, message: str = "boom") -> None:
        err = ScraperError(message)
        err.status_code = status_code
        raise err

    @app.get("/raise-unhandled")
    async def raise_unhandled() -> None:
        raise RuntimeError("unexpected failure")

    # Endpoints that raise each specific ScraperError subclass
    _error_classes: list[type[ScraperError]] = [
        ValidationError,
        AuthenticationError,
        PoolExhaustedError,
        QueueFullError,
        CircuitOpenError,
        NoHealthyProxiesError,
        CredentialNotFoundError,
        TaskNotFoundError,
        JobNotFoundError,
        TaskTimeoutError,
    ]

    for cls in _error_classes:
        slug = cls.__name__

        # Use default-arg trick to capture cls in the closure
        def _make_handler(error_cls: type[ScraperError]):  # noqa: ANN001
            async def handler(request: Request) -> None:
                raise error_cls()
            return handler

        app.add_api_route(f"/raise/{slug}", _make_handler(cls), methods=["GET"])

    return app


_app = _create_test_app()
_client = TestClient(_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

scraper_error_slugs = st.sampled_from([
    "ValidationError",
    "AuthenticationError",
    "PoolExhaustedError",
    "QueueFullError",
    "CircuitOpenError",
    "NoHealthyProxiesError",
    "CredentialNotFoundError",
    "TaskNotFoundError",
    "JobNotFoundError",
    "TaskTimeoutError",
])


# ---------------------------------------------------------------------------
# Property 1: JSON envelope consistency
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(slug=scraper_error_slugs)
def test_error_responses_have_envelope_with_success_false(slug: str) -> None:
    # Feature: scraping-microservices, Property 1: JSON envelope consistency
    # **Validates: Requirements 1.3, 1.4**
    resp = _client.get(f"/raise/{slug}")
    body = resp.json()

    # Envelope keys must be present
    assert "success" in body
    assert "data" in body
    assert "error" in body
    assert "meta" in body

    # Error responses: success is False, error is non-null
    assert resp.status_code >= 400
    assert body["success"] is False
    assert body["error"] is not None


def test_success_response_has_envelope_with_success_true() -> None:
    # Feature: scraping-microservices, Property 1: JSON envelope consistency
    # **Validates: Requirements 1.3, 1.4**
    resp = _client.get("/ok")
    body = resp.json()

    assert "success" in body
    assert "data" in body
    assert "error" in body
    assert "meta" in body

    assert resp.status_code == 200
    assert body["success"] is True
    assert body["error"] is None


def test_unhandled_exception_returns_500_envelope() -> None:
    # Feature: scraping-microservices, Property 1: JSON envelope consistency
    # **Validates: Requirements 1.3, 1.4**
    resp = _client.get("/raise-unhandled")
    body = resp.json()

    assert "success" in body
    assert "data" in body
    assert "error" in body
    assert "meta" in body

    assert resp.status_code == 500
    assert body["success"] is False
    assert body["error"] is not None
    # Generic message — no internal details leaked
    assert body["error"] == "Internal server error"
