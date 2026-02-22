"""Unit tests for the error hierarchy and FastAPI exception handlers."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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
# Test app fixture
# ---------------------------------------------------------------------------


def _make_app() -> FastAPI:
    """Build a minimal FastAPI app with error handlers registered."""
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/raise-scraper")
    async def _raise_scraper():
        raise ScraperError()

    @app.get("/raise-auth")
    async def _raise_auth():
        raise AuthenticationError()

    @app.get("/raise-pool")
    async def _raise_pool():
        raise PoolExhaustedError()

    @app.get("/raise-queue")
    async def _raise_queue():
        raise QueueFullError()

    @app.get("/raise-circuit")
    async def _raise_circuit():
        raise CircuitOpenError()

    @app.get("/raise-proxy")
    async def _raise_proxy():
        raise NoHealthyProxiesError()

    @app.get("/raise-cred")
    async def _raise_cred():
        raise CredentialNotFoundError()

    @app.get("/raise-task-not-found")
    async def _raise_task_nf():
        raise TaskNotFoundError()

    @app.get("/raise-job-not-found")
    async def _raise_job_nf():
        raise JobNotFoundError()

    @app.get("/raise-timeout")
    async def _raise_timeout():
        raise TaskTimeoutError()

    @app.get("/raise-validation")
    async def _raise_validation():
        raise ValidationError("Bad field", fields=["name"])

    @app.get("/raise-custom-message")
    async def _raise_custom():
        raise TaskNotFoundError("Task abc-123 not found")

    @app.get("/raise-unhandled")
    async def _raise_unhandled():
        raise RuntimeError("something unexpected")

    from pydantic import BaseModel

    class Payload(BaseModel):
        name: str
        age: int

    @app.post("/validate")
    async def _validate(payload: Payload):
        return {"ok": True}

    return app


@pytest.fixture()
def client():
    return TestClient(_make_app(), raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Error hierarchy tests
# ---------------------------------------------------------------------------


class TestErrorHierarchy:
    """All custom errors are subclasses of ScraperError."""

    def test_all_subclass_scraper_error(self):
        subclasses = [
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
        for cls in subclasses:
            assert issubclass(cls, ScraperError)

    def test_default_messages(self):
        assert ScraperError().message == "Internal server error"
        assert AuthenticationError().message == "Invalid or missing service key"
        assert PoolExhaustedError().message == "Browser pool exhausted — no instances available"
        assert QueueFullError().message == "Task queue is full"
        assert CircuitOpenError().message == "Circuit breaker open for target domain"
        assert NoHealthyProxiesError().message == "No healthy proxies available"
        assert CredentialNotFoundError().message == "Missing credentials for provider"
        assert TaskNotFoundError().message == "Task not found"
        assert JobNotFoundError().message == "Job not found"
        assert TaskTimeoutError().message == "Task execution timed out"
        assert ValidationError().message == "Validation error"

    def test_custom_message_override(self):
        err = TaskNotFoundError("Task abc-123 not found")
        assert err.message == "Task abc-123 not found"
        assert str(err) == "Task abc-123 not found"

    def test_details_kwargs(self):
        err = ValidationError("Bad input", fields=["name", "age"])
        assert err.details == {"fields": ["name", "age"]}


# ---------------------------------------------------------------------------
# Exception handler tests
# ---------------------------------------------------------------------------


class TestExceptionHandlers:
    """FastAPI exception handlers return correct envelope and status codes."""

    @pytest.mark.parametrize(
        "path,expected_status,expected_error",
        [
            ("/raise-scraper", 500, "Internal server error"),
            ("/raise-auth", 401, "Invalid or missing service key"),
            ("/raise-pool", 503, "Browser pool exhausted — no instances available"),
            ("/raise-queue", 503, "Task queue is full"),
            ("/raise-circuit", 503, "Circuit breaker open for target domain"),
            ("/raise-proxy", 503, "No healthy proxies available"),
            ("/raise-cred", 502, "Missing credentials for provider"),
            ("/raise-task-not-found", 404, "Task not found"),
            ("/raise-job-not-found", 404, "Job not found"),
            ("/raise-timeout", 504, "Task execution timed out"),
        ],
    )
    def test_scraper_error_envelope(self, client, path, expected_status, expected_error):
        resp = client.get(path)
        assert resp.status_code == expected_status
        body = resp.json()
        assert body["success"] is False
        assert body["data"] is None
        assert body["error"] == expected_error

    def test_custom_message_in_response(self, client):
        resp = client.get("/raise-custom-message")
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"] == "Task abc-123 not found"

    def test_validation_error_with_details(self, client):
        resp = client.get("/raise-validation")
        assert resp.status_code == 422
        body = resp.json()
        assert body["success"] is False
        assert body["error"] == "Bad field"
        assert body["meta"] == {"fields": ["name"]}

    def test_pydantic_request_validation_error(self, client):
        resp = client.post("/validate", json={"name": 123})
        assert resp.status_code == 422
        body = resp.json()
        assert body["success"] is False
        assert body["error"] == "Validation error"
        assert "fields" in body["meta"]
        assert len(body["meta"]["fields"]) > 0

    def test_unhandled_exception_returns_500(self, client):
        resp = client.get("/raise-unhandled")
        assert resp.status_code == 500
        body = resp.json()
        assert body["success"] is False
        assert body["error"] == "Internal server error"
        assert body["data"] is None
