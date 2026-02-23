"""FastAPI application entry point with lifespan management.

Startup: validate settings, initialize browser pool, proxy manager, domain
policies, extractor registry, task queue workers.
Shutdown: graceful drain — stop accepting requests, drain task queue, close
browser pool, cancel background tasks.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.browser.fingerprint import FingerprintRandomizer
from src.browser.pool import BrowserPool
from src.config.domain_policies import load_domain_policies
from src.config.settings import ScraperSettings
from src.extractors.company_website import CompanyWebsiteExtractor
from src.extractors.job_posting import JobPostingExtractor
from src.extractors.linkedin_profile import LinkedInProfileExtractor
from src.extractors.registry import ExtractorRegistry
from src.integration.credential_client import CredentialClient
from src.integration.webhook import WebhookCallback
from src.middleware.auth import ServiceKeyAuthMiddleware
from src.middleware.error_handler import register_error_handlers
from src.middleware.request_id import RequestIdMiddleware
from src.models.normalizer import ResultNormalizer
from src.proxy.manager import ProxyManager
from src.resilience.circuit_breaker import DomainCircuitBreaker
from src.resilience.rate_limiter import DomainRateLimiter
from src.routers.health import create_health_router
from src.routers.jobs import create_jobs_router
from src.routers.scrape import create_scrape_router
from src.services.job_service import JobService
from src.services.task_executor import TaskExecutor
from src.services.task_queue import TaskQueue

logger = logging.getLogger(__name__)

# Shared state for the application — populated during lifespan startup
_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown logic."""
    settings = ScraperSettings()  # type: ignore[call-arg]

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger.info("Starting scraper service on port %d", settings.port)

    # Initialize components
    browser_pool = BrowserPool()
    await browser_pool.initialize(
        settings.browser_pool_size, page_limit=settings.browser_page_limit
    )

    proxy_manager = ProxyManager(
        domain_cooldown_seconds=settings.proxy_domain_cooldown_seconds,
        health_check_interval_seconds=settings.proxy_health_check_interval_seconds,
    )
    await proxy_manager.initialize(settings.proxy_endpoints)

    # Start proxy health check loop
    health_check_task = asyncio.create_task(proxy_manager.health_check_loop())

    # Load domain policies (for reference / future use)
    load_domain_policies(settings.domain_policies_path)

    # Rate limiter with domain policies
    rate_limiter = DomainRateLimiter(
        default_tokens=settings.rate_limit_tokens,
        default_interval=settings.rate_limit_interval_seconds,
    )
    rate_limiter.load_policies(settings.domain_policies_path)

    # Circuit breaker
    circuit_breaker = DomainCircuitBreaker(
        window_size=settings.cb_window_size,
        failure_threshold=settings.cb_failure_threshold,
        cooldown_seconds=settings.cb_cooldown_seconds,
    )

    # Fingerprint randomizer
    fingerprint = FingerprintRandomizer()

    # Extractor registry
    registry = ExtractorRegistry()
    registry.register(LinkedInProfileExtractor())
    registry.register(CompanyWebsiteExtractor())
    registry.register(JobPostingExtractor())

    # Normalizer
    normalizer = ResultNormalizer()

    # Credential client
    credential_client = CredentialClient(
        backend_api_url=settings.backend_api_url,
        service_key=settings.backend_service_key,
        cache_ttl_seconds=settings.credential_cache_ttl_seconds,
        max_retries=settings.credential_max_retries,
    )

    # Webhook callback
    webhook = WebhookCallback(
        webhook_secret=settings.webhook_secret,
        default_url=settings.default_webhook_url,
    )

    # Task executor
    task_executor = TaskExecutor(
        browser_pool=browser_pool,
        proxy_manager=proxy_manager,
        fingerprint_randomizer=fingerprint,
        extractor_registry=registry,
        normalizer=normalizer,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        credential_client=credential_client,
        settings=settings,
    )

    # Task store (shared between scrape router and task queue)
    task_store: dict = {}

    # Task queue
    task_queue = TaskQueue(
        task_executor=task_executor,
        max_concurrency=settings.browser_pool_size,
        max_queue_depth=settings.max_queue_depth,
        task_timeout_seconds=settings.task_timeout_seconds,
    )

    # Job service
    job_service = JobService(
        task_queue=task_queue,
        webhook_callback=webhook,
        settings=settings,
    )

    # Wire on_task_complete callback
    task_queue._on_task_complete = job_service.update_task_result

    # Start workers
    await task_queue.start_workers()

    # Mount routers
    app.include_router(
        create_health_router(
            browser_pool=browser_pool,
            proxy_manager=proxy_manager,
            task_queue=task_queue,
        )
    )
    app.include_router(
        create_scrape_router(
            task_queue=task_queue,
            task_executor=task_executor,
            task_store=task_store,
        )
    )
    app.include_router(create_jobs_router(job_service=job_service))

    # Store state for potential access
    _state.update({
        "settings": settings,
        "browser_pool": browser_pool,
        "proxy_manager": proxy_manager,
        "task_queue": task_queue,
        "job_service": job_service,
    })

    logger.info("Scraper service started successfully")

    yield

    # --- Shutdown ---
    logger.info("Shutting down scraper service…")

    # Drain task queue
    await task_queue.drain(timeout=settings.graceful_shutdown_seconds)

    # Close browser pool
    await browser_pool.shutdown()

    # Cancel background tasks
    health_check_task.cancel()
    try:
        await health_check_task
    except asyncio.CancelledError:
        pass

    logger.info("Scraper service shut down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Loads ``ScraperSettings`` eagerly so that a missing ``SCRAPER_SERVICE_KEY``
    environment variable causes an immediate startup failure rather than
    silently falling back to a placeholder value.
    """
    settings = ScraperSettings()  # type: ignore[call-arg]

    app = FastAPI(
        title="Morket Scraper Service",
        version="1.0.0",
        lifespan=lifespan,
    )

    # Register error handlers
    register_error_handlers(app)

    # Middleware (order: request_id → auth → error_handler)
    # Note: Starlette middleware is applied in reverse order of add_middleware calls
    app.add_middleware(ServiceKeyAuthMiddleware, service_key=settings.service_key)
    app.add_middleware(RequestIdMiddleware)

    return app



app = create_app()
