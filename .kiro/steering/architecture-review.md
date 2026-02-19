---
inclusion: always
---

# Architecture Review Guidelines for High-Throughput Data Systems

When reviewing code or making architectural decisions, evaluate against these criteria:

## Data Pipeline Resilience
- Every external API call must be wrapped in retry logic with exponential backoff
- All async workflows must be idempotent — re-running the same task must not produce duplicates
- Use circuit breakers for external service dependencies
- Never trust external API responses — validate schemas before processing

## Database Design
- OLTP (PostgreSQL): Normalize to 3NF minimum. Use UUIDs for primary keys via `gen_random_uuid()`. Index all foreign keys and frequently queried columns.
- OLAP (ClickHouse): Denormalize for read performance. Use ReplacingMergeTree for deduplication.
- Never mix OLTP and OLAP queries on the same database instance.
- Credit/billing mutations must use `SELECT ... FOR UPDATE` within transactions to prevent concurrent modification.
- Migrations are sequential numbered files under `packages/backend/migrations/` with up/down functions.

## API Design
- All endpoints must be versioned (e.g., /api/v1/)
- Rate limiting must be applied at the gateway level (auth: 5/min, general: 100/min)
- Request/response payloads must be validated with zod schemas via the validate middleware
- Use consistent error codes and envelope format: `{ success, data, error, meta }`
- Nested resources use Express `mergeParams: true` routers (e.g., `/workspaces/:id/credentials`)

## Security
- Encrypt all stored credentials using AES-256-GCM with per-workspace encryption keys derived via HKDF
- JWT tokens must have short expiry (15min access, 7d refresh) with refresh token rotation
- All user inputs must be sanitized against injection attacks — parameterized queries only
- RBAC must be enforced at the middleware level via `requireRole()`, not in business logic
- Credential API responses must only expose masked values (last 4 chars), never raw keys

## Performance
- Database queries must use connection pooling (pg-pool)
- Bulk operations must be batched (max 1000 records per batch)
- Use Redis for caching frequently accessed data (workspace configs, user sessions) — planned
- Frontend must never block the main thread — use Web Workers for heavy computation

## Existing Backend Patterns (Module 1)
- Error handling: Custom `AppError` hierarchy (ValidationError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, InsufficientCreditsError, RateLimitError) caught by global `errorHandler` middleware
- Middleware pipeline order: requestId → requestLogger → helmet → cors → rateLimiter → bodyParser → routes → errorHandler
- Service functions that modify credit balances must acquire a `PoolClient` via `getPool().connect()` and manage BEGIN/COMMIT/ROLLBACK explicitly
- Property-based tests go in `tests/property/` with 100+ iterations per property using fast-check
- Unit tests are co-located with source files as `*.test.ts`
- Integration tests go in `tests/integration/`
