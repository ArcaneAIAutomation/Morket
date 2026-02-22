"""Task executor — orchestrates single scrape task execution.

Coordinates the full lifecycle of a single scrape task through the pipeline:
rate limit acquire → circuit breaker check → browser acquire → fingerprint
apply → proxy select → page navigate → extractor execute → normalize result →
release browser → record success/failure on circuit breaker.

Handles credential retrieval for authenticated targets, enforces navigation
timeout (30s) and overall task timeout (60s), and introduces randomized
inter-action delays per domain policy.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from urllib.parse import urlparse

from src.browser.fingerprint import FingerprintRandomizer
from src.browser.pool import BrowserInstance, BrowserPool
from src.config.domain_policies import DomainPolicy, load_domain_policies
from src.config.settings import ScraperSettings
from src.extractors.registry import ExtractorRegistry
from src.middleware.error_handler import (
    CircuitOpenError,
    NoHealthyProxiesError,
    PoolExhaustedError,
    TaskTimeoutError,
)
from src.models.normalizer import ResultNormalizer
from src.models.requests import ScrapeTaskState, TaskStatus
from src.proxy.manager import ProxyManager
from src.resilience.circuit_breaker import DomainCircuitBreaker
from src.resilience.rate_limiter import DomainRateLimiter

logger = logging.getLogger(__name__)

# Avoid circular import — CredentialClient is optional
try:
    from src.integration.credential_client import CredentialClient
except ImportError:  # pragma: no cover
    CredentialClient = None  # type: ignore[assignment,misc]


def _extract_domain(url: str) -> str:
    """Extract the domain (netloc) from a URL."""
    parsed = urlparse(url)
    return parsed.netloc or parsed.path.split("/")[0]


class TaskExecutor:
    """Orchestrates the execution of a single scrape task.

    Dependencies are injected via the constructor so the executor is
    testable without real browsers or network calls.
    """

    def __init__(
        self,
        *,
        browser_pool: BrowserPool,
        fingerprint_randomizer: FingerprintRandomizer,
        proxy_manager: ProxyManager,
        rate_limiter: DomainRateLimiter,
        circuit_breaker: DomainCircuitBreaker,
        extractor_registry: ExtractorRegistry,
        normalizer: ResultNormalizer,
        settings: ScraperSettings,
        credential_client: "CredentialClient | None" = None,
    ) -> None:
        self._browser_pool = browser_pool
        self._fingerprint = fingerprint_randomizer
        self._proxy_manager = proxy_manager
        self._rate_limiter = rate_limiter
        self._circuit_breaker = circuit_breaker
        self._extractor_registry = extractor_registry
        self._normalizer = normalizer
        self._settings = settings
        self._credential_client = credential_client

        # Load domain policies for per-domain delay configuration
        self._domain_policies: dict[str, DomainPolicy] = load_domain_policies(
            settings.domain_policies_path
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def execute(self, task: ScrapeTaskState) -> ScrapeTaskState:
        """Execute a single scrape task through the full pipeline.

        Returns the mutated *task* with updated status, result/error,
        and timestamps.
        """
        domain = _extract_domain(task.target_url)
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.utcnow()

        instance: BrowserInstance | None = None
        page = None

        try:
            # Wrap the entire execution in a task-level timeout
            task = await asyncio.wait_for(
                self._execute_inner(task, domain),
                timeout=self._settings.task_timeout_seconds,
            )
        except asyncio.TimeoutError:
            task.status = TaskStatus.FAILED
            task.error = f"Task execution timed out after {self._settings.task_timeout_seconds}s"
            task.completed_at = datetime.utcnow()
            self._circuit_breaker.record_failure(domain)
            logger.error(
                "Task %s timed out for %s (domain=%s)",
                task.id,
                task.target_url,
                domain,
            )
        except Exception as exc:
            # Catch-all for unexpected errors not handled inside _execute_inner
            if task.status != TaskStatus.FAILED:
                task.status = TaskStatus.FAILED
                task.error = str(exc)
                task.completed_at = datetime.utcnow()
            logger.error(
                "Task %s unexpected error: %s (domain=%s)",
                task.id,
                exc,
                domain,
            )

        return task

    # ------------------------------------------------------------------
    # Internal pipeline
    # ------------------------------------------------------------------

    async def _execute_inner(
        self, task: ScrapeTaskState, domain: str
    ) -> ScrapeTaskState:
        """Core execution pipeline — called within the task timeout wrapper."""
        instance: BrowserInstance | None = None
        page = None
        proxy = None

        try:
            # 1. Rate limit — blocks until token available
            await self._rate_limiter.acquire(domain)

            # 2. Circuit breaker check
            if not self._circuit_breaker.can_call(domain):
                raise CircuitOpenError(
                    f"Circuit breaker open for domain '{domain}'"
                )

            # 3. Acquire browser instance (10s timeout built into pool)
            instance = await self._browser_pool.acquire()

            # 4. Generate fingerprint profile
            proxy = self._proxy_manager.select(domain)
            profile = self._fingerprint.generate(proxy_region=proxy.region)

            # 5. Create new page with proxy
            page = await instance.new_page(proxy)

            # 6. Apply fingerprint to page
            await self._fingerprint.apply(page, profile)

            # 7. Retrieve credentials if needed
            credentials = await self._retrieve_credentials(task)

            # 8. Navigate to target URL with navigation timeout
            nav_timeout_ms = self._settings.navigation_timeout_ms
            await asyncio.wait_for(
                page.goto(task.target_url, wait_until="domcontentloaded"),
                timeout=nav_timeout_ms / 1000.0,
            )

            # 9. Introduce randomized inter-action delay per domain policy
            await self._apply_action_delay(domain)

            # 10. Extract data
            extractor = self._extractor_registry.get(task.target_type)
            raw_data = await extractor.extract(
                page, task.target_url, task.requested_fields
            )

            # 11. Normalize result
            normalized = self._normalizer.normalize(raw_data, task.target_type)

            # 12. Record success on circuit breaker
            self._circuit_breaker.record_success(domain)
            self._proxy_manager.mark_success(proxy)

            # 13. Update task state — completed
            task.status = TaskStatus.COMPLETED
            task.result = normalized.model_dump()
            task.completed_at = datetime.utcnow()

            duration_ms = (
                (task.completed_at - task.started_at).total_seconds() * 1000
                if task.started_at
                else 0
            )
            logger.info(
                "Task %s completed for %s (domain=%s, duration_ms=%.0f, fields=%d)",
                task.id,
                task.target_url,
                domain,
                duration_ms,
                len(raw_data),
            )

        except (CircuitOpenError, PoolExhaustedError, NoHealthyProxiesError) as exc:
            # Known infrastructure errors — record failure, don't record on CB
            # for pool/proxy errors since no request was made to the domain
            if isinstance(exc, CircuitOpenError):
                # Circuit was already open — no new failure to record
                pass
            task.status = TaskStatus.FAILED
            task.error = str(exc)
            task.completed_at = datetime.utcnow()
            logger.error(
                "Task %s failed (infra): %s (domain=%s)",
                task.id,
                exc,
                domain,
            )

        except asyncio.TimeoutError:
            # Navigation timeout
            self._circuit_breaker.record_failure(domain)
            if proxy:
                self._proxy_manager.mark_unhealthy(proxy)
            raise TaskTimeoutError(
                f"Navigation timed out after {self._settings.navigation_timeout_ms}ms"
            )

        except Exception as exc:
            # Extraction or other runtime error
            self._circuit_breaker.record_failure(domain)
            if proxy:
                self._proxy_manager.mark_unhealthy(proxy)
            task.status = TaskStatus.FAILED
            task.error = str(exc)
            task.completed_at = datetime.utcnow()
            logger.error(
                "Task %s failed: %s (domain=%s)",
                task.id,
                exc,
                domain,
            )

        finally:
            # Always close the page and release the browser instance
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if instance:
                try:
                    await self._browser_pool.release(instance)
                except Exception:
                    logger.warning(
                        "Failed to release browser instance for task %s",
                        task.id,
                    )

        return task

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _retrieve_credentials(
        self, task: ScrapeTaskState
    ) -> dict | None:
        """Retrieve credentials for authenticated targets if a credential client is available.

        Returns None when no credential client is configured or the target
        type does not require authentication.
        """
        if self._credential_client is None:
            return None

        # Determine provider from target type (e.g. linkedin_profile → linkedin)
        provider = task.target_type.value.split("_")[0]

        try:
            return await self._credential_client.get_credential(
                workspace_id=task.workspace_id,
                provider=provider,
            )
        except Exception as exc:
            logger.warning(
                "Credential retrieval failed for task %s (provider=%s): %s",
                task.id,
                provider,
                exc,
            )
            # Credentials are optional — proceed without them
            return None

    async def _apply_action_delay(self, domain: str) -> None:
        """Sleep for a randomized duration based on the domain's policy."""
        policy = self._domain_policies.get(
            domain, self._domain_policies.get("default")
        )
        if policy is None:
            return

        delay_ms = self._fingerprint.get_action_delay(
            min_delay_ms=policy.min_delay_ms,
            max_delay_ms=policy.max_delay_ms,
        )
        await asyncio.sleep(delay_ms / 1000.0)
