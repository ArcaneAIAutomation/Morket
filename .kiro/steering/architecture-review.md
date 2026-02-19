---
inclusion: always
---

# Architecture Review Guidelines for High-Throughput Data Systems

When reviewing code or making architectural decisions, evaluate against these criteria:

## Data Pipeline Resilience
- Every external API call must be wrapped in retry logic with exponential backoff
- All async workflows must be idempotent — re-running the same task must not produce duplicates
- Use circuit breakers for external service dependencies (backend: per-provider, scraper: per-domain)
- Never trust external API responses — validate schemas before processing
- Scraper results must be validated against Pydantic output schemas before returning to the enrichment pipeline
- Browser pool instances must be recycled after configurable page count to prevent memory leaks

## Database Design
- OLTP (PostgreSQL): Normalize to 3NF minimum. Use UUIDs for primary keys via `gen_random_uuid()`. Index all foreign keys and frequently queried columns.
- OLAP (ClickHouse): Denormalize for read performance. Use ReplacingMergeTree for deduplication.
- Never mix OLTP and OLAP queries on the same database instance.
- Credit/billing mutations must use `SELECT ... FOR UPDATE` within transactions to prevent concurrent modification.
- Migrations are sequential numbered files under `packages/backend/migrations/` with up/down functions.

## API Design
- All endpoints must be versioned (e.g., /api/v1/)
- Rate limiting must be applied at the gateway level (auth: 5/min, general: 100/min)
- Request/response payloads must be validated with zod schemas (backend) or pydantic models (scraper)
- Use consistent error codes and envelope format: `{ success, data, error, meta }`
- Nested resources use Express `mergeParams: true` routers (e.g., `/workspaces/:id/credentials`)
- Service-to-service auth uses X-Service-Key header (backend → scraper communication)

## Security
- Encrypt all stored credentials using AES-256-GCM with per-workspace encryption keys derived via HKDF
- JWT tokens must have short expiry (15min access, 7d refresh) with refresh token rotation
- All user inputs must be sanitized against injection attacks — parameterized queries only
- RBAC must be enforced at the middleware level via `requireRole()`, not in business logic
- Credential API responses must only expose masked values (last 4 chars), never raw keys
- Scraper credential client must transmit over HTTPS and never log or persist decrypted credential values
- Scraper webhook callbacks must be signed with HMAC-SHA256 for authenticity verification

## Performance
- Database queries must use connection pooling (pg-pool)
- Bulk operations must be batched (max 1000 records per batch for backend, max 100 per batch for scraper)
- Use Redis for caching frequently accessed data (workspace configs, user sessions) — planned
- Frontend must never block the main thread — use Web Workers for heavy computation
- Scraper browser pool: configurable size (default 5, max 20), instances recycled after 100 pages
- Scraper task queue: asyncio-based with max queue depth (500), priority scheduling (smaller jobs first)
- Per-domain rate limiting via token bucket algorithm (default 2 req/10s per domain)

## Existing Backend Patterns (Modules 1 & 2)
- Error handling: Custom `AppError` hierarchy (ValidationError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, InsufficientCreditsError, RateLimitError) caught by global `errorHandler` middleware
- Middleware pipeline order: requestId → requestLogger → helmet → cors → rateLimiter → bodyParser → routes → errorHandler
- Service functions that modify credit balances must acquire a `PoolClient` via `getPool().connect()` and manage BEGIN/COMMIT/ROLLBACK explicitly
- Property-based tests go in `tests/property/` with 100+ iterations per property using fast-check
- Unit tests are co-located with source files as `*.test.ts`
- Integration tests go in `tests/integration/`

## Enrichment Orchestration Patterns (Module 2)
- Provider adapters implement `ProviderAdapter` interface with `enrich(credentials, input)` returning `ProviderResult`
- Circuit breaker uses sliding window (10 calls, 5 failure threshold, 60s cooldown) per provider — in-memory, no DB
- Provider registry is an in-memory `Map<string, ProviderDefinition>` keyed by slug with Zod input/output schemas
- Temporal.io workflows run on task queue `enrichment-tasks` with workflow ID `enrichment-job-{jobId}`
- Enrichment activities use idempotency keys formatted as `{jobId}:{recordIndex}:{fieldName}:{providerSlug}`
- Waterfall enrichment: try providers in order, stop on first complete result, refund credits on failure
- Webhook delivery: HMAC-SHA256 signatures with `X-Webhook-Signature` header, 10s timeout, 3 retries with exponential backoff (5s, 10s, 20s)
- Enrichment routes return multiple routers from factory: `{ providerRoutes, jobRoutes, webhookRoutes, recordRoutes }`
- Batch splitting: input records split into batches of 1000 max before workflow execution
- 11 sequential migration files (001–011) covering all tables and indexes

## Scraping Microservices Patterns (Module 3)
- FastAPI service on port 8001 with Pydantic Settings for env validation
- Service-to-service auth via X-Service-Key header — no JWT, no RBAC
- Browser Pool: managed Playwright Chromium instances (default 5, max 20), recycled after 100 pages, 30s navigation timeout
- Page Extractors: pluggable registry pattern — each target type (linkedin_profile, company_website, job_posting) is a separate extractor module registered without modifying existing code
- Proxy Manager: round-robin rotation across HTTP/HTTPS/SOCKS5 proxies, health checks every 60s, per-domain cooldown (30s)
- Fingerprint Randomizer: randomized user agent, viewport (1280–1920 × 720–1080), timezone, language, geolocation per session; JS overrides to mask navigator.webdriver
- Domain Rate Limiter: token bucket algorithm (default 2 req/10s per domain), adaptive backoff on 429 responses, YAML-based per-domain policy overrides
- Circuit Breaker: per-domain sliding window (10 requests, 5 failure threshold, 120s cooldown) — same pattern as backend but domain-scoped
- Credential Client: fetches decrypted credentials from backend API with in-memory cache (5min TTL), 3 retries with exponential backoff (1s, 2s, 4s)
- Result Normalizer: transforms raw extractions into Pydantic models matching enrichment pipeline output schemas, strips HTML, normalizes URLs and locations
- Task Queue: asyncio-based with priority scheduling (smaller jobs first), max queue depth 500, 60s task timeout
- Batch processing: max 100 targets per batch, job states (queued, running, completed, partially_completed, failed, cancelled)
- Webhook callbacks: HMAC-SHA256 signed, 10s timeout, 3 retries with exponential backoff (2s, 4s, 8s)
- Docker: multi-stage build on Python 3.11-slim, Chromium with --no-sandbox --disable-dev-shm-usage --disable-gpu, resource limits (2 CPU, 4GB RAM), HEALTHCHECK on /health, graceful shutdown (30s SIGTERM)
- Observability: structured JSON logs, /metrics endpoint, /health and /readiness endpoints, never log credentials or PII
- Scraper API endpoints: POST /api/v1/scrape, POST /api/v1/scrape/sync, GET /api/v1/scrape/:taskId, POST /api/v1/scrape/batch, GET /api/v1/scrape/jobs/:jobId, GET /api/v1/scrape/jobs/:jobId/results, POST /api/v1/scrape/jobs/:jobId/cancel
