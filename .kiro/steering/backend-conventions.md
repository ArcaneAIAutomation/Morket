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

## Key Patterns

- Controllers use factory functions: `export function createXxxController() { return { ... } }`
- Routes use factory functions: `export function createXxxRoutes(): Router { ... }`
- Nested routes (credentials, billing) use `Router({ mergeParams: true })` to access parent `:id` param
- Services import repositories as `import * as xxxRepo from './xxx.repository'`
- All repository functions return camelCase interfaces mapped from snake_case DB rows
- Repository row interfaces are private; only the camelCase domain interface is exported

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
