# Implementation Plan: Module 3 — Scraping Microservices

## Overview

Build the `packages/scraper/` Python/FastAPI scraping microservice from scratch. The implementation proceeds bottom-up: project scaffolding → core models and config → resilience components → browser pool → extractors → services → routers → integration → Docker. Each task builds on previous ones, with property tests placed close to the components they validate.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Create project structure and pyproject.toml
    - Create `packages/scraper/` directory with `src/`, `tests/unit/`, `tests/property/`, `tests/integration/` directories
    - Create `pyproject.toml` with dependencies: fastapi, uvicorn, playwright, pydantic, pydantic-settings, httpx, pyyaml, pytest, pytest-asyncio, hypothesis, black, ruff
    - Create `src/__init__.py`, `tests/__init__.py`, and all sub-package `__init__.py` files
    - _Requirements: 1.1_

  - [x] 1.2 Implement Pydantic Settings and domain policies
    - Create `src/config/settings.py` with `ScraperSettings(BaseSettings)` class — all env vars with `SCRAPER_` prefix, defaults per design
    - Create `src/config/domain_policies.yaml` with default, linkedin.com, and indeed.com policies
    - Create a `load_domain_policies(yaml_path)` function that parses the YAML into typed policy objects
    - _Requirements: 1.2, 8.3_

  - [x] 1.3 Implement Pydantic request and response models
    - Create `src/models/responses.py` with generic `ApiResponse[T]` envelope model
    - Create `src/models/requests.py` with `TargetType` enum, `ScrapeRequest`, `BatchScrapeRequest`, `SyncScrapeRequest`, `ScrapeTaskState`, `ScrapeJobState`, `TaskStatus`, `JobStatus` models
    - _Requirements: 1.3, 2.1, 2.4, 3.1_

  - [x] 1.4 Implement target-type output schemas
    - Create `src/models/schemas.py` with `NormalizedLocation`, `LinkedInProfileResult`, `CompanyWebsiteResult`, `JobPostingResult` Pydantic models
    - All fields optional (nullable) per design
    - _Requirements: 5.2, 5.3, 5.4, 11.1_

  - [x] 1.5 Implement error hierarchy
    - Create `src/middleware/error_handler.py` with `ScraperError` base class and subclasses: `ValidationError`, `AuthenticationError`, `PoolExhaustedError`, `QueueFullError`, `CircuitOpenError`, `NoHealthyProxiesError`, `CredentialNotFoundError`, `TaskNotFoundError`, `JobNotFoundError`, `TaskTimeoutError`
    - Implement FastAPI exception handler that catches `ScraperError` and unhandled exceptions, returning JSON envelope with appropriate status codes
    - _Requirements: 1.3, 1.4_

  - [x] 1.6 Implement middleware (auth and request ID)
    - Create `src/middleware/auth.py` with `X-Service-Key` validation middleware — returns 401 for missing/invalid keys
    - Create `src/middleware/request_id.py` with UUID request ID generation, injection into request state, and `X-Request-ID` response header
    - _Requirements: 1.7, 2.6, 2.7_

  - [x] 1.7 Write property tests for envelope, auth, and request ID
    - **Property 1: JSON envelope consistency** — verify envelope schema and success/error field correctness based on status code
    - **Validates: Requirements 1.3, 1.4**
    - **Property 3: Request ID uniqueness** — verify UUID format and uniqueness across requests
    - **Validates: Requirements 1.7**
    - **Property 4: Service key authentication** — verify accept/reject based on key match
    - **Validates: Requirements 2.6, 2.7**
    - **Property 5: Pydantic validation produces 422 with field errors** — verify 422 response with field-level errors for invalid payloads
    - **Validates: Requirements 2.4, 2.5**

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Resilience components
  - [x] 3.1 Implement circuit breaker
    - Create `src/resilience/circuit_breaker.py` with `CircuitState` enum and `DomainCircuitBreaker` class
    - Implement sliding window of recent 10 requests per domain using `deque`
    - Implement state transitions: closed → open (5 failures in window), open → half-open (after 120s), half-open → closed (probe success) or open (probe failure)
    - Implement `can_call()`, `record_success()`, `record_failure()`, `get_state()`, `get_all_states()`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 3.2 Write property tests for circuit breaker
    - **Property 27: Circuit breaker state transition on failures** — verify closed→open transition when failures exceed threshold in sliding window
    - **Validates: Requirements 9.1, 9.2**
    - **Property 28: Open circuit rejects immediately** — verify `can_call()` returns false when domain is open
    - **Validates: Requirements 9.3**
    - **Property 29: Half-open probe determines next state** — verify probe success→closed, probe failure→open
    - **Validates: Requirements 9.6, 9.7**

  - [x] 3.3 Implement token bucket rate limiter
    - Create `src/resilience/rate_limiter.py` with `TokenBucket` dataclass and `DomainRateLimiter` class
    - Implement per-domain token bucket with configurable tokens/interval
    - Implement async `acquire()` that blocks via `asyncio.Event` until token available
    - Implement `reduce_rate()` for adaptive backoff on 429 responses (50% reduction for configurable duration)
    - Implement `load_policies()` to load per-domain overrides from YAML
    - Separate rate limit state per domain
    - _Requirements: 8.1, 8.2, 8.6, 8.7_

  - [x] 3.4 Write property tests for rate limiter
    - **Property 22: Token bucket rate limiting per domain** — verify token grant rate respects configured limits and domain isolation
    - **Validates: Requirements 8.1, 8.7**
    - **Property 26: Adaptive rate reduction on 429** — verify 50% rate reduction and restoration after backoff period
    - **Validates: Requirements 8.6**

  - [x] 3.5 Implement domain policy enforcement (allowed hours, robots.txt)
    - Extend rate limiter or create helper in `src/resilience/rate_limiter.py` for allowed scraping hours check
    - Implement robots.txt fetching, caching, and URL permission checking
    - _Requirements: 8.4, 8.5_

  - [x] 3.6 Write property tests for domain policies
    - **Property 23: Domain policy YAML parsing round trip** — verify load→serialize produces equivalent config
    - **Validates: Requirements 8.3**
    - **Property 24: Allowed scraping hours enforcement** — verify task eligibility based on current time and allowed window
    - **Validates: Requirements 8.4**
    - **Property 25: Robots.txt compliance** — verify URL allow/disallow based on robots.txt rules
    - **Validates: Requirements 8.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Proxy management
  - [x] 5.1 Implement proxy manager
    - Create `src/proxy/types.py` with `ProxyEndpoint` dataclass
    - Create `src/proxy/manager.py` with `ProxyManager` class
    - Implement round-robin selection skipping unhealthy proxies
    - Implement per-domain cooldown tracking (default 30s) — skip proxies used for same domain within cooldown
    - Implement `mark_unhealthy()`, `mark_success()` with success/failure counters
    - Implement async `health_check_loop()` background task (every 60s) to restore healthy proxies
    - Implement `get_stats()` for health endpoint metrics
    - Reject tasks with `NoHealthyProxiesError` when all proxies unhealthy
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 5.2 Write property tests for proxy manager
    - **Property 18: Proxy round-robin skips unhealthy** — verify selection only from healthy proxies in round-robin order
    - **Validates: Requirements 7.2**
    - **Property 19: Failed proxy marked unhealthy** — verify unhealthy marking and exclusion from selection
    - **Validates: Requirements 7.3**
    - **Property 20: Proxy per-domain cooldown** — verify proxy not reused for same domain within cooldown
    - **Validates: Requirements 7.7**
    - **Property 21: Proxy metrics accuracy** — verify success/failure counts match recorded events
    - **Validates: Requirements 7.6**

