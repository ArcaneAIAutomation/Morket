# Implementation Plan: Core Backend Foundation

## Overview

Incremental implementation of the GTM data engine foundation: Express.js API gateway with TypeScript, PostgreSQL schema, JWT auth, RBAC, workspace management, encrypted credential storage, and credit/billing system. Each task builds on the previous, with property tests validating correctness at each layer.

## Tasks

- [ ] 1. Project scaffolding and shared infrastructure
  - [x] 1.1 Initialize the `packages/backend` directory with `package.json`, `tsconfig.json` (strict mode), and install core dependencies: express, pg, pg-pool, bcrypt, jsonwebtoken, zod, helmet, cors, uuid, dotenv, vitest, fast-check, supertest, and their type definitions
    - Create `.env.example` with all required environment variables
    - _Requirements: 7.7_
  - [x] 1.2 Implement `src/config/env.ts` — Zod schema for environment variable validation that terminates the process with a descriptive error if any required variable is missing or invalid
    - Variables: PORT, DATABASE_URL, JWT_SECRET, JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY, ENCRYPTION_MASTER_KEY, CORS_ORIGIN, NODE_ENV
    - _Requirements: 7.7, 7.8_
  - [x] 1.3 Implement `src/shared/db.ts` — PostgreSQL connection pool using pg-pool with configuration from validated env
    - _Requirements: 7.6_
  - [x] 1.4 Implement `src/shared/errors.ts` — AppError base class and subclasses: ValidationError (400), AuthenticationError (401), AuthorizationError (403), NotFoundError (404), ConflictError (409), InsufficientCreditsError (402), RateLimitError (429)
    - _Requirements: 7.3_
  - [x] 1.5 Implement `src/shared/envelope.ts` — JSON envelope helper functions: `successResponse(data, meta?)` and `errorResponse(code, message)` conforming to `{ success, data, error, meta? }`
    - _Requirements: 7.1_
  - [x] 1.6 Implement `src/shared/logger.ts` — Structured JSON logger that outputs method, path, statusCode, and responseTime
    - _Requirements: 7.9_
  - [x] 1.7 Implement `src/shared/encryption.ts` — AES-256-GCM encryption module with `deriveWorkspaceKey(masterKey, workspaceId)`, `encrypt(plaintext, key)`, and `decrypt(ciphertext, iv, authTag, key)` functions
    - Key derivation uses HKDF with workspace ID as info parameter
    - _Requirements: 5.1, 5.4, 5.5_
  - [x] 1.8 Write property tests for encryption module (Properties 14, 17, 18)
    - **Property 14: Credential encryption round-trip** — For any plaintext string, encrypt then decrypt should return the original
    - **Validates: Requirements 5.1**
    - **Property 17: Unique IV per encryption** — For any two encryptions of the same plaintext, IVs should differ
    - **Validates: Requirements 5.4**
    - **Property 18: Per-workspace key derivation distinctness** — For any two workspace IDs, derived keys should differ
    - **Validates: Requirements 5.5**

- [ ] 2. Express app setup and middleware
  - [x] 2.1 Implement `src/middleware/requestId.ts` — Generates UUID and attaches to req and X-Request-Id response header
    - _Requirements: 7.2_
  - [x] 2.2 Implement `src/middleware/requestLogger.ts` — Logs each request as structured JSON using the logger from 1.6
    - _Requirements: 7.9_
  - [x] 2.3 Implement `src/middleware/rateLimiter.ts` — Sliding window rate limiter per IP. Configurable window and max requests. Auth routes: 5/min. General: 100/min. Returns 429 via RateLimitError
    - _Requirements: 2.8, 2.9_
  - [x] 2.4 Implement `src/middleware/validate.ts` — Generic Zod validation middleware factory that validates req.body, req.params, req.query against provided schemas. Returns 400 on failure
    - _Requirements: 7.1_
  - [x] 2.5 Implement `src/middleware/errorHandler.ts` — Global error handler that catches AppError instances and formats them into JSON_Envelope. Unknown errors become 500 with generic message, detailed error logged internally
    - _Requirements: 7.1, 7.3_
  - [x] 2.6 Implement `src/app.ts` — Express app assembly: helmet, cors, JSON body parser, requestId, requestLogger, rateLimiter, routes, errorHandler. Implement `src/server.ts` — entry point that validates env and starts listening
    - _Requirements: 7.4, 7.5_
  - [x] 2.7 Implement health check route at GET /api/v1/health returning `{ success: true, data: { status: "ok" } }`
    - _Requirements: 7.4_
  - [x] 2.8 Write property tests for response envelope and request ID (Property 26)
    - **Property 26: API response envelope conformance** — For any request to any endpoint, response conforms to JSON_Envelope and includes X-Request-Id UUID header
    - **Validates: Requirements 7.1, 7.2**
  - [x] 2.9 Write property test for structured logging (Property 27)
    - **Property 27: Structured log output** — For any API request, log entry contains method, path, statusCode, responseTime
    - **Validates: Requirements 7.9**

