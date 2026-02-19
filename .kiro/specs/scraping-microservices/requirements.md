# Requirements Document

## Introduction

Module 3 implements the scraping microservices layer for the Morket GTM data engine. This module provides headless browser automation and HTTP-based scraping capabilities for data sources that lack structured APIs — LinkedIn profiles, company websites, job boards, and similar targets. The scraper runs as a standalone Python/FastAPI service in `packages/scraper/`, communicating with the Node.js backend (Modules 1 & 2) via REST API. It acts as an enrichment provider that the backend's Temporal.io workflows can invoke, returning normalized and schema-validated results through the enrichment pipeline.

The module implements anti-detection measures (proxy rotation, fingerprint randomization, request throttling), per-domain politeness policies, circuit breaker resilience, and Docker containerization with resource limits. Scraped data is validated with Pydantic models before being returned to the enrichment pipeline.

## Glossary

- **Scraper_Service**: The FastAPI application responsible for receiving scrape requests, orchestrating browser automation, and returning normalized results.
- **Scrape_Task**: A single unit of work representing a request to scrape data from one target URL or entity (e.g., one LinkedIn profile, one company website).
- **Scrape_Job**: A batch of one or more Scrape_Tasks submitted together, tracked with a job ID, status, and progress counters.
- **Browser_Pool**: A managed pool of Playwright headless browser instances reused across Scrape_Tasks to reduce startup overhead.
- **Page_Extractor**: A target-specific extraction module that navigates a page, waits for content, and extracts structured data using CSS selectors or XPath expressions.
- **Proxy_Manager**: The component responsible for maintaining a pool of proxy endpoints, rotating proxies per request, and marking failed proxies as unhealthy.
- **Fingerprint_Randomizer**: The component that randomizes browser fingerprint attributes (user agent, viewport, timezone, language, WebGL parameters) per browser session to reduce detection risk.
- **Domain_Policy**: A per-domain configuration specifying rate limits, request delays, allowed scraping hours, and robots.txt compliance settings.
- **Rate_Limiter**: The component that enforces per-domain request rate limits defined by Domain_Policy configurations, using a token bucket algorithm.
- **Circuit_Breaker**: A resilience pattern that tracks scraping failures per target domain and temporarily disables scraping to that domain after a configurable failure threshold.
- **Result_Normalizer**: The component that transforms raw extracted data into a standardized Pydantic model matching the enrichment pipeline's expected output schema.
- **Credential_Client**: An HTTP client that authenticates with the backend API (Module 1) to retrieve decrypted third-party credentials needed for authenticated scraping sessions.
- **Health_Monitor**: The component that exposes health check endpoints and reports readiness status based on browser pool availability and proxy pool health.
- **Task_Queue**: An internal async queue (asyncio-based) that manages concurrency of Scrape_Tasks within the service, enforcing max concurrent browser sessions.

## Requirements

### Requirement 1: FastAPI Service Foundation

**User Story:** As a developer, I want a well-structured FastAPI scraping service, so that the scraper can be deployed, monitored, and integrated with the backend enrichment pipeline reliably.

#### Acceptance Criteria

1. THE Scraper_Service SHALL expose a REST API on a configurable port (default 8001) using FastAPI with automatic OpenAPI documentation
2. WHEN the Scraper_Service starts, THE Scraper_Service SHALL validate all environment variables (proxy URLs, backend API URL, browser pool size, rate limit defaults) against a Pydantic Settings model and terminate with a descriptive error if validation fails
3. THE Scraper_Service SHALL return all responses in a JSON envelope format `{ success: bool, data: T | None, error: str | None, meta: dict | None }`
4. WHEN an unhandled exception occurs during request processing, THE Scraper_Service SHALL return a 500 status code with a generic error message and log the detailed traceback internally
5. THE Scraper_Service SHALL expose a GET /health endpoint that returns the service status, browser pool availability, and proxy pool health without requiring authentication
6. THE Scraper_Service SHALL expose a GET /readiness endpoint that returns 200 only when the Browser_Pool has at least one available instance and the Proxy_Manager has at least one healthy proxy
7. WHEN the Scraper_Service receives a request, THE Scraper_Service SHALL assign a unique request ID (UUID) and include the request ID in all log entries and the response headers


### Requirement 2: Scrape Task Execution via Enrichment Provider Interface

**User Story:** As a backend developer, I want the scraper to act as an enrichment provider that the backend can call via REST API, so that scraping integrates seamlessly into the existing Temporal.io enrichment workflows.

