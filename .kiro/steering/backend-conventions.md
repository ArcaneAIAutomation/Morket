---
inclusion: fileMatch
fileMatchPattern: "packages/backend/**"
---

# Backend Conventions

These conventions apply when working on any file under `packages/backend/`.

## Module Structure

Each domain module lives in `src/modules/<name>/` and contains:
- `<name>.routes.ts` — Express router factory, applies validate + requireRole middleware
- `<name>.controller.ts` — Controller factory, handles HTTP req/res, delegates to service
- `<name>.service.ts` — Business logic, calls repositories, throws AppError subclasses
- `<name>.schemas.ts` — Zod schemas for body, params, query validation + exported inferred types
- `<name>.repository.ts` — Database access with parameterized queries, snake_case → camelCase row mapping

Some modules have additional files:
- `adapters/` — Provider adapter implementations (enrichment module: apollo, clearbit, hunter) + shared `types.ts`
- `temporal/` — Temporal.io client, activities, workflows, and worker (enrichment module)
- `circuit-breaker.ts` — In-memory sliding window circuit breaker (enrichment module)
- `provider-registry.ts` — In-memory provider registry with Zod schemas and credit costs (enrichment module)
- `opensearch/` — OpenSearch client and index management (search module)
- `similarity.ts`, `field-mapper.ts` — AI/ML utilities (ai module)

## Key Patterns

- Controllers use factory functions: `export function createXxxController() { return { ... } }`
- Routes use factory functions: `export function createXxxRoutes(): Router { ... }`
- Nested routes (credentials, billing, enrichment jobs, webhooks, records, data-ops, workflows, ai, team) use `Router({ mergeParams: true })` to access parent `:id` param
- Multi-router modules return an object of routers:
  - Enrichment: `{ providerRoutes, jobRoutes, webhookRoutes, recordRoutes }`
  - Billing: `{ planRoutes, workspaceBillingRoutes, webhookRoutes }`
  - Integration: `{ publicRoutes, workspaceRoutes }`
  - Search: `{ searchRoutes, adminSearchRoutes }`
  - Team: `{ workspaceRoutes, publicRoutes }`
- Services import repositories as `import * as xxxRepo from './xxx.repository'`
- All repository functions return camelCase interfaces mapped from snake_case DB rows
- Repository row interfaces are private; only the camelCase domain interface is exported
- Services that depend on external systems (Temporal) use injectable abstractions for testability

## Database Transactions

- For operations requiring atomicity (credit mutations, workspace creation):
  1. `const client = await getPool().connect()`
  2. `await client.query('BEGIN')`
  3. Perform operations using `client.query()` or pass `client` to repository functions
  4. `await client.query('COMMIT')` on success
  5. `await client.query('ROLLBACK')` in catch block
  6. `client.release()` in finally block

## Error Handling

