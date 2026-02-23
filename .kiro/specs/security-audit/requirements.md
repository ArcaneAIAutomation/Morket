# Requirements Document

## Introduction

This specification defines a comprehensive security audit and hardening phase for the Morket platform. Morket is a GTM data engine handling sensitive business data, third-party API credentials, OAuth tokens, billing information, and web scraping operations across a monorepo (backend, frontend, scraper, infrastructure). The audit systematically identifies security gaps and establishes remediation requirements across authentication, authorization, encryption, input validation, API security, dependency management, infrastructure hardening, secrets management, Content Security Policy, injection prevention, session management, and security event monitoring.

## Glossary

- **Backend**: The Express.js/TypeScript API server in `packages/backend/`
- **Frontend**: The React/TypeScript SPA in `packages/frontend/`
- **Scraper**: The Python/FastAPI browser automation microservice in `packages/scraper/`
- **Auth_Middleware**: The JWT authentication middleware in `packages/backend/src/middleware/auth.ts`
- **RBAC_Middleware**: The role-based access control middleware in `packages/backend/src/middleware/rbac.ts`
- **Rate_Limiter**: The IP-based rate limiting middleware in `packages/backend/src/middleware/rateLimiter.ts`
- **Encryption_Module**: The AES-256-GCM encryption utilities in `packages/backend/src/shared/encryption.ts`
- **Error_Handler**: The global error handling middleware in `packages/backend/src/middleware/errorHandler.ts`
- **Nginx_Config**: The nginx reverse proxy configuration in `docker/nginx.conf`
- **CI_Pipeline**: The GitHub Actions CI workflow in `.github/workflows/ci.yml`
- **Deploy_Pipeline**: The GitHub Actions deployment workflow in `.github/workflows/deploy.yml`
- **Terraform_Modules**: The AWS infrastructure-as-code modules in `terraform/modules/`
- **Secrets_Module**: The Terraform secrets management module in `terraform/modules/secrets/`
- **VPC_Module**: The Terraform VPC and security group module in `terraform/modules/vpc/`
- **Service_Key_Auth**: The X-Service-Key authentication middleware in the Scraper
- **Webhook_Signer**: The HMAC-SHA256 webhook signing mechanism used by Backend and Scraper
- **CSP**: Content Security Policy, an HTTP header that restricts resource loading origins
- **HKDF**: HMAC-based Key Derivation Function used for per-workspace key derivation

## Requirements

### Requirement 1: Authentication Hardening

**User Story:** As a security engineer, I want authentication mechanisms hardened against common attack vectors, so that user accounts and service-to-service communication remain protected.

#### Acceptance Criteria

1. WHEN a login request fails, THE Backend SHALL return a generic error message that does not reveal whether the email or password was incorrect
2. WHEN more than 5 consecutive failed login attempts occur for a single email within 15 minutes, THE Backend SHALL temporarily lock the account and return a rate-limited response
3. THE Auth_Middleware SHALL validate the JWT `iss` (issuer) and `aud` (audience) claims in addition to signature verification
4. WHEN a refresh token is used, THE Backend SHALL invalidate all tokens for the user if the same refresh token is presented more than once (replay detection)
5. THE Backend SHALL store a `jti` (JWT ID) claim in each access token and maintain a revocation list for logout and password change scenarios
6. WHEN a user changes their password, THE Backend SHALL revoke all existing refresh tokens for that user
7. THE Service_Key_Auth SHALL use constant-time string comparison when validating the X-Service-Key header to prevent timing attacks
8. THE Scraper SHALL load the service key from environment configuration at startup rather than using a hardcoded placeholder value

### Requirement 2: Authorization and Access Control Hardening

**User Story:** As a security engineer, I want authorization checks to be comprehensive and consistent, so that privilege escalation and unauthorized data access are prevented.

#### Acceptance Criteria

1. THE RBAC_Middleware SHALL verify that the workspace ID in the URL path matches the workspace ID in the authenticated user context for all workspace-scoped routes
2. WHEN a user with `viewer` role attempts a write operation, THE RBAC_Middleware SHALL reject the request with a 403 status code
3. THE Backend SHALL enforce object-level authorization on all resource endpoints, verifying that the requested resource belongs to the authenticated user workspace
4. WHEN the `/api/v1/admin/search` or `/api/v1/admin/analytics` endpoints are accessed, THE Backend SHALL verify the user holds an `admin` or `owner` role via RBAC_Middleware before the route handler executes
5. THE Backend SHALL validate that the `billing_admin` role can only access billing-related endpoints and cannot perform data operations, enrichment, or workspace management actions
6. THE Frontend SHALL remove sensitive UI elements from the DOM for unauthorized roles rather than only hiding them with CSS

