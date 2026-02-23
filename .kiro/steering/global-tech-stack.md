---
inclusion: always
---

# Global Tech Stack Standards

This project is building Morket, a modern GTM data engine (Clay.com competitor). All modules must adhere to these technology choices.

## Project Structure

Monorepo using VS Code workspaces:
```
packages/
  backend/     # Express.js API (Modules 1, 2, 5, 6, 8 — COMPLETE)
  scraper/     # Python scraping microservices (Module 3 — COMPLETE)
  frontend/    # React spreadsheet UI (Module 4 — COMPLETE)
docker/        # Dockerfiles, nginx config (Module 7 — COMPLETE)
terraform/     # AWS IaC (Module 7 — COMPLETE)
.github/       # CI/CD pipelines (Module 7 — COMPLETE)
```

## Backend (packages/backend) — COMPLETE
- **Language**: Node.js with TypeScript (strict mode)
- **Framework**: Express.js for API gateway
- **Database (OLTP)**: PostgreSQL (targeting Amazon Aurora compatibility)
- **Database (OLAP)**: ClickHouse with ReplacingMergeTree for analytics
- **Search**: OpenSearch/ElasticSearch for full-text search with fuzzy matching
- **Cache**: Redis (ioredis) with graceful degradation
- **Auth**: JWT-based (15min access, 7d refresh) with bcrypt (12 rounds) and RBAC middleware
- **Encryption**: AES-256-GCM with HKDF per-workspace key derivation
- **Validation**: Zod schemas at middleware level for all request payloads
- **Testing**: Vitest + fast-check (property-based) + supertest (HTTP integration)
- **Architecture**: Layered — Routes → Controllers → Services → Repositories
- **Modules**: auth, workspace, credential, credit, enrichment, billing, integration, data-ops, workflow, ai, team, analytics, search, replication (each self-contained with own routes/controller/service/schemas/repository)
- **Workflow Engine**: Temporal.io for durable enrichment workflows
- **Provider Adapters**: Apollo, Clearbit, Hunter with pluggable adapter interface
- **Circuit Breaker**: In-memory sliding window circuit breaker for external provider calls
- **Webhook Delivery**: HMAC-SHA256 signed webhooks with retry logic and exponential backoff
- **Billing**: Stripe integration for subscriptions, credit purchases, webhooks
- **CRM Integrations**: Salesforce & HubSpot via OAuth2 with encrypted token storage
- **Observability**: Structured JSON logger, in-memory metrics, /readiness and /metrics endpoints
- **Distributed Tracing**: OpenTelemetry SDK with auto-instrumentation for HTTP, Express, PostgreSQL, Redis; OTLP exporter; log-trace correlation via trace_id/span_id
- **Migrations**: 22 sequential numbered files under `packages/backend/migrations/`

## Frontend (packages/frontend) — COMPLETE
- **Framework**: React 18+ with TypeScript (strict mode)
- **Build**: Vite 6 with `@vitejs/plugin-react`, dev proxy to backend on port 3000
- **State Management**: Zustand 5 (one store per domain: auth, grid, workspace, job, analytics, search, ui)
- **Grid/Spreadsheet**: AG Grid v32 (ag-grid-react) with DOM virtualization for 100k+ rows
- **Charts**: Recharts 3 for analytics dashboards
- **Routing**: React Router DOM v6 with lazy-loaded routes and AuthGuard — all routes wired (spreadsheet, jobs, analytics, search, settings with nested tabs)
- **HTTP Client**: Axios with dual instances (30s standard, 120s enrichment), auto token refresh, envelope unwrapping
- **Validation**: Zod for client-side form schemas
- **Styling**: Tailwind CSS 3 with AG Grid theme overrides
- **Testing**: Vitest + Testing Library + MSW (API mocking) + fast-check (8 property test suites)
- **Web Workers**: CSV parse/generate off main thread for datasets ≥10k rows
- **Features**: Spreadsheet with undo (50-deep), auto-save (30s), context menus, column management, CSV import/export, enrichment job polling (5s), enrichment panel slide-over with "Enrich Selected" toolbar button, analytics dashboard (enrichment/scraping/credits tabs), full-text search with facets and typeahead, role-based UI permissions, offline detection, settings pages (workspace/billing/credentials/members)

## Scraping Microservices (packages/scraper) — COMPLETE
- **Language**: Python 3.11+
- **Browser Automation**: Playwright (headless Chromium)
- **Framework**: FastAPI with automatic OpenAPI docs
- **Validation**: Pydantic v2 models and Settings
- **Testing**: pytest + pytest-asyncio + hypothesis (property-based)
- **Linting**: Black + Ruff
- **Containerization**: Docker multi-stage build with resource limits (2 CPU, 4GB RAM)
- **Architecture**: FastAPI routers → Services → Browser Pool / Extractors / Proxy Manager
- **Components**: Browser Pool, Page Extractors (pluggable), Proxy Manager, Fingerprint Randomizer, Domain Rate Limiter, Circuit Breaker, Credential Client, Result Normalizer, Task Queue (asyncio)
- **Integration**: Acts as enrichment provider callable by backend Temporal.io workflows via REST API
- **Auth**: Service-to-service via X-Service-Key header
- **Webhook Delivery**: HMAC-SHA256 signed callbacks with retry logic