- [ ] 3. Database schema and migrations
  - [x] 3.1 Create migration files under `migrations/` for all tables: users, workspaces, workspace_memberships, refresh_tokens, api_credentials, billing, credit_transactions. Each migration has up and down functions
    - Users: UUID PK, email (unique), password_hash, name, avatar_url, created_at, updated_at
    - Workspaces: UUID PK, name, slug (unique), owner_id FK, plan_type enum, created_at, updated_at
    - Workspace_memberships: user_id FK, workspace_id FK, role enum, invited_at, accepted_at, unique(user_id, workspace_id)
    - Refresh_tokens: UUID PK, user_id FK, token_hash, expires_at, revoked_at, created_at
    - API_credentials: UUID PK, workspace_id FK, provider_name, encrypted_key, encrypted_secret, iv, auth_tag, created_by FK, created_at, last_used_at
    - Billing: workspace_id PK/FK, plan_type, credit_balance (CHECK >= 0), credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge, auto_recharge_threshold, auto_recharge_amount
    - Credit_transactions: UUID PK, workspace_id FK, amount, transaction_type enum, description, reference_id nullable, created_at
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9_
  - [x] 3.2 Create all indexes: users_email, workspaces_slug, workspaces_owner_id, wm_user_id, wm_workspace_id, rt_token_hash, rt_user_id, ac_workspace_id, ct_workspace_created(workspace_id, created_at DESC)
    - _Requirements: 1.7_
  - [x] 3.3 Implement a simple migration runner script that executes migrations in order against the configured database
    - _Requirements: 1.8_

- [x] 4. Checkpoint — Verify infrastructure
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Authentication module
  - [x] 5.1 Implement `src/modules/auth/user.repository.ts` — CRUD operations for users table: create (with parameterized queries), findByEmail, findById
    - _Requirements: 2.1, 1.9_
  - [x] 5.2 Implement `src/modules/auth/token.repository.ts` — CRUD for refresh_tokens: create, findByTokenHash, revokeById, revokeAllForUser
    - _Requirements: 2.5, 2.6, 2.7_
  - [x] 5.3 Implement `src/modules/auth/auth.service.ts` — register (bcrypt 12 rounds, check duplicate email → 409), login (verify credentials, issue JWT access + refresh tokens), refresh (validate token, rotate), logout (revoke token)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 5.4 Implement `src/modules/auth/auth.schemas.ts` — Zod schemas for register (email, password, name), login (email, password), refresh (refreshToken), and response types
    - _Requirements: 2.1, 2.3_
  - [x] 5.5 Implement `src/middleware/auth.ts` — JWT verification middleware that extracts Bearer token, verifies, and sets req.user with userId. Skips public routes
    - _Requirements: 2.3, 7.3_
  - [x] 5.6 Implement `src/modules/auth/auth.controller.ts` and `src/modules/auth/auth.routes.ts` — Wire up POST /api/v1/auth/register, /login, /refresh, /logout with validation middleware and rate limiting (5/min)
    - _Requirements: 2.1, 2.3, 2.5, 2.7, 2.8_
  - [x] 5.7 Write property tests for auth (Properties 1, 2, 3, 4, 5)
    - **Property 1: Password hashing round-trip** — For any password, bcrypt hash then compare returns true
    - **Validates: Requirements 2.1**
    - **Property 2: Login token structure** — For any valid user, login returns access token with correct userId and ~15min expiry
    - **Validates: Requirements 2.3**
    - **Property 3: Invalid credentials uniform error** — For any wrong email or wrong password, response is identical 401
    - **Validates: Requirements 2.4**
    - **Property 4: Refresh token rotation** — For any valid refresh token, refresh returns new tokens and old token is rejected
    - **Validates: Requirements 2.5**
    - **Property 5: Logout invalidates token** — For any valid refresh token, after logout it is rejected
    - **Validates: Requirements 2.7**