### Requirement 3: Input Validation and Injection Prevention

**User Story:** As a security engineer, I want all user inputs rigorously validated and sanitized, so that injection attacks (SQL, NoSQL, XSS, command injection) are prevented across all services.

#### Acceptance Criteria

1. THE Backend SHALL apply Zod validation schemas to all request body, query parameter, and URL parameter inputs on every route
2. WHEN a Zod validation fails, THE Backend SHALL return a 400 response with field-level error details and reject the request before it reaches the controller
3. THE Backend SHALL sanitize all string inputs against HTML and JavaScript injection by stripping or encoding dangerous characters before storage
4. THE Scraper SHALL validate all incoming request payloads against Pydantic models before processing
5. WHEN the Data_Ops module processes CSV imports, THE Backend SHALL validate each cell value against the target column type schema and reject rows containing formula injection patterns (cells starting with `=`, `+`, `-`, `@`)
6. THE Backend SHALL use parameterized queries exclusively for all PostgreSQL, ClickHouse, and OpenSearch operations with zero raw string interpolation
7. WHEN the AI module parses natural language queries into structured filters, THE Backend SHALL validate the generated filter structure against a whitelist of allowed field names and operators before executing the query
8. THE Scraper SHALL validate and sanitize all URLs provided in scrape requests against an allowlist of URL schemes (http, https only) and reject private/internal IP ranges (RFC 1918, link-local, loopback)

### Requirement 4: API Security Hardening

**User Story:** As a security engineer, I want API endpoints protected against abuse and information leakage, so that the attack surface is minimized.

#### Acceptance Criteria

1. THE Backend SHALL apply route-specific rate limiting: 5/min for auth endpoints, 20/min for enrichment job creation, 100/min for general endpoints, and 10/min for admin endpoints
2. WHEN the Rate_Limiter rejects a request, THE Backend SHALL include a `Retry-After` header in the 429 response indicating when the client may retry
3. THE Backend SHALL set the following HTTP security headers on all responses: `Strict-Transport-Security` (max-age 31536000, includeSubDomains), `X-Content-Type-Options` (nosniff), `X-Frame-Options` (DENY), `X-XSS-Protection` (0), and `Permissions-Policy` (restricting camera, microphone, geolocation)
4. THE Error_Handler SHALL exclude stack traces, internal file paths, and database error details from all error responses in production mode
5. THE Backend SHALL enforce a maximum request body size of 10MB globally and 1MB for JSON payloads to prevent denial-of-service via large payloads
6. THE Backend SHALL disable the `X-Powered-By` header and suppress Express version fingerprinting
7. WHEN the `/api/v1/health`, `/api/v1/readiness`, or `/api/v1/metrics` endpoints are accessed in production, THE Backend SHALL require an API key or restrict access to internal network ranges only
8. THE Backend SHALL implement CORS with an explicit allowlist of origins rather than a single configurable wildcard-capable origin string

### Requirement 5: Encryption and Data Protection

**User Story:** As a security engineer, I want all sensitive data encrypted at rest and in transit with proper key management, so that data breaches have minimal impact.

#### Acceptance Criteria

1. THE Encryption_Module SHALL validate that the master key is exactly 32 bytes before deriving workspace keys, and reject operations with an invalid key length
2. THE Encryption_Module SHALL use a non-empty, unique salt per workspace in the HKDF derivation rather than an empty salt buffer
3. WHEN encrypting credential values, THE Backend SHALL verify the ciphertext can be decrypted successfully before committing to the database (write-verify pattern)
4. THE Backend SHALL encrypt all OAuth tokens (access tokens, refresh tokens) for CRM integrations at rest using per-workspace AES-256-GCM encryption
5. THE Backend SHALL ensure that decrypted credential values, OAuth tokens, and encryption keys are never written to log output at any log level
6. THE Secrets_Module SHALL generate the `encryption_master_key` as a 64-character hex string (32 bytes) to match the Backend validation requirement, not as a random alphanumeric password
7. THE Frontend SHALL store authentication tokens in memory only (Zustand store) and not persist them to localStorage, sessionStorage, or cookies accessible to JavaScript
8. WHEN a workspace is deleted, THE Backend SHALL securely erase all encrypted credentials and OAuth tokens associated with that workspace within the same transaction

### Requirement 6: Dependency and Supply Chain Security

