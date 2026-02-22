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
- Migrations are sequential numbered files (001–022) under `packages/backend/migrations/` with up/down functions.
- ClickHouse migrations are in `packages/backend/migrations/clickhouse/` with their own runner.

## API Design
- All endpoints must be versioned (e.g., /api/v1/)
- Rate limiting must be applied at the gateway level (auth: 5/min, general: 100/min)
- Request/response payloads must be validated with zod schemas (backend) or pydantic models (scraper)
- Use consistent error codes and envelope format: `{ success, data, error, meta }`
- Nested resources use Express `mergeParams: true` routers (e.g., `/workspaces/:id/credentials`)
- Service-to-service auth uses X-Service-Key header (backend → scraper communication)
- Multi-router modules return an object of routers from their route factory (e.g., enrichment, integration, billing, search, team)

## Security
- Encrypt all stored credentials using AES-256-GCM with per-workspace encryption keys derived via HKDF
- OAuth tokens for CRM integrations must be encrypted at rest using per-workspace encryption
- JWT tokens must have short expiry (15min access, 7d refresh) with refresh token rotation
- All user inputs must be sanitized against injection attacks — parameterized queries only
- RBAC must be enforced at the middleware level via `requireRole()`, not in business logic
- Role hierarchy: owner > admin > member > viewer, with additional billing_admin role
- Credential API responses must only expose masked values (last 4 chars), never raw keys
- Scraper credential client must transmit over HTTPS and never log or persist decrypted credential values
- Scraper webhook callbacks must be signed with HMAC-SHA256 for authenticity verification
- Stripe webhooks must receive raw body (before JSON parser) for signature verification
- Workspace invitations use expiring tokens (7-day TTL) with public accept/decline endpoints

## Performance
- Database queries must use connection pooling (pg-pool)
- Bulk operations must be batched (max 1000 records per batch for backend, max 100 per batch for scraper)
- Redis caching for frequently accessed data: workspace configs (5min TTL), user sessions (15min TTL), provider health (1min TTL)
- All Redis cache operations must be wrapped in try/catch — silent failures when Redis is unavailable (graceful degradation)
- Frontend must never block the main thread — use Web Workers for heavy computation (CSV parse/generate for ≥10k rows)
- AG Grid with DOM virtualization for 100k+ row datasets
- Frontend filter changes debounced at 300ms; search suggestions debounced at 200ms
- Lazy-load heavy routes (AnalyticsDashboard, SearchResultsView) via React.lazy + Suspense
- Scraper browser pool: configurable size (default 5, max 20), instances recycled after 100 pages
- Scraper task queue: asyncio-based with max queue depth (500), priority scheduling (smaller jobs first)
- Per-domain rate limiting via token bucket algorithm (default 2 req/10s per domain)

## Frontend Patterns (Module 4)

### State Management
- Zustand stores: one per domain (auth, grid, workspace, job, analytics, search, ui)
- Stores connect to API client via `connectAuthStore()` / `connectUIStore()` to avoid circular deps
- Grid store: rows, columns, selection, pending changes, undo stack (max 50 entries), sort/filter model, per-cell enrichment status
- Job store: enrichment jobs with 5s polling interval, terminal status detection, summary stats
- UI store: toast queue (max 5, auto-dismiss 5s for non-errors), offline status, sidebar collapse (persisted to localStorage)
- Active workspace ID persisted to localStorage for cross-session continuity

### API Client
- Two Axios instances: `apiClient` (30s timeout) and `enrichmentClient` (120s timeout)
- Request interceptor: attaches Bearer token from auth store
- Response interceptor: unwraps `{ success, data, error, meta }` envelope, returns `data` directly
- 401: automatic token refresh + retry once; redirect to /login on failure
- 429/403/500: fire toast notifications via UI store
- Vite dev proxy: `/api/v1` → `http://localhost:3000`

### Spreadsheet
- AG Grid (ag-grid-react v32) with `ag-theme-alpine` custom overrides
- Column definitions mapped from `ColumnDefinition[]` → AG Grid `ColDef[]`, excluding hidden columns
- Cell edits → pending changes + undo stack; auto-save every 30s (skips if offline)
- Context menu: row actions (enrich, delete, export) and column actions (rename, type, hide, delete)
- Keyboard shortcuts: Ctrl/Cmd+Z for undo
- CSV import via Web Worker with column mapping dialog; export all or selected rows

### Permissions
- Role-based permission map: viewer < member < admin < owner
- `useRole()` hook returns `{ role, can(action) }`
- Toolbar buttons and actions conditionally rendered based on `can()` checks
- Actions: view_records, export_csv, edit_records, add_records, delete_records, import_csv, run_enrichment, manage_columns, manage_credentials, manage_members, edit_workspace, delete_workspace, manage_billing

