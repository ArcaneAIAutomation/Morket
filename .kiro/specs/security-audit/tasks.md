# Implementation Plan: Security Audit

## Overview

Incremental security hardening across the Morket platform. Changes are organized by layer: backend middleware → backend modules → scraper → frontend → infrastructure → CI/CD. Each task builds on previous work, with property-based tests validating correctness properties from the design document. All tasks are required (no optional markers).

## Tasks

- [x] 1. Backend middleware hardening
  - [x] 1.1 Enhance auth middleware with JWT claim validation and jti revocation
    - Modify `packages/backend/src/middleware/auth.ts`
    - Add `issuer: 'morket'` and `audience: 'morket-api'` to `jwt.verify()` options
    - Extract `jti` claim from decoded token and check Redis for revocation (`jti:{jti_value}` key)
    - Wrap Redis revocation check in try/catch for graceful degradation when Redis is unavailable
    - Add invitation accept/decline endpoints to public routes list
    - _Requirements: 1.3, 1.5_

  - [x] 1.2 Write property tests for auth middleware JWT validation
    - **Property 2: JWT claim validation rejects invalid tokens** — for any JWT with incorrect `iss` or `aud`, auth middleware rejects even if signature is valid
    - **Property 3: Access tokens contain required claims** — for any generated access token, decoding reveals `userId`, `jti`, `iss`, `aud`, `role`, `workspaceId` with non-empty values
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 1.3, 1.5, 10.5**

  - [x] 1.3 Enhance RBAC middleware with workspace ID cross-check and object-level auth
    - Modify `packages/backend/src/middleware/rbac.ts`
    - Add workspace ID cross-check: verify `req.params.id` or `req.params.workspaceId` matches the user's authenticated workspace membership
    - Export `requireObjectOwnership()` middleware factory for resource-level authorization
    - Enforce `billing_admin` role restriction to billing-only endpoints
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.4 Write property tests for RBAC middleware
    - **Property 4: RBAC workspace ID cross-check** — for any request where URL workspace ID does not match user's workspace membership, RBAC rejects with 403
    - **Property 5: Role hierarchy enforcement** — viewers cannot write, non-admins cannot access admin endpoints, billing_admin restricted to billing
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5**

  - [x] 1.5 Enhance rate limiter with route-specific limits and Retry-After header
    - Modify `packages/backend/src/middleware/rateLimiter.ts`
    - Add `Retry-After` header (seconds until window reset) to all 429 responses
    - Export `enrichmentRateLimiter` (20/min) and `adminRateLimiter` (10/min) instances
    - _Requirements: 4.1, 4.2_

  - [x] 1.6 Write property tests for rate limiter
    - **Property 10: Rate limiter includes Retry-After header** — for any 429 response, `Retry-After` header is present with a positive numeric value
    - **Property 19: Rate limiter enforces per-route limits** — after exactly `maxRequests` from same IP within window, next request is rejected with 429
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 4.1, 4.2**

  - [x] 1.7 Harden error handler for production mode
    - Modify `packages/backend/src/middleware/errorHandler.ts`
    - Strip stack traces from `AppError` responses when `NODE_ENV === 'production'`
    - Ensure unknown errors return generic `INTERNAL_ERROR` with no internal file paths or DB error details
    - _Requirements: 4.4_

  - [x] 1.8 Write property test for error handler
    - **Property 12: Error responses exclude internal details in production** — for any error in production mode, response body contains no stack traces, file paths, or raw DB errors
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 4.4**

  - [x] 1.9 Create security headers middleware
    - Create `packages/backend/src/middleware/securityHeaders.ts`
    - Set `Strict-Transport-Security: max-age=31536000; includeSubDomains`
    - Set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`
    - Set `Permissions-Policy: camera=(), microphone=(), geolocation=()`
    - Disable `X-Powered-By` header
    - Wire middleware into the Express pipeline in `server.ts` or `app.ts`
    - _Requirements: 4.3, 4.6_

  - [x] 1.10 Write property test for security headers
    - **Property 11: Security headers present on all responses** — for any HTTP response, HSTS (max-age ≥ 31536000), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, and Permissions-Policy are present; X-Powered-By is absent
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 4.3, 4.6**

  - [x] 1.11 Configure request body size limits and CORS allowlist
    - Configure `express.json({ limit: '1mb' })` for JSON payloads
    - Configure `express.raw({ limit: '10mb' })` for file uploads
    - Replace single-origin CORS config with explicit allowlist of origins
    - _Requirements: 4.5, 4.8_

  - [x] 1.12 Write property test for CORS
    - **Property 13: CORS rejects unlisted origins** — for any origin not in the configured allowlist, CORS preflight does not receive `Access-Control-Allow-Origin`
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 4.8**

- [x] 2. Checkpoint — Verify middleware hardening
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Backend auth service and token security
  - [x] 3.1 Harden auth service login and token lifecycle
    - Modify `packages/backend/src/modules/auth/auth.service.ts`
    - Return generic "Invalid credentials" message for both non-existent email and wrong password
    - Add in-memory account lockout tracking (Map-based, 5 attempts / 15 min window)
    - Add `jti` claim (via `crypto.randomUUID()`) to access token generation
    - Add `role` and `workspaceId` claims to access token payload
    - Set `iss: 'morket'` and `aud: 'morket-api'` in token signing
    - _Requirements: 1.1, 1.2, 1.5, 10.5_

  - [x] 3.2 Write property test for generic login errors
    - **Property 1: Generic login error messages** — for any login with non-existent email or incorrect password, the error response message is identical
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 1.1**

  - [x] 3.3 Implement refresh token hardening
    - Modify `packages/backend/src/modules/auth/auth.service.ts`
    - Add refresh token replay detection: if token not found in DB, revoke all tokens for user
    - Add password change → revoke all refresh tokens for user
    - Add sliding window: issue new refresh token if within 1 day of expiry
    - Limit active refresh tokens to 10 per user, revoking oldest when exceeded
    - Logout revokes specific token, returns 204 regardless of token validity
    - _Requirements: 1.4, 1.6, 10.2, 10.3, 10.4, 10.6_

  - [x] 3.4 Write property test for refresh token limits
    - **Property 21: Refresh token limit per user** — after creating more than 10 active refresh tokens, total active tokens ≤ 10 with oldest revoked first
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 10.3**

  - [x] 3.5 Add token expiry Zod validation for environment config
    - Add Zod schema validation for `JWT_ACCESS_EXPIRY` (max 15 min) and `JWT_REFRESH_EXPIRY` (max 7 days) in environment configuration
    - _Requirements: 10.1_

  - [x] 3.6 Write property test for token expiry validation
    - **Property 20: Token expiry Zod validation** — for any env config where access expiry > 15 min or refresh expiry > 7 days, Zod rejects
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 10.1**

- [x] 4. Backend encryption and input sanitization
  - [x] 4.1 Harden encryption module
    - Modify `packages/backend/src/shared/encryption.ts`
    - Add master key length validation (exactly 32 bytes) before HKDF derivation
    - Replace empty salt `Buffer.alloc(0)` with workspace ID hash as HKDF salt
    - Add write-verify pattern: decrypt after encrypt to verify integrity before returning
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 4.2 Write property tests for encryption
    - **Property 14: Master key length validation** — for any Buffer not exactly 32 bytes, `deriveWorkspaceKey()` throws before HKDF
    - **Property 15: Unique workspace key derivation** — for any two distinct workspace IDs with same master key, derived keys differ
    - **Property 16: Encryption round-trip (write-verify)** — for any plaintext and valid 32-byte key, encrypt then decrypt produces original plaintext
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 4.3 Create input sanitization utility
    - Create `packages/backend/src/shared/sanitize.ts`
    - Implement `sanitizeString(input: string): string` — HTML entity encode `<`, `>`, `"`, `'`, `&`
    - Implement `isFormulaInjection(value: string): boolean` — detect cells starting with `=`, `+`, `-`, `@`
    - Implement `validateUrlSafety(url: string): Promise<boolean>` — resolve DNS, reject RFC 1918/loopback/link-local
    - _Requirements: 3.3, 3.5, 3.8, 13.4, 13.6_

  - [x] 4.4 Write property tests for input sanitization
    - **Property 7: HTML sanitization encodes dangerous characters** — for any string with `<`, `>`, `"`, `'`, `&`, output has all encoded, no unescaped HTML tags
    - **Property 8: Formula injection detection** — strings starting with `=`, `+`, `-`, `@` return true; others return false
    - **Property 9: URL scheme and IP range validation** — non-http/https schemes rejected; RFC 1918, loopback, link-local IPs rejected
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 3.3, 3.5, 3.8, 13.4, 13.6**

  - [x] 4.5 Add AI filter whitelist validation
    - Modify `packages/backend/src/modules/ai/` to validate generated filter field names against allowed whitelist and operators against allowed operator set
    - _Requirements: 3.7_

  - [x] 4.6 Write property test for AI filter validation
    - **Property 18: AI filter whitelist validation** — for any structured filter from AI parser, all field names are in allowed whitelist and all operators are in allowed set
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 3.7**