**User Story:** As a security engineer, I want third-party dependencies audited and monitored, so that known vulnerabilities in the supply chain are detected and remediated promptly.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL run `npm audit --audit-level=high` for Backend and Frontend packages and fail the build if high or critical vulnerabilities are found
2. THE CI_Pipeline SHALL run `pip-audit` or `safety check` for Scraper Python dependencies and fail the build if high or critical vulnerabilities are found
3. THE CI_Pipeline SHALL run a container image vulnerability scan (e.g., Trivy) on all Docker images before pushing to ECR
4. THE Deploy_Pipeline SHALL pin all GitHub Actions to specific commit SHAs rather than mutable version tags to prevent supply chain attacks via tag manipulation
5. THE Backend SHALL pin all npm dependencies to exact versions (no `^` or `~` prefixes) in `package.json`
6. THE Scraper SHALL pin all pip dependencies to exact versions in `requirements.txt` with hash verification

### Requirement 7: Infrastructure Security Hardening

**User Story:** As a security engineer, I want infrastructure configurations hardened against misconfigurations and unauthorized access, so that the cloud environment is secure by default.

#### Acceptance Criteria

1. THE VPC_Module SHALL enable VPC flow logs by default (not conditionally) for all environments to ensure network traffic is always auditable
2. THE Terraform_Modules SHALL enable encryption at rest for all data stores: Aurora (storage encryption), Redis (at-rest encryption), OpenSearch (encryption at rest), S3 (SSE-S3 or SSE-KMS), and RabbitMQ (EBS encryption)
3. THE Terraform_Modules SHALL enforce encryption in transit: Aurora (require SSL), Redis (in-transit encryption), OpenSearch (HTTPS enforcement), RabbitMQ (TLS)
4. THE Nginx_Config SHALL redirect all HTTP traffic to HTTPS and include an HSTS header with a minimum max-age of 31536000 seconds
5. THE Nginx_Config SHALL include a Content-Security-Policy header restricting script sources to `self` and trusted CDN origins only
6. WHEN ECS tasks are deployed, THE Terraform_Modules SHALL assign read-only root filesystems to all containers and drop all Linux capabilities except those explicitly required
7. THE Terraform_Modules SHALL configure S3 buckets with `block_public_access` enabled, versioning enabled, and a lifecycle policy for log retention
8. THE VPC_Module SHALL restrict the ECS-to-ECS internal security group rule to specific required ports (3000, 8001, 7233) rather than allowing all ports (0-65535)

### Requirement 8: Secrets Management Hardening

**User Story:** As a security engineer, I want secrets managed securely throughout their lifecycle, so that credential exposure risk is minimized.

#### Acceptance Criteria

1. THE Secrets_Module SHALL enable automatic rotation for all secrets stored in AWS Secrets Manager with a maximum rotation interval of 90 days
2. THE Backend SHALL load secrets from environment variables injected by the container orchestrator and never read secrets from files committed to the repository
3. THE Deploy_Pipeline SHALL verify that no secrets, API keys, or credentials are present in the Docker build context by running a secret scanning step before image builds
4. THE Scraper SHALL not hardcode the service key as `"placeholder"` in the application factory and SHALL fail startup if the `SERVICE_KEY` environment variable is not set
5. WHEN the Backend logs request metadata, THE Backend SHALL redact the `Authorization` header, `X-Service-Key` header, and any request body fields named `password`, `secret`, `token`, or `apiKey`
6. THE CI_Pipeline SHALL include a secret scanning step (e.g., gitleaks or truffleHog) that fails the build if secrets are detected in the codebase

### Requirement 9: Content Security Policy and Frontend Security

**User Story:** As a security engineer, I want the frontend protected against XSS, clickjacking, and data exfiltration, so that client-side attacks are mitigated.

#### Acceptance Criteria