- [x] 6. Browser pool and fingerprinting
  - [x] 6.1 Implement fingerprint randomizer
    - Create `src/browser/fingerprint.py` with `FingerprintProfile` dataclass, curated user agent list, valid timezones/languages
    - Implement `FingerprintRandomizer` with `generate()` (randomized profile within valid ranges, geo-consistent with proxy region) and `apply()` (set viewport, user agent, timezone, language, inject JS overrides to mask `navigator.webdriver` and `chrome.runtime`)
    - Implement inter-action delay generation within configurable range (default 500ms–2000ms)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.2 Write property tests for fingerprint randomizer
    - **Property 14: Fingerprint attributes within valid ranges** — verify user agent from curated list, viewport width in [1280,1920], height in [720,1080]
    - **Validates: Requirements 6.1, 6.2**
    - **Property 15: Fingerprint geo-consistency with proxy region** — verify timezone/language/geolocation consistent with proxy region
    - **Validates: Requirements 6.3**
    - **Property 16: Fingerprint rotation across sessions** — verify consecutive profiles differ in at least one attribute
    - **Validates: Requirements 6.6**
    - **Property 17: Action delays within configured range** — verify delay values within [min_delay_ms, max_delay_ms]
    - **Validates: Requirements 6.5**

  - [x] 6.3 Implement browser pool
    - Create `src/browser/pool.py` with `BrowserInstance` dataclass and `BrowserPool` class
    - Implement `initialize()` — launch configurable number of Chromium instances with `--no-sandbox --disable-dev-shm-usage --disable-gpu`
    - Implement `acquire()` — provide available instance within 10s timeout or raise `PoolExhaustedError`
    - Implement `release()` — clear cookies/storage, increment page counter, recycle if pages >= page_limit
    - Implement crash recovery via Playwright `disconnected` event — remove crashed instance, launch replacement
    - Implement `get_stats()` for health endpoint (total, available, in_use, pages_processed, recycled_count)
    - Implement `shutdown()` for graceful cleanup
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 6.4 Write property test for browser pool recycling
    - **Property 12: Browser instance recycling after page threshold** — verify instances are recycled when pages_processed >= page_limit
    - **Validates: Requirements 4.7**

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Page extractors and result normalization
  - [x] 8.1 Implement extractor base and registry
    - Create `src/extractors/base.py` with `BaseExtractor` ABC — `extract()`, `wait_for_content()`, `scroll_for_content()` methods
    - Create `src/extractors/registry.py` with `ExtractorRegistry` class — `register()`, `get()`, `list_types()` methods
    - _Requirements: 5.1_

  - [x] 8.2 Implement LinkedIn profile extractor
    - Create `src/extractors/linkedin_profile.py` extending `BaseExtractor`
    - Extract: name, headline, current_company, location, summary using CSS selectors
    - Use `wait_for_content()` for dynamic content, `scroll_for_content()` for lazy-loaded sections
    - Set missing fields to `null` rather than failing
    - _Requirements: 5.2, 5.5, 5.6, 5.7_

  - [x] 8.3 Implement company website extractor
    - Create `src/extractors/company_website.py` extending `BaseExtractor`
    - Extract: company_name, description, industry, employee_count_range, headquarters, contact_email, contact_phone
    - Set missing fields to `null` rather than failing
    - _Requirements: 5.3, 5.5, 5.6_

  - [x] 8.4 Implement job posting extractor
    - Create `src/extractors/job_posting.py` extending `BaseExtractor`
    - Extract: job_title, company_name, location, salary_range, description
    - Set missing fields to `null` rather than failing
    - _Requirements: 5.4, 5.5, 5.6_

  - [x] 8.5 Implement result normalizer
    - Create `src/models/normalizer.py` with `ResultNormalizer` class
    - Implement HTML tag stripping, whitespace normalization, and trimming for text fields
    - Implement URL normalization: ensure `https://` scheme, remove tracking parameters (utm_*, fbclid, gclid)
    - Implement location normalization: parse into `NormalizedLocation` with city/state_region/country/raw
    - Validate normalized output against target-type Pydantic schema; return partial result with valid fields only on validation failure
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 8.6 Write property tests for extractors and normalizer
    - **Property 13: Missing extraction fields default to null** — verify missing fields are null, not errors
    - **Validates: Requirements 5.5**
    - **Property 31: Result normalization produces valid schema** — verify output validates against Pydantic schema with HTML stripped and whitespace trimmed
    - **Validates: Requirements 11.1, 11.2, 11.4**
    - **Property 32: Partial result on validation failure** — verify partial result with valid fields only
    - **Validates: Requirements 11.3**
    - **Property 33: URL normalization** — verify https:// scheme and tracking parameter removal
    - **Validates: Requirements 11.5**
    - **Property 34: Location normalization structure** — verify NormalizedLocation with city/state_region/country/raw fields
    - **Validates: Requirements 11.6**
    - **Property 35: Result serialization round trip** — verify JSON serialize→deserialize produces equivalent model
    - **Validates: Requirements 11.7**

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Services layer (task queue, job service, task executor)
  - [x] 10.1 Implement task executor
    - Create `src/services/task_executor.py` with `TaskExecutor` class
    - Orchestrate single task execution: rate limit acquire → circuit breaker check → browser acquire → fingerprint apply → proxy select → extractor execute → normalize result → release browser → record success/failure on circuit breaker
    - Handle credential retrieval for authenticated targets
    - Enforce navigation timeout (30s) and task timeout (60s)
    - Introduce randomized inter-action delays per domain policy
    - _Requirements: 2.1, 4.5, 6.5, 8.2, 9.3_

  - [x] 10.2 Implement task queue
    - Create `src/services/task_queue.py` with `TaskQueue` class
    - Implement asyncio-based priority queue — tasks from smaller jobs prioritized, standalone tasks highest priority
    - Implement configurable max concurrency (default = browser pool size) with async workers
    - Implement max queue depth (default 500) — reject with `QueueFullError` when full
    - Implement task timeout via `asyncio.wait_for()` (default 60s) — cancel, release browser, mark failed
    - Implement `enqueue()`, `enqueue_batch()`, `cancel_job_tasks()`, `start_workers()`, `drain()`
    - Implement `get_stats()` — queue_depth, active_workers, avg_duration
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 10.3 Write property tests for task queue
    - **Property 36: Priority queue ordering by job size** — verify tasks from smaller jobs dequeued first
    - **Validates: Requirements 12.2**
    - **Property 37: Queue stats accuracy** — verify queue_depth and active_workers match actual state
    - **Validates: Requirements 12.6**

  - [x] 10.4 Implement job service
    - Create `src/services/job_service.py` with `JobService` class
    - Implement `create_job()` — create job with N tasks, enqueue all tasks
    - Implement `update_task_result()` — update task status, increment job counters
    - Implement `compute_final_status()` — derive job status from task outcomes (completed/partially_completed/failed)
    - Implement `cancel_job()` — cancel queued tasks, allow running tasks to complete, set status to cancelled
    - Implement `get_job()`, `get_job_results()` — return job status/progress and completed task results
    - Trigger webhook callback when job reaches terminal state
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 10.5 Write property tests for job service
    - **Property 8: Batch job creates correct task count** — verify N targets creates N tasks with valid job ID
    - **Validates: Requirements 3.1**
    - **Property 9: Job status derived from task outcomes** — verify completed/failed/partially_completed logic
    - **Validates: Requirements 3.4**
    - **Property 10: Job results contain only completed tasks** — verify results count matches completed_tasks counter
    - **Validates: Requirements 3.3**
    - **Property 11: Job cancellation preserves running tasks** — verify queued tasks cancelled, running tasks untouched
    - **Validates: Requirements 3.5**

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration components (credential client, webhook)
  - [x] 12.1 Implement credential client
    - Create `src/integration/credential_client.py` with `CredentialClient` class
    - Implement `get_credential()` — call backend `GET /api/v1/workspaces/:id/credentials/:provider` with `X-Service-Key` header
    - Implement in-memory cache keyed by `(workspace_id, provider)` with configurable TTL (default 5min)
    - Implement retry logic: 3 retries with exponential backoff (1s, 2s, 4s) on backend unreachable
    - Fail with `CredentialNotFoundError` on 404 from backend
    - HTTPS-only transport, never log or persist decrypted credential values
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 12.2 Write property test for credential client
    - **Property 30: Credential cache TTL behavior** — verify cached value returned within TTL, fresh fetch after TTL expiry
    - **Validates: Requirements 10.2, 10.3**

  - [x] 12.3 Implement webhook callback
    - Create `src/integration/webhook.py` with `WebhookCallback` class
    - Implement HMAC-SHA256 signature computation in `X-Webhook-Signature` header
    - Implement `deliver()` — POST to callback URL with job_id, status, summary, and results
    - Include full results array for jobs with ≤100 tasks, summary only for larger jobs
    - Implement retry logic: 3 retries with exponential backoff (2s, 4s, 8s), 10s timeout per attempt
    - Support callback_url override from scrape request
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 12.4 Write property tests for webhook
    - **Property 40: HMAC-SHA256 webhook signature correctness** — verify signature can be recomputed from secret + payload
    - **Validates: Requirements 15.2**
    - **Property 41: Webhook payload size by job task count** — verify full results for ≤100 tasks, summary only for >100
    - **Validates: Requirements 15.6**
    - **Property 42: Webhook callback URL override** — verify custom callback_url used when provided
    - **Validates: Requirements 15.5**
    - **Property 43: Terminal job state triggers webhook** — verify webhook delivered for all terminal states
    - **Validates: Requirements 15.1**

