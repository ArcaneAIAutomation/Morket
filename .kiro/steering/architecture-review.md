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
- OLTP (PostgreSQL): Normalize to 3NF minimum. Use UUIDs for primary keys. Index all foreign keys and frequently queried columns.
- OLAP (ClickHouse): Denormalize for read performance. Use ReplacingMergeTree for deduplication.
- Never mix OLTP and OLAP queries on the same database instance.

## API Design
- All endpoints must be versioned (e.g., /api/v1/)
- Rate limiting must be applied at the gateway level
- Request/response payloads must be validated with zod schemas
- Use consistent error codes and envelope format: { success, data, error, meta }

## Security
- Encrypt all stored credentials using AES-256-GCM with per-workspace encryption keys
- JWT tokens must have short expiry (15min access, 7d refresh)
- All user inputs must be sanitized against injection attacks
- RBAC must be enforced at the middleware level, not in business logic

## Performance
- Database queries must use connection pooling (pg-pool)
- Bulk operations must be batched (max 1000 records per batch)
- Use Redis for caching frequently accessed data (workspace configs, user sessions)
- Frontend must never block the main thread — use Web Workers for heavy computation