#### Acceptance Criteria

1. WHEN the backend sends POST /api/v1/scrape with a target type (e.g., "linkedin_profile", "company_website"), target identifier, and requested fields, THE Scraper_Service SHALL create a Scrape_Task and return the task ID with status "queued"
2. WHEN the backend sends POST /api/v1/scrape/sync with a target type, target identifier, and requested fields, THE Scraper_Service SHALL execute the Scrape_Task synchronously and return the extracted data in the response within a configurable timeout (default 60 seconds)
3. WHEN the backend sends GET /api/v1/scrape/:taskId, THE Scraper_Service SHALL return the current status of the Scrape_Task (queued, running, completed, failed) and the result data if completed
4. THE Scraper_Service SHALL validate all incoming scrape requests against a Pydantic schema specific to the target type before accepting the task
5. IF the incoming scrape request fails Pydantic validation, THEN THE Scraper_Service SHALL return a 422 status code with field-level validation errors in the JSON envelope
6. THE Scraper_Service SHALL authenticate incoming requests from the backend using a shared API key provided in the X-Service-Key header
7. IF a request lacks a valid X-Service-Key header, THEN THE Scraper_Service SHALL return a 401 status code without processing the request

### Requirement 3: Scrape Job Batch Processing

**User Story:** As a backend developer, I want to submit batches of scrape targets, so that bulk enrichment jobs can scrape multiple entities efficiently.

#### Acceptance Criteria

1. WHEN the backend sends POST /api/v1/scrape/batch with an array of scrape targets (max 100 per batch), THE Scraper_Service SHALL create a Scrape_Job containing one Scrape_Task per target and return the job ID
2. WHEN a user sends GET /api/v1/scrape/jobs/:jobId, THE Scraper_Service SHALL return the Scrape_Job status, progress (tasks completed vs total), and a summary of successes and failures
3. WHEN a user sends GET /api/v1/scrape/jobs/:jobId/results, THE Scraper_Service SHALL return a list of completed Scrape_Task results for the specified job
4. WHEN all Scrape_Tasks in a Scrape_Job complete, THE Scraper_Service SHALL update the job status to "completed" if all tasks succeeded, "partially_completed" if some failed, or "failed" if all tasks failed
5. WHEN a user sends POST /api/v1/scrape/jobs/:jobId/cancel, THE Scraper_Service SHALL cancel all queued Scrape_Tasks in the job, allow running tasks to complete, and update the job status to "cancelled"
6. IF a batch request contains more than 100 targets, THEN THE Scraper_Service SHALL return a 400 status code with an error indicating the maximum batch size

### Requirement 4: Playwright Browser Pool Management

**User Story:** As a developer, I want a managed pool of headless browser instances, so that scraping tasks can execute concurrently without excessive resource consumption.

#### Acceptance Criteria

1. WHEN the Scraper_Service starts, THE Browser_Pool SHALL initialize a configurable number of Playwright Chromium browser instances (default 5, max 20)
2. WHEN a Scrape_Task requires a browser, THE Browser_Pool SHALL provide an available browser instance from the pool within 10 seconds or reject the task with a "pool exhausted" error
3. WHEN a Scrape_Task completes or fails, THE Browser_Pool SHALL return the browser instance to the pool after clearing cookies, local storage, and session state
4. WHEN a browser instance crashes or becomes unresponsive, THE Browser_Pool SHALL terminate the instance and create a replacement instance
5. THE Browser_Pool SHALL enforce a maximum page navigation timeout of 30 seconds per Scrape_Task to prevent indefinite blocking
6. WHILE the Browser_Pool has zero available instances, THE Task_Queue SHALL hold new Scrape_Tasks in a waiting state until an instance becomes available
7. THE Browser_Pool SHALL track the total number of pages processed per instance and recycle instances after a configurable threshold (default 100 pages) to prevent memory leaks

### Requirement 5: Target-Specific Page Extractors

**User Story:** As a data analyst, I want the scraper to extract structured data from different types of web pages, so that enrichment results are accurate and consistently formatted.

#### Acceptance Criteria