### Testing
- Unit tests: co-located `*.test.ts(x)` with Testing Library + MSW
- Property tests: 7 suites in `tests/property/` using fast-check (api-envelope, csv-roundtrip, enrichment-cost, grid-operations, permissions, sort-filter, toast-behavior)

## Backend Module Patterns (Modules 1–2, 5–6, 8)

### Core Patterns
- Error handling: Custom `AppError` hierarchy (ValidationError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, InsufficientCreditsError, RateLimitError) caught by global `errorHandler` middleware
- Middleware pipeline order: requestId → requestLogger → helmet → cors → rateLimiter → bodyParser → routes → errorHandler
- Stripe webhook route is mounted BEFORE the JSON body parser to receive raw body for signature verification
- Service functions that modify credit balances must acquire a `PoolClient` via `getPool().connect()` and manage BEGIN/COMMIT/ROLLBACK explicitly
- Property-based tests go in `tests/property/` with 100+ iterations per property using fast-check
- Unit tests are co-located with source files as `*.test.ts`
- Integration tests go in `tests/integration/`

### Enrichment Orchestration (Module 2)
- Provider adapters implement `ProviderAdapter` interface with `enrich(credentials, input)` returning `ProviderResult`
- Circuit breaker uses sliding window (10 calls, 5 failure threshold, 60s cooldown) per provider — in-memory, no DB
- Provider registry is an in-memory `Map<string, ProviderDefinition>` keyed by slug with Zod input/output schemas
- Temporal.io workflows run on task queue `enrichment-tasks` with workflow ID `enrichment-job-{jobId}`
- Enrichment activities use idempotency keys formatted as `{jobId}:{recordIndex}:{fieldName}:{providerSlug}`
- Waterfall enrichment: try providers in order, stop on first complete result, refund credits on failure
- Webhook delivery: HMAC-SHA256 signatures with `X-Webhook-Signature` header, 10s timeout, 3 retries with exponential backoff (5s, 10s, 20s)
- Enrichment routes return multiple routers from factory: `{ providerRoutes, jobRoutes, webhookRoutes, recordRoutes }`
- Batch splitting: input records split into batches of 1000 max before workflow execution

### Analytics & Search (Modules 5–6)
- ClickHouse client with health check, CDC pipeline from PostgreSQL via replication triggers
- OpenSearch client with index management, real-time indexing, full-text search with fuzzy matching
- Search routes return `{ searchRoutes, adminSearchRoutes }` — admin routes include reindex operations
- Analytics include CSV export capability
- Dead letter queue for failed replication events with admin management endpoints

### Billing (Module 8.4)
- Stripe integration: subscriptions (free/starter/pro/enterprise), credit pack purchases, Checkout sessions, Customer Portal
- Billing routes return `{ planRoutes, workspaceBillingRoutes, webhookRoutes }`
- Webhook route mounted before JSON parser for raw body signature verification

### CRM Integrations (Module 8.3)
- Integration routes return `{ publicRoutes, workspaceRoutes }`
- OAuth2 flow with in-memory state store (TTL cleanup)
- OAuth tokens encrypted at rest using per-workspace AES-256-GCM encryption
- Integration registry pattern — same as provider adapters

### Data Operations (Module 8.5)
- CSV import uses two-phase approach: preview (parse + validate) then commit
- File upload via multer middleware (10MB limit)
- Dedup scan returns candidate pairs with similarity scores; merge applies configurable rules

### Workflow Builder (Module 8.2)
- Workflow graph: nodes (data_source, enrichment_step, filter, output) + edges
- Automatic versioning on graph updates; rollback copies target version as new version
- Template listing + clone into workspace
- Cron schedule management for recurring execution

### AI/ML Intelligence (Module 8.1)
- Levenshtein similarity utility for fuzzy matching
- Smart field mapper with alias dictionary for auto-detection
- Quality scoring: confidence (field completeness), freshness, per-field indicators
- Natural language query parser: keyword extraction → structured filters

### Team & Collaboration (Module 8.6)
- Team routes return `{ workspaceRoutes, publicRoutes }`
- Public routes handle invitation accept/decline via token
- Activity feed for team actions; immutable audit log with CSV export
- Extended roles: viewer (read-only), billing_admin (manage subscription only)

### Caching (Module 8.7)
- Redis client singleton with lazy connect (ioredis)
- Generic cache layer: get/set/delete with TTL, pattern invalidation
- Domain-specific helpers: workspace config (5min), user session (15min), provider health (1min)
- Redis health check integrated into /api/v1/health endpoint

### Observability (Module 8.8)
- Structured JSON logger: timestamp, level, message, service, meta fields
- Log levels: debug, info, warn, error with configurable minimum via LOG_LEVEL env var
- stdout for info/debug, stderr for warn/error
- In-memory request/error counters, avg response time, memory usage
- GET /api/v1/metrics (public) and GET /api/v1/readiness (returns 503 if deps down)

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