## Infrastructure — COMPLETE
- **Containerization**: Docker multi-stage builds for all services
- **IaC**: Terraform with 13 reusable AWS modules (VPC, ECS, ALB, Aurora, ClickHouse, Redis, RabbitMQ, OpenSearch, S3, CloudFront, ECR, Secrets, Monitoring)
- **CI/CD**: GitHub Actions (CI with path-filtered jobs, Deploy with ECR push + ECS rolling deploy + production approval gate)
- **Cloud**: AWS (ECS Fargate, Aurora, ElastiCache Redis, Amazon MQ RabbitMQ, OpenSearch Service, S3, CloudFront)
- **Monitoring**: CloudWatch alarms + dashboard, SNS notifications

## Coding Standards
- All API routes must have input validation (zod for TypeScript, pydantic for Python)
- All database operations must use parameterized queries (no raw SQL interpolation)
- All secrets/credentials must be encrypted at rest and never committed to source control
- All API endpoints must return consistent JSON response envelopes: `{ success, data, error, meta }`
- Use ESLint + Prettier for TypeScript, Black + Ruff for Python
- Write unit tests for all business logic; property-based tests for data transformation logic
- All new backend modules follow the existing pattern: `src/modules/<name>/` with routes, controller, service, schemas, repository files
- Scraper extractors follow pluggable registry pattern — adding a new target type requires only registering an extractor module
- Never log or persist decrypted credential values in any service
- OAuth tokens for CRM integrations must be encrypted at rest using per-workspace AES-256-GCM encryption
- Redis cache operations must be wrapped in try/catch for graceful degradation when Redis is unavailable

## Security Hardening (Security Audit — COMPLETE)
- **Auth**: JWT tokens include `iss: 'morket'`, `aud: 'morket-api'`, `jti` (revocable via Redis), `role`, `workspaceId` claims
- **Account lockout**: In-memory tracking, 5 failed attempts / 15 min window
- **Refresh tokens**: Replay detection (revokes all on reuse), max 10 per user, sliding window renewal, password change revokes all
- **Token expiry validation**: Zod enforces max 15min access / 7d refresh at config level
- **RBAC**: Workspace ID cross-check on URL params, object-level ownership middleware, billing_admin restricted to billing endpoints
- **Rate limiting**: Route-specific limits (auth 5/min, enrichment 20/min, admin 10/min, general 100/min), `Retry-After` header on 429s
- **Security headers**: HSTS, X-Content-Type-Options, X-Frame-Options: DENY, Permissions-Policy, X-Powered-By disabled
- **Error handling**: Stack traces and internal paths stripped in production mode
- **CORS**: Explicit origin allowlist (not wildcard)
- **Body limits**: 1MB JSON, 10MB file uploads
- **Input sanitization**: HTML entity encoding (`sanitizeString`), CSV formula injection detection (`isFormulaInjection`), SSRF prevention (`validateUrlSafety`)
- **AI filter validation**: Field name whitelist and operator set enforcement on AI-generated filters
- **Encryption**: Master key length validation (32 bytes), workspace ID hash as HKDF salt, write-verify pattern
- **Security logging**: Header/field redaction (`[REDACTED]`), security event functions (`logAuthFailure`, `logAuthzFailure`, `logRateLimitHit`, `logWebhookFailure`), credential audit logging, trace_id/span_id correlation
- **Webhook security**: Timestamp in HMAC payload, 5-minute replay window, HTTPS-only subscription URLs, SSRF protection
- **Scraper**: Constant-time service key comparison (`hmac.compare_digest`), URL validation (scheme + private IP rejection), no hardcoded keys
- **Frontend**: HTML sanitization on rendered content, deep link parameter validation (UUID/slug patterns), Referrer-Policy header, tokens in memory only
- **Infrastructure**: Nginx HTTPS redirect + HSTS + CSP + X-Frame-Options DENY, Dockerfiles pinned to specific versions with LABEL directives, Terraform VPC flow logs unconditional, ECS SG restricted to app ports, encryption at rest/transit verified, secret rotation (90-day)
- **CI/CD**: `npm audit` + `pip-audit` in CI, Trivy container scanning, gitleaks secret scanning, GitHub Actions pinned to commit SHAs, Docker build context secret verification
- **Dependencies**: All versions pinned (no `^`/`~`/`>=` prefixes)
- **Docker Compose**: No socket/host mounts, read-only root filesystem + no-new-privileges on app containers
- **Property tests**: 26 correctness properties with 100+ iterations each across backend (fast-check), frontend (fast-check), and scraper (hypothesis)
