"""Property tests for readiness endpoint.

# Feature: scraping-microservices, Property 2: Readiness reflects pool state
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st

from src.routers.health import create_health_router


def _make_app(browser_available: int, proxy_healthy: int) -> FastAPI:
    """Create a minimal FastAPI app with mocked pool/proxy stats."""
    pool = MagicMock()
    pool.get_stats.return_value = {
        "total": max(browser_available, 1),
        "available": browser_available,
        "in_use": 0,
        "pages_processed": 0,
        "recycled_count": 0,
    }

    proxy = MagicMock()
    proxy.get_stats.return_value = {
        "total": max(proxy_healthy, 1),
        "healthy": proxy_healthy,
        "unhealthy": 0,
    }

    app = FastAPI()
    app.include_router(
        create_health_router(browser_pool=pool, proxy_manager=proxy)
    )
    return app


@settings(max_examples=100)
@given(
    browser_available=st.integers(min_value=0, max_value=20),
    proxy_healthy=st.integers(min_value=0, max_value=10),
)
def test_readiness_reflects_pool_state(
    browser_available: int,
    proxy_healthy: int,
) -> None:
    """Property 2: Readiness reflects pool state.

    For any combination of browser pool available count (0..N) and healthy
    proxy count (0..M), the /readiness endpoint SHALL return 200 if and only
    if both available count > 0 and healthy proxy count > 0.
    """
    # Feature: scraping-microservices, Property 2: Readiness reflects pool state

    app = _make_app(browser_available, proxy_healthy)
    client = TestClient(app)

    response = client.get("/readiness")
    expected_ready = browser_available > 0 and proxy_healthy > 0

    if expected_ready:
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert response.json()["data"]["ready"] is True
    else:
        assert response.status_code == 503
        assert response.json()["success"] is False
        assert response.json()["data"]["ready"] is False