1. THE Nginx_Config SHALL serve a Content-Security-Policy header with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <api-origin>; frame-ancestors 'none'`
2. THE Frontend SHALL sanitize all user-provided content before rendering it in the DOM, including spreadsheet cell values, search results, and workspace names
3. WHEN the Frontend renders enrichment data received from external providers, THE Frontend SHALL escape all HTML entities to prevent stored XSS
4. THE Frontend SHALL implement a strict `referrerPolicy` of `strict-origin-when-cross-origin` on all outbound API requests
5. THE Frontend SHALL validate all deep link parameters and route parameters against expected patterns before using them in API calls or rendering
6. WHEN the Frontend detects a token refresh failure, THE Frontend SHALL clear all in-memory authentication state and redirect to the login page without exposing token values in the URL

### Requirement 10: Session Management and Token Security

**User Story:** As a security engineer, I want session and token lifecycle managed securely, so that session hijacking and token theft risks are minimized.

#### Acceptance Criteria

1. THE Backend SHALL set the access token expiry to a maximum of 15 minutes and the refresh token expiry to a maximum of 7 days, enforced by Zod validation on the environment configuration
2. WHEN a refresh token is within 1 day of expiry, THE Backend SHALL issue a new refresh token with a full 7-day expiry (sliding window) to prevent session drops during active use
3. THE Backend SHALL limit the number of active refresh tokens per user to a maximum of 10, revoking the oldest token when the limit is exceeded
4. WHEN a user logs out, THE Backend SHALL revoke the specific refresh token provided and return a 204 response regardless of whether the token was valid
5. THE Backend SHALL include the user role and workspace ID in the JWT access token claims so that the RBAC_Middleware does not need a database query on every request
6. IF a refresh token is not found in the database during a refresh attempt, THEN THE Backend SHALL revoke all refresh tokens for the associated user as a precaution against token theft

### Requirement 11: Security Logging and Monitoring

**User Story:** As a security engineer, I want security-relevant events logged and monitored, so that attacks and breaches are detected and investigated promptly.

#### Acceptance Criteria

1. WHEN a login attempt fails, THE Backend SHALL log the event with the email address (masked), source IP, user agent, and timestamp at `warn` level
2. WHEN an authorization check fails (403), THE Backend SHALL log the user ID, requested resource, required role, and actual role at `warn` level
3. WHEN a rate limit is triggered, THE Backend SHALL log the source IP, endpoint path, and current request count at `warn` level
4. WHEN a JWT validation fails (expired, invalid signature, malformed), THE Backend SHALL log the failure reason and source IP at `warn` level
5. WHEN the Scraper receives a request with an invalid or missing X-Service-Key, THE Scraper SHALL log the source IP and requested path at `warn` level
6. THE Backend SHALL include the `trace_id` and `span_id` from OpenTelemetry context in all security event log entries for correlation with distributed traces
7. WHEN a webhook signature verification fails, THE Backend SHALL log the source IP, webhook endpoint, and signature mismatch details at `error` level
8. THE Backend SHALL log all credential access events (create, read, update, delete) to the audit log with the acting user ID, workspace ID, and credential ID (never the credential value)

### Requirement 12: Docker and Container Security

**User Story:** As a security engineer, I want container images hardened and running with minimal privileges, so that container escape and lateral movement risks are reduced.

#### Acceptance Criteria

1. THE Backend Dockerfile SHALL use a specific Node.js version tag (e.g., `node:20.11-alpine`) rather than `node:20-alpine` to ensure reproducible builds
2. THE Scraper Dockerfile SHALL use a specific Python version tag (e.g., `python:3.11.7-slim`) rather than `python:3.11-slim` to ensure reproducible builds
3. THE Backend Dockerfile and Scraper Dockerfile SHALL include a `LABEL` with the maintainer, version, and description for image provenance tracking
4. THE Scraper Dockerfile SHALL run Chromium with `--disable-dev-shm-usage` and `--no-sandbox` flags only in the container environment, and SHALL set `--disable-extensions` and `--disable-background-networking` to reduce attack surface
5. WHEN building Docker images, THE CI_Pipeline SHALL scan the final image layers for known CVEs and fail the build if critical vulnerabilities are found
6. THE Docker Compose configuration SHALL not mount the Docker socket or host filesystem paths into any container
7. THE Backend Dockerfile and Scraper Dockerfile SHALL include a `USER` directive running as a non-root user, which is already implemented and SHALL be verified in CI

### Requirement 13: Webhook and External Communication Security

**User Story:** As a security engineer, I want all external communications authenticated and verified, so that webhook spoofing and man-in-the-middle attacks are prevented.

#### Acceptance Criteria

1. WHEN the Backend receives a Stripe webhook, THE Backend SHALL verify the webhook signature using the raw request body before JSON parsing, and reject requests with invalid signatures with a 400 status code
2. WHEN the Backend delivers outbound webhooks, THE Webhook_Signer SHALL include a timestamp in the HMAC payload to prevent replay attacks, and the receiver SHALL reject webhooks older than 5 minutes
3. WHEN the Backend receives an OAuth callback from Salesforce or HubSpot, THE Backend SHALL validate the `state` parameter against the stored state to prevent CSRF attacks on the OAuth flow
4. THE Backend SHALL enforce HTTPS-only URLs for all webhook subscription endpoints and reject HTTP URLs
5. WHEN the Scraper sends webhook callbacks to the Backend, THE Scraper SHALL sign the payload with HMAC-SHA256 and the Backend SHALL verify the signature before processing
6. THE Backend SHALL validate that webhook delivery URLs do not resolve to private/internal IP ranges (RFC 1918, link-local, loopback) to prevent SSRF via webhook endpoints
