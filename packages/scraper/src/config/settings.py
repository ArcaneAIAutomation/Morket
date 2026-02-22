"""Pydantic Settings for the scraper service.

All environment variables use the SCRAPER_ prefix.
Example: SCRAPER_PORT=8001, SCRAPER_SERVICE_KEY=my-secret-key
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings


class ScraperSettings(BaseSettings):
    """Scraper service configuration validated from environment variables."""

    # Service
    port: int = 8001
    service_key: str  # X-Service-Key for auth
    log_level: str = "INFO"

    # Backend integration
    backend_api_url: str  # e.g. "https://api.morket.io/api/v1"
    backend_service_key: str  # Key for calling backend API
    webhook_secret: str  # HMAC-SHA256 signing key
    default_webhook_url: str | None = None  # Default callback URL

    # Browser pool
    browser_pool_size: int = Field(default=5, ge=1, le=20)
    browser_pool_max: int = Field(default=20, ge=1)
    browser_page_limit: int = Field(default=100, ge=1)  # Recycle after N pages
    navigation_timeout_ms: int = Field(default=30000, ge=1000)

    # Task queue
    max_queue_depth: int = Field(default=500, ge=1)
    task_timeout_seconds: int = Field(default=60, ge=5)

    # Rate limiting defaults
    rate_limit_tokens: int = Field(default=2, ge=1)
    rate_limit_interval_seconds: int = Field(default=10, ge=1)

    # Circuit breaker
    cb_window_size: int = Field(default=10, ge=1)
    cb_failure_threshold: int = Field(default=5, ge=1)
    cb_cooldown_seconds: int = Field(default=120, ge=1)

    # Proxy
    proxy_endpoints: list[str] = []  # Loaded from env or config
    proxy_health_check_interval_seconds: int = Field(default=60, ge=1)
    proxy_domain_cooldown_seconds: int = Field(default=30, ge=0)

    # Credential client
    credential_cache_ttl_seconds: int = Field(default=300, ge=0)  # 5 minutes
    credential_max_retries: int = Field(default=3, ge=0)

    # Docker / resource management
    graceful_shutdown_seconds: int = Field(default=30, ge=0)

    # Domain policies
    domain_policies_path: str = "src/config/domain_policies.yaml"

    model_config = {"env_prefix": "SCRAPER_"}
