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

The enrichment module extends this with additional sub-directories:
- `adapters/` — Provider adapter implementations (apollo, clearbit, hunter) + shared `types.ts`
- `temporal/` — Temporal.io client, activities, workflows, and worker
- `circuit-breaker.ts` — In-memory sliding window circuit breaker
- `provider-registry.ts` — In-memory provider registry with Zod schemas and credit costs

## Key Patterns

- Controllers use factory functions: `export function createXxxController() { return { ... } }`
- Routes use factory functions: `export function createXxxRoutes(): Router { ... }`
- Nested routes (credentials, billing, enrichment jobs, webhooks, records) use `Router({ mergeParams: true })` to access parent `:id` param
- Multi-router modules (enrichment) return an object of routers: `{ providerRoutes, jobRoutes, webhookRoutes, recordRoutes }`
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

## Testing

- Unit tests: co-located as `<file>.test.ts`, mock repositories with `vi.mock()`
- Property tests: `tests/property/<module>.property.test.ts`, 100+ runs with fast-check
- Integration tests: `tests/integration/`, use supertest against `createApp()` with mocked repos
- Use `vi.resetAllMocks()` (not `vi.clearAllMocks()`) inside property test iterations to avoid stale mock queues
- Rate limiter state: call `_resetRateLimiterState()` in `beforeEach` for tests that touch HTTP endpoints

## Existing Modules

| Module | Path | Status |
|--------|------|--------|
| Auth | `src/modules/auth/` | ✅ Complete |
| Workspace | `src/modules/workspace/` | ✅ Complete |
| Credential | `src/modules/credential/` | ✅ Complete |
| Credit | `src/modules/credit/` | ✅ Complete |
| Enrichment | `src/modules/enrichment/` | ✅ Complete |

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

### Enrichment Module Structure

```
src/modules/enrichment/
├── adapters/
│   ├── types.ts              # ProviderAdapter interface, ProviderResult, EnrichmentFieldType
│   ├── apollo.adapter.ts     # Apollo API adapter
│   ├── clearbit.adapter.ts   # Clearbit API adapter
│   └── hunter.adapter.ts     # Hunter API adapter
├── temporal/
│   ├── client.ts             # Temporal client connection factory
│   ├── activities.ts         # enrichRecord, updateJobStatus, deliverWebhook activities
│   ├── workflows.ts          # enrichmentWorkflow — durable workflow definition
│   └── worker.ts             # Temporal worker registration
├── circuit-breaker.ts        # Sliding window circuit breaker (10 calls, 5 threshold, 60s cooldown)
├── provider-registry.ts      # In-memory provider registry with Zod schemas
├── job.repository.ts         # Enrichment job CRUD
├── record.repository.ts      # Enrichment record CRUD with idempotency
├── webhook.repository.ts     # Webhook subscription CRUD
├── enrichment.service.ts     # Job lifecycle orchestration
├── webhook.service.ts        # Webhook delivery with HMAC-SHA256 + retries
├── enrichment.controller.ts  # HTTP handlers for all enrichment endpoints
├── enrichment.routes.ts      # Route factories (provider, job, webhook, record)
└── enrichment.schemas.ts     # Zod schemas for all enrichment endpoints
```