1. THE Scraper_Service SHALL support a pluggable Page_Extractor architecture where adding a new target type requires only registering an extractor module without modifying existing extractor code
2. WHEN a Scrape_Task specifies target type "linkedin_profile", THE Page_Extractor SHALL extract the person's name, headline, current company, location, and profile summary from the LinkedIn profile page
3. WHEN a Scrape_Task specifies target type "company_website", THE Page_Extractor SHALL extract the company name, description, industry, employee count range, headquarters location, and contact information from the company's website
4. WHEN a Scrape_Task specifies target type "job_posting", THE Page_Extractor SHALL extract the job title, company name, location, salary range (if available), and job description from the job posting page
5. WHEN a Page_Extractor cannot locate a required data field on the page, THE Page_Extractor SHALL set the field value to null in the result rather than failing the entire extraction
6. THE Page_Extractor SHALL wait for dynamic content to load (JavaScript-rendered elements) using Playwright's wait-for-selector mechanism with a configurable timeout (default 10 seconds) before extracting data
7. WHEN a page requires scrolling to load additional content (infinite scroll or lazy loading), THE Page_Extractor SHALL perform incremental scrolling until the target data is visible or a maximum scroll count (default 5) is reached


### Requirement 6: Anti-Detection and Fingerprint Randomization

**User Story:** As a scraping engineer, I want the scraper to evade bot detection systems, so that scraping operations are not blocked by target websites.

#### Acceptance Criteria

1. WHEN a new browser session is created for a Scrape_Task, THE Fingerprint_Randomizer SHALL assign a randomized user agent string from a curated list of real browser user agents
2. WHEN a new browser session is created, THE Fingerprint_Randomizer SHALL randomize the viewport dimensions within realistic ranges (width 1280–1920, height 720–1080)
3. WHEN a new browser session is created, THE Fingerprint_Randomizer SHALL set a randomized timezone, language, and geolocation consistent with the assigned proxy's geographic region
4. THE Fingerprint_Randomizer SHALL inject JavaScript overrides to mask Playwright-specific browser properties (navigator.webdriver, chrome.runtime) that bot detection scripts check
5. WHEN navigating to a target page, THE Scraper_Service SHALL introduce randomized delays between actions (clicks, scrolls, typing) within a configurable range (default 500ms–2000ms) to simulate human browsing behavior
6. THE Fingerprint_Randomizer SHALL rotate the complete fingerprint profile (user agent, viewport, timezone, language) for each new browser session to prevent fingerprint correlation across requests

### Requirement 7: Proxy Rotation and Management

**User Story:** As a scraping engineer, I want automatic proxy rotation, so that scraping requests are distributed across IP addresses to avoid rate limiting and IP bans.

#### Acceptance Criteria

1. WHEN the Scraper_Service starts, THE Proxy_Manager SHALL load the proxy pool from a configurable list of proxy endpoints (HTTP/HTTPS/SOCKS5) provided via environment variable or configuration file
2. WHEN a Scrape_Task requires a proxy, THE Proxy_Manager SHALL select a proxy using round-robin rotation, skipping proxies marked as unhealthy
3. WHEN a proxy connection fails or returns a connection timeout, THE Proxy_Manager SHALL mark the proxy as unhealthy and select the next available proxy
4. THE Proxy_Manager SHALL periodically check unhealthy proxies (every 60 seconds) and restore them to the healthy pool if a test connection succeeds
5. IF all proxies in the pool are marked as unhealthy, THEN THE Proxy_Manager SHALL reject new Scrape_Tasks with a "no healthy proxies available" error and report the condition via the Health_Monitor
6. THE Proxy_Manager SHALL track success and failure counts per proxy and expose these metrics via the GET /health endpoint
7. WHEN a proxy is selected for a Scrape_Task, THE Proxy_Manager SHALL ensure the same proxy is not reused for consecutive requests to the same target domain within a configurable cooldown period (default 30 seconds)

### Requirement 8: Per-Domain Rate Limiting and Politeness Policies

**User Story:** As a responsible scraping operator, I want per-domain rate limits and politeness policies, so that the scraper respects target website resources and avoids triggering abuse protections.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce per-domain request rate limits using a token bucket algorithm with configurable tokens per interval (default 2 requests per 10 seconds per domain)
2. WHEN a Scrape_Task targets a domain that has exhausted its rate limit tokens, THE Rate_Limiter SHALL delay the task until tokens are replenished rather than rejecting the task
3. THE Scraper_Service SHALL load Domain_Policy configurations from a YAML configuration file that specifies per-domain overrides for rate limits, minimum request delays, and allowed scraping windows
4. WHEN a Domain_Policy specifies allowed scraping hours, THE Scraper_Service SHALL queue Scrape_Tasks targeting that domain outside the allowed window and execute them when the window opens
5. WHEN a Domain_Policy specifies robots.txt compliance as enabled, THE Scraper_Service SHALL fetch and cache the target domain's robots.txt file and skip URLs disallowed for the configured user agent
6. IF a target domain returns a 429 (Too Many Requests) response, THEN THE Rate_Limiter SHALL reduce the token replenishment rate for that domain by 50% for a configurable backoff period (default 5 minutes)
7. THE Rate_Limiter SHALL maintain separate rate limit state per domain, so that throttling on one domain does not affect scraping throughput on other domains