- [x] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. FastAPI routers and application wiring
  - [x] 14.1 Implement health router
    - Create `src/routers/health.py` with `GET /health`, `GET /readiness`, `GET /metrics` endpoints
    - `/health` — return service status, browser pool stats, proxy pool health (no auth required)
    - `/readiness` — return 200 only when browser pool has ≥1 available instance AND proxy manager has ≥1 healthy proxy
    - `/metrics` — return active browser instances, queue depth, tasks completed/failed, avg task duration, per-domain request counts
    - _Requirements: 1.5, 1.6, 14.4_

  - [x] 14.2 Write property test for readiness
    - **Property 2: Readiness reflects pool state** — verify 200 iff both browser available > 0 and healthy proxy > 0
    - **Validates: Requirements 1.6**

  - [x] 14.3 Implement scrape router
    - Create `src/routers/scrape.py` with `POST /api/v1/scrape`, `POST /api/v1/scrape/sync`, `GET /api/v1/scrape/:taskId` endpoints
    - `POST /scrape` — validate request, create task, enqueue, return 202 with task_id and status "queued"
    - `POST /scrape/sync` — validate request, execute task synchronously within configurable timeout (default 60s), return result
    - `GET /scrape/:taskId` — return task status and result data (result only if completed)
    - Apply X-Service-Key auth middleware to all endpoints
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 14.4 Write property tests for scrape endpoints
    - **Property 6: Async task creation returns queued status** — verify valid POST /scrape returns task_id UUID and status "queued"
    - **Validates: Requirements 2.1**
    - **Property 7: Task status retrieval reflects current state** — verify GET returns current status, result only when completed
    - **Validates: Requirements 2.3**

  - [x] 14.5 Implement jobs router
    - Create `src/routers/jobs.py` with `POST /api/v1/scrape/batch`, `GET /api/v1/scrape/jobs/:jobId`, `GET /api/v1/scrape/jobs/:jobId/results`, `POST /api/v1/scrape/jobs/:jobId/cancel` endpoints
    - `POST /batch` — validate batch (max 100 targets, return 400 if >100), create job, enqueue tasks, return 202 with job_id
    - `GET /jobs/:jobId` — return job status, progress (completed vs total), success/failure summary
    - `GET /jobs/:jobId/results` — return completed task results for job
    - `POST /jobs/:jobId/cancel` — cancel queued tasks, allow running to complete, set status cancelled
    - Apply X-Service-Key auth middleware to all endpoints
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 14.6 Implement FastAPI main application and lifespan
    - Create `src/main.py` with FastAPI app, lifespan context manager for startup/shutdown
    - Startup: validate settings, initialize browser pool, initialize proxy manager, start proxy health check loop, load domain policies, register extractors, start task queue workers
    - Shutdown: graceful drain — stop accepting requests, drain task queue (30s grace), close browser pool, cancel background tasks
    - Wire middleware: request_id → auth → error_handler
    - Mount routers: health, scrape, jobs
    - _Requirements: 1.1, 1.2, 13.7_

