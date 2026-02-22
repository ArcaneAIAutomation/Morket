"""Property tests for service key authentication and Pydantic validation.

Property 4: Service key authentication — accept/reject based on key match.
Property 5: Pydantic validation produces 422 with field errors.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from src.middleware.auth import ServiceKeyAuthMiddleware
from src.middleware.error_handler import register_error_handlers
from src.middleware.request_id import RequestIdMiddleware
from src.models.requests import ScrapeRequest, TargetType


# ---------------------------------------------------------------------------
# Shared test app
# ---------------------------------------------------------------------------

_SERVICE_KEY = "test-service-key-abc123"


def _create_test_app() -> FastAPI:
    """FastAPI app with auth middleware, error handlers, and a validated endpoint."""
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/authed")
    async def authed_endpoint() -> JSONResponse:
        return JSONResponse(
            status_code=200,
            content={"success": True, "data": "ok", "error": None, "meta": None},
        )

    @app.post("/api/v1/scrape")
    async def scrape_endpoint(body: ScrapeRequest) -> JSONResponse:
        return JSONResponse(
            status_code=202,
            content={
                "success": True,
                "data": {"task_id": "fake-id", "status": "queued"},
                "error": None,
                "meta": None,
            },
        )

    # Middleware order matters — outermost first in add_middleware calls
    # (Starlette applies them in reverse order of add_middleware)
    app.add_middleware(ServiceKeyAuthMiddleware, service_key=_SERVICE_KEY)
    app.add_middleware(RequestIdMiddleware)
    return app


_app = _create_test_app()
_client = TestClient(_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Random non-empty strings for service keys
random_keys = st.text(min_size=1, max_size=200, alphabet=st.characters(codec="ascii", categories=("L", "N", "P")))


# ---------------------------------------------------------------------------
# Property 4: Service key authentication
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(key=random_keys)
def test_correct_key_is_accepted(key: str) -> None:
    # Feature: scraping-microservices, Property 4: Service key authentication
    # **Validates: Requirements 2.6, 2.7**
    # Use the actual service key — should always be accepted
    resp = _client.get("/authed", headers={"X-Service-Key": _SERVICE_KEY})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True


@settings(max_examples=100)
@given(wrong_key=random_keys)
def test_wrong_key_is_rejected(wrong_key: str) -> None:
    # Feature: scraping-microservices, Property 4: Service key authentication
    # **Validates: Requirements 2.6, 2.7**
    assume(wrong_key != _SERVICE_KEY)
    resp = _client.get("/authed", headers={"X-Service-Key": wrong_key})
    assert resp.status_code == 401
    body = resp.json()
    assert body["success"] is False
    assert body["error"] is not None


def test_missing_key_is_rejected() -> None:
    # Feature: scraping-microservices, Property 4: Service key authentication
    # **Validates: Requirements 2.6, 2.7**
    resp = _client.get("/authed")
    assert resp.status_code == 401
    body = resp.json()
    assert body["success"] is False
    assert body["error"] is not None


# ---------------------------------------------------------------------------
# Property 5: Pydantic validation produces 422 with field errors
# ---------------------------------------------------------------------------

# Strategy: generate payloads that are missing required fields or have wrong types
invalid_payloads = st.one_of(
    # Completely empty object
    st.just({}),
    # Missing target_type
    st.fixed_dictionaries({
        "target_url": st.just("https://example.com"),
        "workspace_id": st.just("ws-1"),
    }),
    # Missing target_url
    st.fixed_dictionaries({
        "target_type": st.just("linkedin_profile"),
        "workspace_id": st.just("ws-1"),
    }),
    # Missing workspace_id
    st.fixed_dictionaries({
        "target_type": st.just("linkedin_profile"),
        "target_url": st.just("https://example.com"),
    }),
    # Wrong type for target_type (integer instead of string)
    st.fixed_dictionaries({
        "target_type": st.integers(min_value=0, max_value=999),
        "target_url": st.just("https://example.com"),
        "workspace_id": st.just("ws-1"),
    }),
    # Invalid enum value for target_type
    st.fixed_dictionaries({
        "target_type": st.text(min_size=1, max_size=30).filter(
            lambda t: t not in ("linkedin_profile", "company_website", "job_posting")
        ),
        "target_url": st.just("https://example.com"),
        "workspace_id": st.just("ws-1"),
    }),
)


@settings(max_examples=100)
@given(payload=invalid_payloads)
def test_invalid_payload_returns_422_with_field_errors(payload: dict) -> None:
    # Feature: scraping-microservices, Property 5: Pydantic validation produces 422 with field errors
    # **Validates: Requirements 2.4, 2.5**
    resp = _client.post(
        "/api/v1/scrape",
        json=payload,
        headers={"X-Service-Key": _SERVICE_KEY},
    )
    assert resp.status_code == 422

    body = resp.json()
    # Envelope structure
    assert "success" in body
    assert "data" in body
    assert "error" in body
    assert "meta" in body

    assert body["success"] is False
    assert body["error"] is not None

    # Field-level errors in meta
    assert body["meta"] is not None
    assert "fields" in body["meta"]
    assert isinstance(body["meta"]["fields"], list)
    assert len(body["meta"]["fields"]) > 0

    # Each field error has field, message, type
    for field_err in body["meta"]["fields"]:
        assert "field" in field_err
        assert "message" in field_err
        assert "type" in field_err
