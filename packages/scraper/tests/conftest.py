"""Shared test fixtures and hypothesis strategies for the scraper test suite."""

from __future__ import annotations

import os

import pytest
from hypothesis import strategies as st

from src.config.settings import ScraperSettings
from src.models.requests import TargetType
from src.resilience.circuit_breaker import DomainCircuitBreaker
from src.resilience.rate_limiter import DomainRateLimiter
from src.proxy.manager import ProxyManager


# ---------------------------------------------------------------------------
# Ensure required env vars are set for ScraperSettings in tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _set_test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set minimal env vars so ScraperSettings can be instantiated in tests."""
    defaults = {
        "SCRAPER_SERVICE_KEY": "test-key",
        "SCRAPER_BACKEND_API_URL": "http://localhost:3000/api/v1",
        "SCRAPER_BACKEND_SERVICE_KEY": "test-backend-key",
        "SCRAPER_WEBHOOK_SECRET": "test-webhook-secret",
    }
    for key, value in defaults.items():
        if key not in os.environ:
            monkeypatch.setenv(key, value)


# ---------------------------------------------------------------------------
# Settings fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def settings() -> ScraperSettings:
    """Test settings with safe defaults."""
    return ScraperSettings(
        service_key="test-key",
        backend_api_url="http://localhost:3000/api/v1",
        backend_service_key="test-backend-key",
        webhook_secret="test-webhook-secret",
        browser_pool_size=2,
        browser_pool_max=5,
        max_queue_depth=10,
        proxy_endpoints=["http://proxy1:8080", "http://proxy2:8080"],
    )


# ---------------------------------------------------------------------------
# Component fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def circuit_breaker(settings: ScraperSettings) -> DomainCircuitBreaker:
    return DomainCircuitBreaker(
        window_size=settings.cb_window_size,
        failure_threshold=settings.cb_failure_threshold,
        cooldown_seconds=settings.cb_cooldown_seconds,
    )


@pytest.fixture
def rate_limiter(settings: ScraperSettings) -> DomainRateLimiter:
    return DomainRateLimiter(
        default_tokens=settings.rate_limit_tokens,
        default_interval=settings.rate_limit_interval_seconds,
    )


@pytest.fixture
def proxy_manager(settings: ScraperSettings) -> ProxyManager:
    return ProxyManager(
        domain_cooldown_seconds=settings.proxy_domain_cooldown_seconds,
        health_check_interval_seconds=settings.proxy_health_check_interval_seconds,
    )


# ---------------------------------------------------------------------------
# Hypothesis strategies (reusable across property tests)
# ---------------------------------------------------------------------------

# Target types
target_types = st.sampled_from(list(TargetType))

# Valid scrape request-like data
target_urls = st.from_regex(
    r"https://[a-z]{3,10}\.[a-z]{2,4}/[a-z0-9]{1,10}", fullmatch=True
)
workspace_ids = st.uuids().map(str)

# Raw extraction data (with optional HTML noise)
html_text = st.text(min_size=0, max_size=200).map(lambda t: f"<p>{t}</p>")
raw_extractions = st.dictionaries(
    keys=st.sampled_from(["name", "headline", "company", "location", "description"]),
    values=html_text,
    min_size=1,
    max_size=5,
)

# Circuit breaker call sequences
call_results = st.lists(st.booleans(), min_size=1, max_size=20)

# Job task outcome combinations
task_outcomes = st.lists(
    st.sampled_from(["completed", "failed"]),
    min_size=1,
    max_size=100,
)
