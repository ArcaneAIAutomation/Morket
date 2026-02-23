"""Property tests for scrape endpoints.

# Feature: scraping-microservices, Property 6: Async task creation returns queued status
# Feature: scraping-microservices, Property 7: Task status retrieval reflects current state
"""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st

from src.middleware.auth import ServiceKeyAuthMiddleware
from src.middleware.error_handler import register_error_handlers
from src.models.requests import ScrapeTaskState, TargetType, TaskStatus
from src.routers.scrape import create_scrape_router


# --- Strategies ---

target_types = st.sampled_from(["linkedin_profile", "company_website", "job_posting"])
target_urls = st.from_regex(r"https://[a-z]{3,10}\.[a-z]{2,4}/[a-z0-9]{1,10}", fullmatch=True)
workspace_ids = st.uuids().map(str)

SERVICE_KEY = "test-service-key"


def _make_app(task_store: dict | None = None) -> tuple[FastAPI, dict]:
    """Create a minimal FastAPI app with the scrape router and auth middleware."""
    store = task_store if task_store is not None else {}

    mock_queue = AsyncMock()
    mock_queue.enqueue = AsyncMock()

    app = FastAPI()
    register_error_handlers(app)

    # Auth middleware
    app.add_middleware(ServiceKeyAuthMiddleware, service_key=SERVICE_KEY)

    app.include_router(
        create_scrape_router(
            task_queue=mock_queue,
            task_executor=None,
            task_store=store,
        )
    )
    return app, store


# --- Property 6: Async task creation returns queued status ---

@settings(max_examples=100)
@given(
    target_type=target_types,
    target_url=target_urls,
    workspace_id=workspace_ids,
)
def test_async_task_creation_returns_queued(
    target_type: str,
    target_url: str,
    workspace_id: str,
) -> None:
    """Property 6: Async task creation returns queued status.

    For any valid POST /api/v1/scrape request, the response SHALL contain
    a task ID (valid UUID) and status "queued".
    """
    # Feature: scraping-microservices, Property 6: Async task creation returns queued status

    with patch("src.routers.scrape.validate_url", new_callable=AsyncMock, return_value=True):
        app, store = _make_app()
        client = TestClient(app)

        response = client.post(
            "/api/v1/scrape",
            json={
                "target_type": target_type,
                "target_url": target_url,
                "workspace_id": workspace_id,
            },
            headers={"X-Service-Key": SERVICE_KEY},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True

    data = body["data"]
    assert data["status"] == "queued"

    # task_id must be a valid UUID
    task_id = data["task_id"]
    uuid.UUID(task_id)  # Raises ValueError if invalid

    # Task should be in the store
    assert task_id in store


# --- Property 7: Task status retrieval reflects current state ---

@settings(max_examples=100)
@given(
    status=st.sampled_from(list(TaskStatus)),
    target_type=st.sampled_from(list(TargetType)),
    has_result=st.booleans(),
)
def test_task_status_retrieval_reflects_state(
    status: TaskStatus,
    target_type: TargetType,
    has_result: bool,
) -> None:
    """Property 7: Task status retrieval reflects current state.

    For any task in any state (queued, running, completed, failed),
    GET /api/v1/scrape/:taskId SHALL return the task's current status,
    and SHALL include result data if and only if the task status is "completed".
    """
    # Feature: scraping-microservices, Property 7: Task status retrieval reflects current state

    task_id = str(uuid.uuid4())
    task = ScrapeTaskState(
        id=task_id,
        job_id=None,
        target_type=target_type,
        target_url="https://example.com/page",
        requested_fields=None,
        workspace_id=str(uuid.uuid4()),
        status=status,
        result={"name": "Test"} if (status == TaskStatus.COMPLETED and has_result) else None,
        error="Something failed" if status == TaskStatus.FAILED else None,
    )

    store = {task_id: task}
    app, _ = _make_app(task_store=store)
    client = TestClient(app)

    response = client.get(
        f"/api/v1/scrape/{task_id}",
        headers={"X-Service-Key": SERVICE_KEY},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True

    data = body["data"]
    assert data["status"] == status.value
    assert data["task_id"] == task_id

    # Result only present when completed
    if status == TaskStatus.COMPLETED:
        assert "result" in data
    else:
        assert "result" not in data

    # Error only present when failed
    if status == TaskStatus.FAILED:
        assert "error" in data
        assert data["error"] is not None
    else:
        assert data.get("error") is None or "error" not in data