- [x] 15. Logging and observability
  - [x] 15.1 Implement structured JSON logging
    - Configure Python logging with JSON formatter — include request_id, level, timestamp in all entries
    - Log task failures at ERROR level with target_url, proxy_used, error_reason, retry_attempts
    - Log task completions at INFO level with target_domain, duration_ms, fields_extracted, result_completeness
    - Configurable log level via `SCRAPER_LOG_LEVEL` env var
    - Ensure no credential values, auth tokens, or PII are ever logged
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6_

  - [x] 15.2 Write property tests for logging
    - **Property 38: Structured log format** — verify log entries are valid JSON with required fields per task status
    - **Validates: Requirements 14.1, 14.3, 14.6**
    - **Property 39: No credentials in logs or metrics** — verify no credential values or PII in log/metrics output
    - **Validates: Requirements 10.6, 14.5**

- [x] 16. Docker containerization
  - [x] 16.1 Create Dockerfile
    - Multi-stage build: stage 1 installs Python deps + Playwright + Chromium, stage 2 copies app code
    - Base image: python:3.11-slim
    - Install Playwright Chromium with `playwright install --with-deps chromium`
    - Run Chromium with `--no-sandbox --disable-dev-shm-usage --disable-gpu`
    - Add HEALTHCHECK instruction calling `GET /health`
    - Support graceful shutdown on SIGTERM (30s grace period)
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.7_

  - [x] 16.2 Create docker-compose.yml
    - Define scraper service with resource limits: 2 CPU cores, 4GB RAM
    - Configure environment variables for settings
    - Expose port 8001
    - _Requirements: 13.3_

  - [x] 16.3 Create tests/conftest.py with shared fixtures
    - Implement test `ScraperSettings` fixture with safe defaults
    - Implement circuit breaker, rate limiter, proxy manager fixtures
    - Implement hypothesis strategies: target_types, scrape_requests, fingerprint_profiles, raw_extractions, call_results, task_outcomes
    - _Requirements: all testing infrastructure_

- [x] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate all 43 correctness properties from the design document
- The service is stateless — all task/job state is in-memory
- Checkpoints are placed after each major component group for incremental validation
- Python tech stack: FastAPI, Playwright, Pydantic v2, pytest + hypothesis