- [ ] 6. RBAC middleware
  - [x] 6.1 Implement `src/middleware/rbac.ts` — Middleware factory `requireRole(minimumRole: WorkspaceRole)` that checks req.user's membership in the target workspace (from req.params.id) and compares role against ROLE_HIERARCHY. Returns 403 if insufficient role or no membership
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [x] 6.2 Write property tests for RBAC (Properties 6, 7)
    - **Property 6: RBAC role hierarchy enforcement** — For any (requiredRole, userRole) pair, access granted iff ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
    - **Validates: Requirements 3.1, 3.2**
    - **Property 7: RBAC workspace-scoped role** — For any user with different roles in different workspaces, the correct workspace role is used
    - **Validates: Requirements 3.4**

- [ ] 7. Workspace management module
  - [x] 7.1 Implement `src/modules/workspace/workspace.repository.ts` — CRUD for workspaces: create (with slug generation), findById, findAllForUser (via membership join), update, delete
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 7.2 Implement `src/modules/workspace/membership.repository.ts` — CRUD for workspace_memberships: create, findByUserAndWorkspace, findAllForWorkspace, updateRole, delete, countOwners
    - _Requirements: 4.6, 4.7, 4.8, 4.9_
  - [x] 7.3 Implement `src/modules/workspace/workspace.service.ts` — Business logic: create (assign owner, init billing record), list, getById, update, delete (owner only), addMember, removeMember (check last owner), updateMemberRole (check last owner)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 7.4 Implement `src/modules/workspace/workspace.schemas.ts` — Zod schemas for create (name), update (name), addMember (email, role), updateRole (role), and param schemas (id, userId)
    - _Requirements: 4.1, 4.6, 4.8_
  - [x] 7.5 Implement `src/modules/workspace/workspace.controller.ts` and `src/modules/workspace/workspace.routes.ts` — Wire up all workspace endpoints with auth, RBAC, and validation middleware
    - POST /api/v1/workspaces (authenticated)
    - GET /api/v1/workspaces (authenticated)
    - GET /api/v1/workspaces/:id (member+)
    - PUT /api/v1/workspaces/:id (admin+)
    - DELETE /api/v1/workspaces/:id (owner)
    - POST /api/v1/workspaces/:id/members (admin+)
    - DELETE /api/v1/workspaces/:id/members/:userId (admin+)
    - PUT /api/v1/workspaces/:id/members/:userId/role (admin+)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 7.6 Write property tests for workspace management (Properties 8, 9, 10, 11, 12, 13)
    - **Property 8: Workspace creation assigns owner** — For any user creating a workspace, membership with role=owner exists
    - **Validates: Requirements 4.1**
    - **Property 9: Workspace listing returns exactly user's workspaces** — For any user, list returns exactly their memberships
    - **Validates: Requirements 4.2**
    - **Property 10: Member addition creates correct membership** — For any valid add, membership with specified role exists
    - **Validates: Requirements 4.6**
    - **Property 11: Member removal deletes membership** — For any non-last-owner removal, membership no longer exists
    - **Validates: Requirements 4.7**
    - **Property 12: Member role update persists** — For any role update, membership reflects new role
    - **Validates: Requirements 4.8**
    - **Property 13: Last owner protection** — For any workspace with one owner, remove/downgrade is rejected
    - **Validates: Requirements 4.9**