- [x] 5. Checkpoint — Verify auth service and encryption hardening
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Backend security logging and webhook hardening
  - [x] 6.1 Add security event logging and header/field redaction
    - Modify `packages/backend/src/observability/logger.ts`
    - Add header redaction for `Authorization`, `X-Service-Key` in request logs
    - Add field redaction for `password`, `secret`, `token`, `apiKey` in request body logs
    - Add security event logging functions: `logAuthFailure()`, `logAuthzFailure()`, `logRateLimitHit()`, `logWebhookFailure()`
    - Include `trace_id` and `span_id` from OpenTelemetry context in all security event log entries
    - _Requirements: 5.5, 8.5, 11.1, 11.2, 11.3, 11.4, 11.6, 11.7_

  - [x] 6.2 Write property tests for security logging
    - **Property 17: Log redaction of sensitive fields** — for any log entry with `Authorization`, `X-Service-Key`, `password`, `secret`, `token`, `apiKey`, output contains `[REDACTED]` instead of actual values
    - **Property 22: Security event log structure** — for any security event, log entry contains `trace_id`, `span_id`, `timestamp`, `level` (warn/error), and event-specific fields
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 5.5, 8.5, 11.1–11.4, 11.6, 11.7**

  - [x] 6.3 Add credential audit logging
    - Wire audit log entries for all credential CRUD operations (create, read, update, delete) with acting user ID, workspace ID, credential ID — never the credential value
    - _Requirements: 11.8_

  - [x] 6.4 Write property test for credential audit logging
    - **Property 23: Credential audit logging** — for any credential CRUD operation, audit log contains user ID, workspace ID, credential ID, but never the credential value
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 11.8**

  - [x] 6.5 Enhance webhook security with timestamp replay prevention and SSRF protection
    - Modify `packages/backend/src/modules/enrichment/webhook.service.ts`
    - Include timestamp in HMAC payload: `${timestamp}.${JSON.stringify(payload)}`
    - Reject webhooks older than 5 minutes
    - Validate webhook subscription URLs are HTTPS-only
    - Validate webhook URLs do not resolve to private/internal IP ranges using `validateUrlSafety()`
    - _Requirements: 13.2, 13.4, 13.6_

  - [x] 6.6 Write property tests for webhook security
    - **Property 24: Webhook HMAC includes timestamp for replay prevention** — HMAC computed over `${timestamp}.${payload}`, verification rejects webhooks older than 5 minutes
    - **Property 25: Webhook HMAC sign-verify round-trip** — for any payload and secret, signing then verifying with same secret succeeds
    - Add tests to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 13.2, 13.5**

  - [x] 6.7 Wire security event logging into middleware and services
    - Call `logAuthFailure()` in auth middleware on JWT validation failures (with source IP, user agent)
    - Call `logAuthFailure()` in auth service on login failures (with masked email, source IP)
    - Call `logAuthzFailure()` in RBAC middleware on 403 responses (with user ID, resource, required/actual role)
    - Call `logRateLimitHit()` in rate limiter on 429 responses (with source IP, endpoint, request count)
    - Call `logWebhookFailure()` on webhook signature verification failures (with source IP, endpoint)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7_

  - [x] 6.8 Validate Zod schemas on all routes and ensure parameterized queries
    - Audit all backend routes to confirm Zod validation on request body, query params, and URL params
    - Verify all PostgreSQL, ClickHouse, and OpenSearch operations use parameterized queries with zero raw string interpolation
    - Add missing Zod schemas where needed
    - _Requirements: 3.1, 3.2, 3.6_

  - [x] 6.9 Write property test for Zod validation
    - **Property 6: Zod validation returns field-level errors** — for any payload failing Zod validation, response is 400 with field-level error details, request does not reach controller
    - Add test to `packages/backend/tests/property/security.property.test.ts`
    - **Validates: Requirements 3.2**