### Requirement 9: Circuit Breaker for Target Domains

**User Story:** As a developer, I want the scraper to detect and isolate failing target domains, so that repeated failures do not waste resources or block other scraping tasks.

#### Acceptance Criteria

1. THE Circuit_Breaker SHALL track the failure count for each target domain independently, using a sliding window of the most recent 10 requests
2. WHEN the failure count for a target domain exceeds 5 failures within the sliding window, THE Circuit_Breaker SHALL transition the domain to an "open" state
3. WHILE a target domain is in the "open" state, THE Scraper_Service SHALL immediately fail Scrape_Tasks targeting that domain with a "domain circuit open" error without launching a browser
4. WHEN a target domain has been in the "open" state for 120 seconds, THE Circuit_Breaker SHALL transition the domain to a "half-open" state
5. WHILE a target domain is in the "half-open" state, THE Circuit_Breaker SHALL allow one probe request to the domain
6. WHEN a probe request in the "half-open" state succeeds, THE Circuit_Breaker SHALL transition the domain back to the "closed" state and reset the failure count
7. WHEN a probe request in the "half-open" state fails, THE Circuit_Breaker SHALL transition the domain back to the "open" state for another 120-second cooldown period


### Requirement 10: Credential Retrieval from Backend

**User Story:** As a scraping engineer, I want the scraper to retrieve encrypted API credentials from the backend, so that authenticated scraping sessions (e.g., LinkedIn login) can use workspace-specific credentials securely.

#### Acceptance Criteria

1. WHEN a Scrape_Task requires authentication with a target service, THE Credential_Client SHALL request the decrypted credential from the backend API at GET /api/v1/workspaces/:id/credentials/:provider using a service-to-service authentication token
2. THE Credential_Client SHALL cache retrieved credentials in memory for a configurable TTL (default 5 minutes) to reduce repeated calls to the backend
3. WHEN a cached credential's TTL expires, THE Credential_Client SHALL fetch a fresh credential from the backend on the next request
4. IF the backend returns a 404 for a credential request, THEN THE Credential_Client SHALL fail the Scrape_Task with a "missing credentials for provider" error
5. IF the backend is unreachable during a credential request, THEN THE Credential_Client SHALL retry up to 3 times with exponential backoff (1s, 2s, 4s) before failing the Scrape_Task
6. THE Credential_Client SHALL transmit credential requests over HTTPS and never log or persist decrypted credential values to disk

### Requirement 11: Result Normalization and Schema Validation

**User Story:** As a backend developer, I want scraped data normalized into consistent Pydantic models, so that the enrichment pipeline can process scraper results identically to API provider results.

#### Acceptance Criteria