- [x] 8. Checkpoint — Verify auth, RBAC, and workspace
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. API credential management module
  - [x] 9.1 Implement `src/modules/credential/credential.repository.ts` — CRUD for api_credentials: create, findById, findAllByWorkspace, delete, updateLastUsed
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 9.2 Implement `src/modules/credential/credential.service.ts` — store (derive workspace key, encrypt key+secret, persist), list (mask keys to last 4 chars), delete, decrypt (internal only)
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_
  - [x] 9.3 Implement `src/modules/credential/credential.schemas.ts` — Zod schemas for store (providerName, key, secret) and param schemas
    - _Requirements: 5.1_
  - [x] 9.4 Implement `src/modules/credential/credential.controller.ts` and `src/modules/credential/credential.routes.ts` — Wire up credential endpoints with auth, RBAC (admin+), and validation
    - POST /api/v1/workspaces/:id/credentials (admin+)
    - GET /api/v1/workspaces/:id/credentials (member+)
    - DELETE /api/v1/workspaces/:id/credentials/:credId (admin+)
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 9.5 Write property tests for credentials (Properties 15, 16)
    - **Property 15: Credential API responses contain only masked values** — For any credential, list shows masked key (last 4 chars), never raw values
    - **Validates: Requirements 5.2, 5.6**
    - **Property 16: Credential deletion removes from listing** — For any deleted credential, it no longer appears in list
    - **Validates: Requirements 5.3**

- [ ] 10. Credit and billing module
  - [x] 10.1 Implement `src/modules/credit/billing.repository.ts` — CRUD for billing table: create (initialize with zero balance), findByWorkspaceId, updateBalance (with SELECT FOR UPDATE), updateAutoRecharge
    - _Requirements: 6.1, 6.7_
  - [x] 10.2 Implement `src/modules/credit/transaction.repository.ts` — Create transaction record, findByWorkspaceId with pagination (ORDER BY created_at DESC)
    - _Requirements: 6.2, 6.3, 6.8_
  - [x] 10.3 Implement `src/modules/credit/credit.service.ts` — getBilling, addCredits (within transaction: update balance + insert txn), debit (within transaction: SELECT FOR UPDATE, check balance, update, insert txn, check auto-recharge threshold), getTransactions with pagination
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [x] 10.4 Implement `src/modules/credit/credit.schemas.ts` — Zod schemas for addCredits (amount, description), getTransactions (page, limit query params)
    - _Requirements: 6.2, 6.3_
  - [x] 10.5 Implement `src/modules/credit/credit.controller.ts` and `src/modules/credit/credit.routes.ts` — Wire up billing endpoints with auth, RBAC, and validation
    - GET /api/v1/workspaces/:id/billing (member+)
    - POST /api/v1/workspaces/:id/billing/credits (owner)
    - GET /api/v1/workspaces/:id/billing/transactions (member+)
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 10.6 Write property tests for credit system (Properties 19, 20, 21, 22, 23, 24, 25)
    - **Property 19: Credit addition increases balance by exact amount** — For any balance B and amount A, new balance = B + A
    - **Validates: Requirements 6.2**
    - **Property 20: Credit debit decreases balance by exact amount** — For any balance B and amount A <= B, new balance = B - A
    - **Validates: Requirements 6.4**
    - **Property 21: Insufficient credit rejection** — For any amount A > balance B, debit is rejected, balance unchanged
    - **Validates: Requirements 6.5**
    - **Property 22: Transaction listing reverse chronological** — For any workspace, transactions sorted by created_at DESC
    - **Validates: Requirements 6.3**
    - **Property 23: Auto-recharge at threshold** — For any workspace with auto-recharge, debit below threshold triggers recharge
    - **Validates: Requirements 6.6**
    - **Property 24: Concurrent operations correct balance** — For any concurrent ops, final balance = initial + sum of successful ops
    - **Validates: Requirements 6.7**
    - **Property 25: Transaction ledger immutability** — For any transaction, data never changes and count never decreases
    - **Validates: Requirements 6.8**

- [ ] 11. Wire all routes into app and final integration
  - [x] 11.1 Update `src/app.ts` to mount all module routes under `/api/v1/` prefix: auth, workspaces, and nested credential/credit routes. Ensure middleware pipeline order: requestId → requestLogger → helmet → cors → rateLimiter → bodyParser → routes → errorHandler
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 11.2 Write integration tests for end-to-end flows
    - Register → login → create workspace → add member → store credential → add credits → debit → list transactions
    - RBAC enforcement: viewer cannot write, member cannot delete workspace, admin cannot manage billing
    - Rate limiting: 6th auth request within 1 minute returns 429
    - _Requirements: 2.1, 2.3, 3.2, 4.1, 5.1, 6.2, 6.4_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 4, 8, and 12 ensure incremental validation
- Property tests use fast-check with minimum 100 iterations each
- All database operations use parameterized queries (no raw SQL interpolation)
- The credit module's debit function is designed for internal use by future enrichment workflow modules