- [x] 7. Checkpoint — Verify logging and webhook hardening
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Scraper security hardening
  - [x] 8.1 Fix scraper auth middleware for constant-time comparison
    - Modify `packages/scraper/src/middleware/auth.py`
    - Replace `!=` with `hmac.compare_digest()` for service key validation
    - Load service key from `ScraperSettings` (Pydantic settings)
    - Log source IP and requested path on invalid/missing service key at `warn` level
    - _Requirements: 1.7, 11.5_

  - [x] 8.2 Fix scraper app factory to remove hardcoded service key
    - Modify `packages/scraper/src/main.py`
    - Replace hardcoded `"placeholder"` with `settings.backend_service_key` (or equivalent from env)
    - Fail startup if `SERVICE_KEY` environment variable is not set
    - _Requirements: 1.8, 8.4_

  - [x] 8.3 Create scraper URL validator
    - Create `packages/scraper/src/validators/url_validator.py`
    - Validate scrape target URLs: only `http`/`https` schemes allowed
    - Reject private/internal IP ranges (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16; loopback: 127.0.0.0/8; link-local: 169.254.0.0/16)
    - Wire validation into scrape request processing
    - _Requirements: 3.8_

  - [x] 8.4 Write scraper property test for URL validation
    - **Property 9 (scraper): URL scheme and IP range validation** — non-http/https schemes rejected; private/loopback/link-local IPs rejected
    - Add test to `packages/scraper/tests/property/test_security.py` using `hypothesis`
    - **Validates: Requirements 3.8**

  - [x] 8.5 Ensure scraper Pydantic validation on all request payloads
    - Verify all incoming request payloads are validated against Pydantic models before processing
    - _Requirements: 3.4_