1. WHEN a Page_Extractor returns raw extracted data, THE Result_Normalizer SHALL transform the data into a Pydantic model matching the enrichment pipeline's expected output schema for the target type
2. THE Result_Normalizer SHALL validate all normalized results against the target type's Pydantic output schema before returning the result
3. IF a normalized result fails Pydantic validation, THEN THE Result_Normalizer SHALL log the validation errors and return a partial result containing only the valid fields
4. THE Result_Normalizer SHALL strip HTML tags, normalize whitespace, and trim leading/trailing whitespace from all extracted text fields
5. THE Result_Normalizer SHALL normalize URL fields to include the scheme (https://) and remove tracking parameters
6. THE Result_Normalizer SHALL parse and normalize location fields into a consistent format with city, state/region, and country components where identifiable
7. FOR ALL valid normalized results, serializing to JSON then deserializing back to the Pydantic model SHALL produce an equivalent object (round-trip property)

### Requirement 12: Async Task Queue and Concurrency Control

**User Story:** As a developer, I want the scraper to manage concurrent scraping tasks efficiently, so that the service maximizes throughput without exceeding resource limits.

#### Acceptance Criteria

1. THE Task_Queue SHALL process Scrape_Tasks using an asyncio-based worker pool with a configurable maximum concurrency (default equal to Browser_Pool size)
2. WHEN a Scrape_Task is submitted, THE Task_Queue SHALL add the task to a priority queue where tasks from smaller Scrape_Jobs are prioritized over tasks from larger jobs
3. WHEN the Task_Queue reaches maximum concurrency, THE Task_Queue SHALL hold additional tasks in the queue until a worker becomes available
4. THE Task_Queue SHALL enforce a maximum queue depth (default 500 tasks) and reject new tasks with a 503 status code when the queue is full
5. WHEN a Scrape_Task exceeds its execution timeout (default 60 seconds), THE Task_Queue SHALL cancel the task, release the browser instance, and mark the task as "failed" with a timeout error
6. THE Task_Queue SHALL track and expose queue depth, active workers, and average task duration via the GET /health endpoint

### Requirement 13: Docker Containerization and Resource Limits

**User Story:** As a DevOps engineer, I want the scraper service containerized with resource limits, so that it can be deployed reliably in production without consuming unbounded resources.

#### Acceptance Criteria

1. THE Scraper_Service SHALL provide a Dockerfile that builds a production image based on a Python 3.11+ slim base image with Playwright and Chromium dependencies installed
2. THE Dockerfile SHALL use a multi-stage build to minimize the final image size by separating dependency installation from the application code
3. THE Scraper_Service SHALL provide a docker-compose.yml configuration that defines resource limits (CPU: 2 cores, memory: 4GB) for the scraper container
4. THE Scraper_Service SHALL run the Chromium browser with the --no-sandbox, --disable-dev-shm-usage, and --disable-gpu flags to operate correctly within a container environment
5. WHEN the container's memory usage approaches the configured limit, THE Scraper_Service SHALL reduce the Browser_Pool size and reject new tasks to prevent OOM termination
6. THE Dockerfile SHALL include a HEALTHCHECK instruction that calls the GET /health endpoint to enable container orchestrator health monitoring
7. THE Scraper_Service SHALL support graceful shutdown by completing in-progress Scrape_Tasks and draining the Task_Queue when a SIGTERM signal is received, within a configurable grace period (default 30 seconds)

### Requirement 14: Logging, Metrics, and Observability

**User Story:** As a DevOps engineer, I want structured logging and metrics from the scraper, so that I can monitor scraping performance, debug failures, and set up alerts.

#### Acceptance Criteria

1. THE Scraper_Service SHALL emit structured JSON logs for all operations including request ID, target domain, target type, task status, duration, and error details
2. THE Scraper_Service SHALL log at configurable levels (DEBUG, INFO, WARNING, ERROR) controlled by an environment variable
3. WHEN a Scrape_Task fails, THE Scraper_Service SHALL log the failure reason, target URL, proxy used, and the number of retry attempts at ERROR level
4. THE Scraper_Service SHALL expose a GET /metrics endpoint that returns current values for: active browser instances, queue depth, tasks completed, tasks failed, average task duration, and per-domain request counts
5. THE Scraper_Service SHALL never log or include in metrics any credential values, authentication tokens, or personally identifiable information from scraped pages
6. WHEN a Scrape_Task completes, THE Scraper_Service SHALL log the task duration, target domain, fields extracted, and result completeness at INFO level

### Requirement 15: Backend Integration and Webhook Callbacks

**User Story:** As a backend developer, I want the scraper to notify the backend when scraping jobs complete, so that the enrichment pipeline can process results without polling.

#### Acceptance Criteria

1. WHEN a Scrape_Job reaches a terminal state (completed, partially_completed, failed, cancelled), THE Scraper_Service SHALL send an HTTP POST callback to a configurable backend webhook URL with the job ID, status, and result summary
2. THE Scraper_Service SHALL include an HMAC-SHA256 signature in the X-Webhook-Signature header of each callback, computed using a shared secret key, so that the backend can verify authenticity
3. WHEN a webhook callback delivery fails, THE Scraper_Service SHALL retry delivery up to 3 times with exponential backoff (2s, 4s, 8s)
4. THE Scraper_Service SHALL set a timeout of 10 seconds for each webhook callback delivery attempt
5. WHEN the backend sends a scrape request with a callback_url field, THE Scraper_Service SHALL use that URL for the completion callback instead of the default configured URL
6. THE Scraper_Service SHALL include the full array of Scrape_Task results in the webhook callback payload for Scrape_Jobs with 100 or fewer tasks, and include only the job summary for larger jobs