- Throw `AppError` subclasses from services — never return error objects
- The global `errorHandler` middleware catches all errors and formats them into JSON envelope
- Unknown errors become 500 with generic message; details logged internally
- Auth middleware errors use `next(err)` pattern (Express 4 doesn't catch async rejections)

## Caching

- Redis client singleton with lazy connect (ioredis) in `src/cache/redis.ts`
- Generic cache layer in `src/cache/cache.ts`: get/set/delete with TTL, pattern invalidation
- Domain-specific helpers: workspace config (5min), user session (15min), provider health (1min)
- All cache operations wrapped in try/catch — silent failures when Redis is unavailable
- Redis health check integrated into /api/v1/health endpoint

## Observability

- Structured JSON logger in `src/observability/logger.ts` with configurable LOG_LEVEL
- Log entries include trace_id and span_id from OpenTelemetry context for log-trace correlation
- In-memory metrics in `src/observability/metrics.ts`: request/error counters, avg response time, memory usage
- OpenTelemetry distributed tracing in `src/observability/tracing.ts`: NodeSDK with auto-instrumentation for HTTP, Express, PostgreSQL, Redis
- Tracing middleware in `src/middleware/tracing.ts`: records request duration and error status in in-memory metrics
- OTLP trace exporter configurable via `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default: `http://localhost:4318/v1/traces`)
- `OTEL_ENABLED=false` disables tracing entirely; `initTracing()` must be called before all other imports in server.ts
- Health/readiness/metrics probes excluded from tracing
- GET /api/v1/metrics and GET /api/v1/readiness endpoints in app.ts
- Security event logging: `logAuthFailure()`, `logAuthzFailure()`, `logRateLimitHit()`, `logWebhookFailure()` in `src/observability/logger.ts`
- Header redaction for `Authorization`, `X-Service-Key` in request logs
- Field redaction for `password`, `secret`, `token`, `apiKey` in request body logs
- Credential CRUD audit logging with user ID, workspace ID, credential ID (never the credential value)

## Testing

- Unit tests: co-located as `<file>.test.ts`, mock repositories with `vi.mock()`
- Property tests: `tests/property/<module>.property.test.ts`, 100+ runs with fast-check
- Integration tests: `tests/integration/`, use supertest against `createApp()` with mocked repos
- Use `vi.resetAllMocks()` (not `vi.clearAllMocks()`) inside property test iterations to avoid stale mock queues
- Rate limiter state: call `_resetRateLimiterState()` in `beforeEach` for tests that touch HTTP endpoints
- Security property tests: `tests/property/security.property.test.ts` — 26 correctness properties covering auth, RBAC, rate limiting, encryption, sanitization, logging, webhooks

## Existing Modules

| Module | Path | Status |
|--------|------|--------|
| Auth | `src/modules/auth/` | ✅ Complete |
| Workspace | `src/modules/workspace/` | ✅ Complete |
| Credential | `src/modules/credential/` | ✅ Complete |
| Credit | `src/modules/credit/` | ✅ Complete |
| Enrichment | `src/modules/enrichment/` | ✅ Complete |
| Analytics | `src/modules/analytics/` | ✅ Complete |
| Search | `src/modules/search/` | ✅ Complete |
| Replication | `src/modules/replication/` | ✅ Complete |
| Billing | `src/modules/billing/` | ✅ Complete |
| Integration | `src/modules/integration/` | ✅ Complete |
| Data Ops | `src/modules/data-ops/` | ✅ Complete |
| Workflow | `src/modules/workflow/` | ✅ Complete |
| AI | `src/modules/ai/` | ✅ Complete |
| Team | `src/modules/team/` | ✅ Complete |

## Shared Infrastructure

| Component | Path | Purpose |
|-----------|------|---------|
| Cache | `src/cache/` | Redis client + generic cache layer |
| Observability | `src/observability/` | Structured logger + metrics + OpenTelemetry tracing |
| ClickHouse | `src/clickhouse/` | ClickHouse client + health check |
| Config | `src/config/env.ts` | Zod-validated environment config |
| Middleware | `src/middleware/` | Auth, RBAC, validation, rate limiting, logging, errors, requestId, tracing, securityHeaders |
| Sanitization | `src/shared/sanitize.ts` | HTML encoding, formula injection detection, URL safety validation |
| Security Headers | `src/middleware/securityHeaders.ts` | HSTS, X-Content-Type-Options, X-Frame-Options, Permissions-Policy |
| Shared | `src/shared/` | DB pool, encryption, errors, envelope, types |

## Migrations

22 sequential PostgreSQL migrations (001–022) plus ClickHouse migrations:
- 001–008: Core tables (users, workspaces, memberships, refresh_tokens, api_credentials, billing, credit_transactions, indexes)
- 009–011: Enrichment (enrichment_jobs, enrichment_records, webhook_subscriptions)
- 012–013: Replication (dead_letter_queue, replication_triggers)
- 014–016: Search (search_index_status, search_reindex_jobs, search_notify_triggers)
- 017: Stripe billing tables
- 018: Integration tables (OAuth tokens, field mappings, sync history)
- 019: Data operations (saved_views, record_activity_log)
- 020: Workflows (workflows, workflow_versions, workflow_runs)
- 021: AI/ML (quality_scores)
- 022: Team collaboration (activity_feed, audit_log, workspace_invitations)

## Scraper Service Conventions (packages/scraper)

The scraper is a separate Python/FastAPI service that acts as an enrichment provider. It does NOT follow the backend module pattern — it has its own architecture:

- FastAPI routers → Services → Browser Pool / Extractors / Proxy Manager
- Pydantic models for request/response validation (not Zod)
- pytest + pytest-asyncio for testing, hypothesis for property-based tests
- Black + Ruff for linting (not ESLint/Prettier)
- Service-to-service auth via X-Service-Key header (not JWT/RBAC)
- Same JSON envelope format as backend: `{ success, data, error, meta }`
- Same HMAC-SHA256 webhook signing pattern as backend
- Pluggable extractor registry mirrors backend's provider adapter pattern