- [x] 9. Frontend security hardening
  - [x] 9.1 Create frontend content sanitization utility
    - Create `packages/frontend/src/utils/sanitize.ts`
    - Implement `sanitizeHtml(input: string): string` — escape HTML entities in rendered content
    - Apply sanitization to spreadsheet cell values, search results, workspace names, enrichment data before DOM rendering
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 9.2 Write frontend property test for content sanitization
    - **Property 7 (frontend): HTML sanitization encodes dangerous characters** — for any string with HTML metacharacters, output has all encoded
    - Add test to `packages/frontend/tests/property/security.property.test.ts` using `fast-check`
    - **Validates: Requirements 9.2, 9.3**

  - [x] 9.3 Add deep link parameter validation
    - Create validation utility for route parameters (UUID v4 for IDs, alphanumeric-dash for slugs)
    - Validate all deep link parameters and route parameters before using in API calls or rendering
    - Redirect to 404 page on invalid parameters without making API call
    - _Requirements: 9.5_

  - [x] 9.4 Write frontend property test for deep link validation
    - **Property 26: Deep link parameter validation** — for any route parameter not matching expected pattern (UUID v4 for IDs, alphanumeric-dash for slugs), validator rejects before API call
    - Add test to `packages/frontend/tests/property/security.property.test.ts` using `fast-check`
    - **Validates: Requirements 9.5**

  - [x] 9.5 Add referrer policy and DOM security improvements
    - Add `Referrer-Policy: strict-origin-when-cross-origin` to Axios request headers
    - Ensure unauthorized role UI elements are removed from DOM (not just CSS hidden)
    - Verify token refresh failure clears all in-memory auth state and redirects to login without exposing tokens in URL
    - Verify auth tokens are stored in memory only (Zustand), not in localStorage/sessionStorage/cookies
    - _Requirements: 9.4, 9.6, 2.6, 5.7_

- [x] 10. Checkpoint — Verify scraper and frontend hardening
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Infrastructure hardening
  - [x] 11.1 Harden nginx configuration
    - Modify `docker/nginx.conf`
    - Add HTTP → HTTPS redirect (port 80 → 443)
    - Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` header
    - Add `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <api-origin>; frame-ancestors 'none'`
    - Change `X-Frame-Options` from `SAMEORIGIN` to `DENY`
    - Change `X-XSS-Protection` from `1; mode=block` to `0`
    - _Requirements: 7.4, 7.5, 9.1_

  - [x] 11.2 Harden Dockerfiles
    - Modify `docker/Dockerfile.backend` — pin to specific version tag (e.g., `node:20.11-alpine`), add `LABEL` directives (maintainer, version, description)
    - Modify `docker/Dockerfile.scraper` — pin to specific version tag (e.g., `python:3.11.7-slim`), add `LABEL` directives, add `--disable-extensions` and `--disable-background-networking` to Chromium flags
    - Verify both Dockerfiles have `USER` directive for non-root execution
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7_

  - [x] 11.3 Harden Terraform modules
    - Modify `terraform/modules/vpc/` — enable VPC flow logs unconditionally (remove `count` conditional), restrict ECS internal SG to ports 3000, 8001, 7233
    - Modify `terraform/modules/secrets/` — generate `encryption_master_key` as 64-char hex string using `random_id` instead of `random_password`
    - Verify S3 buckets have `block_public_access`, versioning, lifecycle policies
    - Verify encryption at rest for Aurora, Redis, OpenSearch, RabbitMQ, S3
    - Verify encryption in transit for Aurora (require SSL), Redis, OpenSearch (HTTPS), RabbitMQ (TLS)
    - Verify ECS tasks have read-only root filesystems and dropped Linux capabilities
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 7.8, 8.1_

  - [x] 11.4 Enable automatic secret rotation
    - Modify `terraform/modules/secrets/` to enable automatic rotation for all secrets in AWS Secrets Manager with max 90-day rotation interval
    - _Requirements: 8.1_

  - [x] 11.5 Restrict health/readiness/metrics endpoints in production
    - Add API key or internal network restriction for `/api/v1/health`, `/api/v1/readiness`, `/api/v1/metrics` in production mode
    - _Requirements: 4.7_

- [x] 12. CI/CD pipeline hardening
  - [x] 12.1 Harden CI pipeline
    - Modify `.github/workflows/ci.yml`
    - Add `npm audit --audit-level=high` step to backend and frontend jobs
    - Add `pip-audit` step to scraper job
    - Add Trivy container image scan step for all Docker images
    - Add gitleaks secret scanning step
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 12.5_

  - [x] 12.2 Harden deploy pipeline
    - Modify `.github/workflows/deploy.yml`
    - Pin all GitHub Actions to specific commit SHAs (not mutable version tags)
    - Add secret scanning step before Docker builds
    - Verify no secrets/API keys/credentials in Docker build context
    - _Requirements: 6.4, 8.3_

  - [x] 12.3 Pin dependency versions
    - Verify backend `package.json` uses exact versions (no `^` or `~` prefixes)
    - Verify scraper `requirements.txt` uses exact versions with hash verification
    - _Requirements: 6.5, 6.6_

  - [x] 12.4 Verify Docker Compose security
    - Verify Docker Compose does not mount Docker socket or host filesystem paths into containers
    - _Requirements: 12.6_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all 26 correctness properties have corresponding property-based tests
  - Verify all 13 requirement areas are covered by implementation tasks

## Notes

- All tasks are required — none are optional
- Backend property tests go in `packages/backend/tests/property/security.property.test.ts` using Vitest + fast-check (100+ iterations)
- Frontend property tests go in `packages/frontend/tests/property/security.property.test.ts` using Vitest + fast-check (100+ iterations)
- Scraper property tests go in `packages/scraper/tests/property/test_security.py` using pytest + hypothesis (100+ iterations)
- Each property test must be tagged with `// Feature: security-audit, Property N: <title>` comment
- Checkpoints ensure incremental validation between major phases
- All 26 correctness properties from the design document are covered across tasks 1.2, 1.4, 1.6, 1.8, 1.10, 1.12, 3.2, 3.4, 3.6, 4.2, 4.4, 4.6, 6.2, 6.4, 6.6, 6.9, 8.4, 9.2, 9.4
