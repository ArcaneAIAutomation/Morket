# Morket

A production-grade GTM (Go-To-Market) data engine — think Clay.com, built from scratch. Morket orchestrates multi-provider data enrichment, headless browser scraping, and real-time analytics through a dual-database architecture, all wrapped in a spreadsheet UI that handles 100k+ rows without breaking a sweat.

14 self-contained backend modules. 6 layers of defense-in-depth security. 59 formally specified correctness properties. 400+ tests. One monorepo.

## What is Morket?

Morket helps sales and marketing teams enrich their prospect data by orchestrating calls to multiple data providers (Apollo, Clearbit, LinkedIn, etc.) through a unified platform. It combines a durable workflow engine (Temporal.io), a headless scraping fleet (Playwright), and a consumption-based credit system into a single cohesive product. Teams get:

- **Multi-tenant workspaces** to organize enrichment activities
- **Encrypted credential storage** for third-party API keys (AES-256-GCM, per-workspace key derivation)
- **Consumption-based billing** with Stripe subscriptions and credit packs
- **Role-based access control** across workspace members (owner, admin, member, viewer, billing_admin)
- **A spreadsheet-like UI** for managing and enriching data (AG Grid with 100k+ row support)
- **CRM integrations** with Salesforce and HubSpot (OAuth2, bi-directional sync)
- **Visual workflow builder** for multi-step enrichment pipelines
- **AI-powered intelligence** — quality scoring, field mapping, duplicate detection, natural language queries
- **Web scraping** via headless Chromium with anti-detection, proxy rotation, and domain rate limiting
- **Dual-database analytics** — PostgreSQL for OLTP, ClickHouse for OLAP, with CDC replication between them
- **Full-text search** with fuzzy matching, faceted filtering, and typeahead via OpenSearch

## Security

Morket implements defense-in-depth security across six layers — from infrastructure hardening down to supply chain verification. Every layer is backed by formally specified correctness properties validated through property-based testing.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 6: Supply Chain                                          │
│  Pinned deps · npm/pip audit · Trivy · Gitleaks · SHA Actions  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: Observability & Audit                                 │
│  Redacted logs · Security events · Trace correlation · Audit   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: Data Protection                                       │
│  AES-256-GCM · HKDF · XSS encoding · SSRF prevention · CSV    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Authentication & Authorization                        │
│  JWT (iss/aud/jti) · Lockout · Replay detection · RBAC · 5 roles│
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: API Gateway                                           │
│  Rate limiting · Security headers · CORS allowlist · Body limits│
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Edge & Infrastructure                                 │
│  HTTPS/HSTS · CSP · Pinned images · Read-only FS · VPC · KMS  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1: Edge & Infrastructure

- HTTPS everywhere with HSTS (1-year max-age, includeSubDomains)
- Content Security Policy preventing XSS and clickjacking
- Pinned Docker base images with provenance labels
- Read-only container filesystems with dropped Linux capabilities (`no-new-privileges`)
- VPC flow logs, restricted security groups (ports 3000/8001/7233 only)
- Encryption at rest for Aurora, Redis, OpenSearch, RabbitMQ, and S3
- Encryption in transit via TLS/SSL on all inter-service communication
- Automatic secret rotation on a 90-day interval via AWS Secrets Manager

### Layer 2: API Gateway

- Route-specific rate limiting — auth: 5/min, enrichment: 20/min, admin: 10/min, general: 100/min — with `Retry-After` headers on 429 responses
- Security headers: HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera/microphone/geolocation disabled), `X-Powered-By` removed
- CORS with explicit origin allowlist (no wildcards)
- Request body limits: 1MB JSON, 10MB file uploads
- Production error sanitization — stack traces, file paths, and raw database errors are stripped from all client-facing responses

### Layer 3: Authentication & Authorization

- JWT tokens with `iss`/`aud` validation, unique token IDs (`jti`), and Redis-based revocation list
- Account lockout after 5 failed login attempts within a 15-minute window
- Generic error messages on login failure — prevents user enumeration for both non-existent emails and wrong passwords
- Refresh token replay detection — if a previously used token is presented, all tokens for that user are immediately revoked
- Maximum 10 active refresh tokens per user with FIFO eviction of oldest tokens
- Token expiry enforced at the config level via Zod schemas (max 15min access, max 7d refresh)
- RBAC with workspace ID cross-check on URL parameters, object-level ownership middleware, and billing_admin isolation
- 5 role tiers: `owner` > `admin` > `member` > `viewer` + `billing_admin`

### Layer 4: Data Protection

- AES-256-GCM encryption with HKDF per-workspace key derivation
- Master key validation (exactly 32 bytes) with workspace ID hash as HKDF salt
- Write-verify pattern: every encrypted value is decrypted immediately after write to confirm integrity
- HTML entity encoding on all rendered content (XSS prevention)
- CSV formula injection detection — blocks cells starting with `=`, `+`, `-`, `@`
- SSRF prevention via DNS resolution and private IP range rejection (RFC 1918, loopback, link-local)
- AI-generated filter validation against a field name whitelist and operator set

### Layer 5: Observability & Audit

- Sensitive header redaction: `Authorization`, `X-Service-Key` → `[REDACTED]`
- Sensitive field redaction: `password`, `secret`, `token`, `apiKey` → `[REDACTED]`
- Security event logging with OpenTelemetry `trace_id`/`span_id` correlation
- Dedicated logging functions: `logAuthFailure`, `logAuthzFailure`, `logRateLimitHit`, `logWebhookFailure`
- Credential CRUD audit trail — logs user ID, workspace ID, and credential ID, never the credential value
- Webhook HMAC includes timestamp in the signed payload for replay prevention (5-minute window)

### Layer 6: Supply Chain

- All npm and pip dependencies pinned to exact versions — no `^`, `~`, or `>=` ranges
- `npm audit` + `pip-audit` run in CI on every build
- Trivy container image scanning for CRITICAL and HIGH CVEs
- Gitleaks secret scanning on every PR and deploy
- GitHub Actions pinned to commit SHAs (not mutable version tags)
- Docker build context verified clean of `.env` files and secret patterns

### Formal Verification

26 security correctness properties are defined as formal specifications and validated through property-based testing with 100+ iterations per property:

| Layer | Framework | Properties | Coverage |
|-------|-----------|------------|----------|
| Backend | fast-check | 15 | Auth, RBAC, rate limiting, encryption, sanitization, logging, webhooks |
| Frontend | fast-check | 2 | Deep link validation, content sanitization |
| Scraper | hypothesis | 9 | URL validation, key comparison, credential handling, webhook signing |

These properties are not example-based tests — they generate randomized inputs across the entire input space to verify that security invariants hold universally.

## Why Morket?

This isn't a CRUD app with a login page. Morket is a full-stack data platform built to production standards:

- **14 self-contained backend modules** following clean architecture (Routes → Controllers → Services → Repositories)
- **Dual-database architecture** — PostgreSQL for OLTP, ClickHouse (ReplacingMergeTree) for OLAP, with CDC replication
- **Temporal.io** for durable, fault-tolerant enrichment workflows with idempotency keys and cancellation signals
- **Headless browser scraping** with anti-detection (fingerprint randomization, webdriver masking), proxy rotation, and per-domain rate limiting
- **AG Grid spreadsheet** handling 100k+ rows with DOM virtualization, undo stack, auto-save, and Web Worker CSV processing
- **59 correctness properties** validated by property-based tests (33 enrichment/core + 26 security) across three frameworks
- **Full AWS infrastructure as code** — 13 Terraform modules, GitHub Actions CI/CD with path-filtered builds and production approval gates
- **Defense-in-depth security** across 6 layers, from HSTS and CSP at the edge to pinned dependencies and container scanning in the supply chain

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Client / SDK                         │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│                   API Gateway (Express.js)               │
│  Rate Limiter → Request ID → Tracing → Logger → Helmet/CORS  │
│  → Auth (JWT) → RBAC → Zod Validation → Router          │
└──────────────────────────┬──────────────────────────────┘
                           │
   ┌──────────┬────────────┴────────────┬──────────┐
   ▼          ▼                         ▼          ▼
Auth      Workspace              Credential   Credit/Billing
Module     Module                 Module       Module
   │          │                         │          │
   └──────────┴────────────┬────────────┴──────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │   Enrichment Module     │
              │  ┌───────────────────┐  │
              │  │ Provider Registry │  │
              │  │ Circuit Breaker   │  │
              │  │ Webhook Service   │  │
              │  └───────────────────┘  │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │    Temporal.io Worker    │
              │  Workflows + Activities  │
              └────────────┬────────────┘
                           │
          ┌────────────────┼────────────────┬──────────────────┐
          ▼                ▼                ▼                  ▼
     Apollo API      Clearbit API     Hunter API     Scraper Service
                                                    (Python/FastAPI)
                                                          │
                                              ┌───────────┼───────────┐
                                              ▼           ▼           ▼
                                        Browser Pool  Proxy Mgr  Extractors
                                        (Playwright)  (Rotation)  (Pluggable)
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                                LinkedIn  Company    Job Board
                                Profiles  Websites   Postings
```

The backend follows a layered architecture: **Routes → Controllers → Services → Repositories**, with each domain (auth, workspace, credential, credit, enrichment, billing, integration, data-ops, workflow, ai, team, analytics, search, replication) as a self-contained module.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, TypeScript (strict), Express.js |
| Database (OLTP) | PostgreSQL (Aurora-compatible) |
| Database (OLAP) | ClickHouse (ReplacingMergeTree) |
| Search | OpenSearch/ElasticSearch |
| Cache | Redis (ioredis) with graceful degradation |
| Workflow Engine | Temporal.io (durable enrichment workflows) |
| Billing | Stripe (subscriptions, credit packs, webhooks) |
| Auth | JWT (15min access / 7d refresh) with bcrypt (12 rounds) |
| Encryption | AES-256-GCM with HKDF per-workspace key derivation |
| Validation | Zod (backend + frontend), Pydantic (scraper) |
| Testing | Vitest + fast-check (TypeScript), pytest + hypothesis (Python) |
| Distributed Tracing | OpenTelemetry (HTTP, Express, PostgreSQL, Redis auto-instrumentation) |
| Scraping | Python 3.11+, FastAPI, Playwright (headless Chromium) |
| Frontend | React 18+, Zustand 5, AG Grid v32, Recharts, Tailwind CSS |
| Infrastructure | Docker, Terraform (13 modules), GitHub Actions, AWS (ECS Fargate, Aurora, ElastiCache, OpenSearch, S3, CloudFront) |

## Current Status: Complete ✅

All 8 modules are complete, plus a comprehensive security audit. Application code (Modules 1–6) covers the full backend API, enrichment orchestration, scraping microservices, spreadsheet UI, OLAP analytics, and search layer. Module 7 provides Docker containerization, Terraform IaC for AWS, and GitHub Actions CI/CD. Module 8 adds Stripe billing, CRM integrations, advanced data operations, workflow builder, AI/ML intelligence, team collaboration, Redis caching, and observability. The security audit hardens all layers with 26 property-based correctness tests.

### What's built

#### Module 1: Core Backend Foundation
- **JWT Authentication** — Register, login, refresh token rotation, logout. Bcrypt (12 rounds), rate-limited auth endpoints (5/min per IP).
- **RBAC Middleware** — Role hierarchy (owner > admin > member > viewer), workspace-scoped permissions enforced at the middleware level.
- **Workspace Management** — CRUD with slug generation, member management (add/remove/update role), last-owner protection.
- **Encrypted Credential Storage** — AES-256-GCM with HKDF per-workspace key derivation. API responses only expose masked keys (last 4 chars).
- **Credit/Billing System** — Consumption-based credits with `SELECT FOR UPDATE` concurrency control, auto-recharge, immutable transaction ledger, paginated history.
- **API Infrastructure** — Consistent JSON envelope responses, X-Request-Id tracing, structured JSON logging, Helmet security headers, CORS, sliding-window rate limiting.

#### Module 2: Enrichment Orchestration
- **Provider Registry** — In-memory registry with Apollo, Clearbit, and Hunter providers. Each provider has Zod input/output schemas, credit costs, and supported fields.
- **Provider Adapters** — Pluggable adapter interface (`ProviderAdapter`) with HTTP calls, 30s timeouts, and error mapping.
- **Circuit Breaker** — Sliding window (10 calls, 5 failure threshold, 60s cooldown) per provider to protect against cascading failures.
- **Enrichment Jobs** — Create, list, get, and cancel enrichment jobs. Input validation, credit estimation, balance checking, and batch splitting (1000 records max).
- **Temporal.io Workflows** — Durable enrichment workflows with waterfall provider logic, idempotency keys, cancellation signals, and automatic status tracking.
- **Webhook Delivery** — HMAC-SHA256 signed webhooks with 10s timeout and 3 retries with exponential backoff (5s, 10s, 20s).
- **Database Migrations** — 11 sequential migration files covering all tables and indexes.
- **33 Correctness Properties** — Property-based tests using fast-check validating circuit breaker, waterfall, idempotency, and credit invariants.

### API Endpoints

```
# Auth (public, 5/min rate limit)
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

# Workspaces (authenticated)
POST   /api/v1/workspaces
GET    /api/v1/workspaces
GET    /api/v1/workspaces/:id                    # member+
PUT    /api/v1/workspaces/:id                    # admin+
DELETE /api/v1/workspaces/:id                    # owner
POST   /api/v1/workspaces/:id/members            # admin+
DELETE /api/v1/workspaces/:id/members/:userId     # admin+
PUT    /api/v1/workspaces/:id/members/:userId/role # admin+

# Credentials (authenticated)
POST   /api/v1/workspaces/:id/credentials         # admin+
GET    /api/v1/workspaces/:id/credentials         # member+
DELETE /api/v1/workspaces/:id/credentials/:credId  # admin+

# Billing (authenticated)
GET    /api/v1/workspaces/:id/billing              # member+
POST   /api/v1/workspaces/:id/billing/credits      # owner
GET    /api/v1/workspaces/:id/billing/transactions  # member+

# Providers (authenticated)
GET    /api/v1/providers                           # list all providers
GET    /api/v1/providers/:providerSlug             # provider details

# Enrichment Jobs (authenticated)
POST   /api/v1/workspaces/:id/enrichment-jobs              # member+
GET    /api/v1/workspaces/:id/enrichment-jobs              # member+
GET    /api/v1/workspaces/:id/enrichment-jobs/:jobId       # member+
POST   /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel # member+
GET    /api/v1/workspaces/:id/enrichment-jobs/:jobId/records # member+

# Enrichment Records (authenticated)
GET    /api/v1/workspaces/:id/enrichment-records/:recordId  # member+

# Webhooks (authenticated)
POST   /api/v1/workspaces/:id/webhooks             # admin+
GET    /api/v1/workspaces/:id/webhooks             # member+
DELETE /api/v1/workspaces/:id/webhooks/:webhookId   # admin+

# Analytics (authenticated, workspace-scoped)
GET    /api/v1/workspaces/:id/analytics/enrichment   # enrichment success rates
GET    /api/v1/workspaces/:id/analytics/credits       # credit usage analytics
GET    /api/v1/workspaces/:id/analytics/export        # CSV export

# Search (authenticated, workspace-scoped)
POST   /api/v1/workspaces/:id/search                  # full-text search
GET    /api/v1/workspaces/:id/search/suggest           # typeahead/autocomplete

# Search Admin (authenticated, admin only)
POST   /api/v1/admin/search/reindex                    # trigger reindex
GET    /api/v1/admin/search/status                     # index status

# Admin DLQ (authenticated, admin only)
GET    /api/v1/admin/analytics/dlq                     # dead letter queue entries
POST   /api/v1/admin/analytics/dlq/:id/retry           # retry failed event

# Health
GET    /api/v1/health
GET    /api/v1/readiness
GET    /api/v1/metrics

# Billing (Stripe)
GET    /api/v1/billing/plans                                    # public plan listing
POST   /api/v1/billing/webhooks                                 # Stripe webhook (raw body)
POST   /api/v1/workspaces/:id/billing/checkout                  # create Stripe Checkout session
POST   /api/v1/workspaces/:id/billing/portal                    # create Stripe Customer Portal
POST   /api/v1/workspaces/:id/billing/credits/purchase           # purchase credit pack
GET    /api/v1/workspaces/:id/billing/invoices                   # list invoices

# CRM Integrations
GET    /api/v1/integrations                                      # list available integrations
GET    /api/v1/integrations/callback                             # OAuth callback
POST   /api/v1/workspaces/:id/integrations/:provider/connect     # start OAuth flow
POST   /api/v1/workspaces/:id/integrations/:provider/disconnect  # disconnect
GET    /api/v1/workspaces/:id/integrations/:provider/field-mappings
PUT    /api/v1/workspaces/:id/integrations/:provider/field-mappings
POST   /api/v1/workspaces/:id/integrations/:provider/push        # push records to CRM
POST   /api/v1/workspaces/:id/integrations/:provider/pull        # pull records from CRM
GET    /api/v1/workspaces/:id/integrations/:provider/sync-history

# Data Operations
POST   /api/v1/workspaces/:id/data-ops/import/preview            # CSV preview
POST   /api/v1/workspaces/:id/data-ops/import/commit             # commit import
POST   /api/v1/workspaces/:id/data-ops/export                    # export CSV/JSON
POST   /api/v1/workspaces/:id/data-ops/dedup/scan                # find duplicates
POST   /api/v1/workspaces/:id/data-ops/dedup/merge               # merge duplicates
GET    /api/v1/workspaces/:id/data-ops/hygiene                   # data hygiene stats
POST   /api/v1/workspaces/:id/data-ops/bulk-delete               # bulk delete records
GET    /api/v1/workspaces/:id/data-ops/views                     # saved views CRUD
POST   /api/v1/workspaces/:id/data-ops/views
PUT    /api/v1/workspaces/:id/data-ops/views/:viewId
DELETE /api/v1/workspaces/:id/data-ops/views/:viewId
GET    /api/v1/workspaces/:id/data-ops/activity                  # record activity log

# Workflow Builder
POST   /api/v1/workspaces/:id/workflows                          # create workflow
GET    /api/v1/workspaces/:id/workflows                          # list workflows
GET    /api/v1/workspaces/:id/workflows/:workflowId              # get workflow
PUT    /api/v1/workspaces/:id/workflows/:workflowId              # update workflow
DELETE /api/v1/workspaces/:id/workflows/:workflowId              # delete workflow
GET    /api/v1/workspaces/:id/workflows/:workflowId/versions     # list versions
POST   /api/v1/workspaces/:id/workflows/:workflowId/rollback     # rollback to version
POST   /api/v1/workspaces/:id/workflows/:workflowId/execute      # execute workflow
GET    /api/v1/workspaces/:id/workflows/:workflowId/runs         # list runs
GET    /api/v1/workspaces/:id/workflows/templates                 # list templates
POST   /api/v1/workspaces/:id/workflows/templates/:templateId/clone
PUT    /api/v1/workspaces/:id/workflows/:workflowId/schedule     # set cron schedule

# AI/ML Intelligence
POST   /api/v1/workspaces/:id/ai/quality-score                   # score records
POST   /api/v1/workspaces/:id/ai/field-map                       # auto field mapping
POST   /api/v1/workspaces/:id/ai/dedup-detect                    # fuzzy duplicate detection
POST   /api/v1/workspaces/:id/ai/query                           # natural language query

# Team & Collaboration
GET    /api/v1/workspaces/:id/team/activity                      # activity feed
POST   /api/v1/workspaces/:id/team/activity                      # log activity
GET    /api/v1/workspaces/:id/team/audit-log                     # audit log
GET    /api/v1/workspaces/:id/team/audit-log/export              # export audit CSV
POST   /api/v1/workspaces/:id/team/invitations                   # invite by email
GET    /api/v1/workspaces/:id/team/invitations                   # list invitations
DELETE /api/v1/workspaces/:id/team/invitations/:invitationId     # revoke invitation
POST   /api/v1/invitations/:token/accept                         # accept (public)
POST   /api/v1/invitations/:token/decline                        # decline (public)
```

### Scraper Service Endpoints (packages/scraper — Module 3)

```
# Scrape Tasks (service-to-service, X-Service-Key auth)
POST   /api/v1/scrape                          # async scrape task
POST   /api/v1/scrape/sync                     # sync scrape (60s timeout)
GET    /api/v1/scrape/:taskId                   # task status + result

# Scrape Jobs (batch)
POST   /api/v1/scrape/batch                    # batch up to 100 targets
GET    /api/v1/scrape/jobs/:jobId              # job status + progress
GET    /api/v1/scrape/jobs/:jobId/results      # completed task results
POST   /api/v1/scrape/jobs/:jobId/cancel       # cancel queued tasks

# Health & Observability
GET    /health                                  # service + pool + proxy status
GET    /readiness                               # browser pool + proxy readiness
GET    /metrics                                 # queue depth, active workers, task stats
```

All responses follow the envelope format:
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "page": 1, "limit": 20, "total": 42 }
}
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+ (optional — backend degrades gracefully without it)
- Temporal.io server (for enrichment workflows)
- Python 3.11+ (for scraper service)
- Playwright (installed via `playwright install chromium`)

### Setup

```bash
# Clone
git clone https://github.com/ArcaneAIAutomation/Morket.git
cd Morket

# Install dependencies
cd packages/backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, JWT secret, etc.

# Run migrations
npm run migrate

# Start development server
npm run dev

# Run tests
npm test
```

### Environment Variables

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/morket
JWT_SECRET=your-jwt-secret-min-32-chars-long
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
ENCRYPTION_MASTER_KEY=<64 hex chars>
CORS_ORIGIN=http://localhost:5173
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
CLICKHOUSE_URL=http://localhost:8123
OPENSEARCH_NODE=http://localhost:9200
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

## Project Structure

```
packages/
├── backend/                           # Express.js API (Modules 1–2, 5–6, 8)
│   ├── src/
│   │   ├── cache/                     # Redis client + generic cache layer
│   │   ├── clickhouse/                # ClickHouse client + health check
│   │   ├── config/env.ts              # Zod-validated env config
│   │   ├── middleware/                 # Auth, RBAC, validation, rate limiting, logging, errors, tracing
│   │   ├── observability/             # Structured JSON logger + in-memory metrics + OpenTelemetry tracing
│   │   ├── modules/
│   │   │   ├── auth/                  # User registration, login, JWT, refresh tokens
│   │   │   ├── workspace/             # Workspace CRUD, membership management
│   │   │   ├── credential/            # Encrypted API credential storage
│   │   │   ├── credit/                # Credits, transaction ledger
│   │   │   ├── enrichment/            # Enrichment orchestration (adapters, temporal, circuit breaker)
│   │   │   ├── billing/               # Stripe subscriptions, credit purchases, webhooks
│   │   │   ├── integration/           # CRM integrations (Salesforce, HubSpot) with OAuth2
│   │   │   ├── data-ops/             # CSV import/export, dedup, hygiene, saved views, activity log
│   │   │   ├── workflow/             # Workflow builder (CRUD, versioning, execution, templates, cron)
│   │   │   ├── ai/                   # Quality scoring, field mapping, dedup detection, NL query
│   │   │   ├── team/                 # Activity feed, audit log, workspace invitations
│   │   │   ├── analytics/            # ClickHouse analytics queries + CSV export
│   │   │   ├── search/               # OpenSearch full-text search + admin reindex
│   │   │   └── replication/          # CDC pipeline + dead letter queue
│   │   ├── shared/                    # DB pool, encryption, errors, envelope, types
│   │   ├── app.ts                     # Express app assembly
│   │   └── index.ts                   # Entry point
│   ├── migrations/                    # 22 sequential PostgreSQL migrations + ClickHouse migrations
│   └── tests/
│       ├── integration/               # End-to-end HTTP flow tests
│       └── property/                  # fast-check property-based tests
│
├── scraper/                           # Python scraping service (Module 3)
│   ├── src/
│   │   ├── config/                    # Pydantic Settings, domain policies (YAML)
│   │   ├── routers/                   # FastAPI route handlers
│   │   ├── services/                  # Task queue, job orchestration
│   │   ├── browser/                   # Browser pool, fingerprint randomizer
│   │   ├── extractors/                # Pluggable page extractors (linkedin, company, job)
│   │   ├── proxy/                     # Proxy manager, rotation, health checks
│   │   ├── resilience/                # Circuit breaker, domain rate limiter
│   │   ├── integration/               # Credential client, webhook callbacks
│   │   ├── models/                    # Pydantic request/response models, normalizers
│   │   └── main.py                    # FastAPI app entry point
│   ├── tests/                         # pytest + hypothesis tests
│   └── pyproject.toml                 # Python project config (Black, Ruff, pytest)
│
├── frontend/                          # React spreadsheet UI (Module 4)
│   ├── src/
│   │   ├── api/                       # Axios HTTP client + per-domain API modules (auth, workspace, records, enrichment, analytics, search, billing, credentials, members)
│   │   ├── components/
│   │   │   ├── analytics/             # Dashboard with enrichment/scraping/credits tabs + Recharts
│   │   │   ├── auth/                  # LoginForm, RegisterForm
│   │   │   ├── enrichment/            # EnrichmentPanel, WaterfallConfig
│   │   │   ├── jobs/                  # JobMonitor, JobRow, JobRecordDetail
│   │   │   ├── layout/               # AppShell, AuthGuard, Header, Sidebar
│   │   │   ├── search/               # SearchBar, SearchResultsView, FacetSidebar, SearchPagination
│   │   │   ├── settings/             # Workspace, Billing, Credential, Member settings
│   │   │   ├── shared/               # ErrorBoundary, Toast, ConfirmDialog, LoadingSpinner, OfflineBanner
│   │   │   └── spreadsheet/          # SpreadsheetView (AG Grid), GridToolbar, ContextMenu, CSVImportDialog, ColumnDialog, CellRenderer, StatusBar
│   │   ├── hooks/                     # useAuth, useAutoSave, useJobPolling, useRole, useSearch, useAnalytics, useOnlineStatus
│   │   ├── stores/                    # Zustand stores: auth, grid, workspace, job, analytics, search, ui
│   │   ├── types/                     # TypeScript interfaces (api, grid, enrichment, search, analytics)
│   │   ├── utils/                     # formatters, permissions (role-based action map)
│   │   └── workers/                   # CSV Web Worker (parse + generate off main thread)
│   ├── tests/
│   │   └── property/                  # 7 fast-check property test suites
│   ├── index.html
│   ├── vite.config.ts                 # Vite 6 + React plugin + dev proxy + Vitest config
│   ├── tailwind.config.js
│   └── tsconfig.json

docker/                                # Dockerfiles for backend, scraper, frontend + nginx config
terraform/                             # AWS IaC — 13 reusable modules
.github/                               # CI/CD pipelines (GitHub Actions)
docker-compose.yml                     # Full local dev stack
```

## Testing

```bash
npm test              # Run all 400+ tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

The test suite spans three frameworks across three languages:

- **400+ unit and integration tests** covering schema validation, middleware behavior, service logic, adapter behavior, and full HTTP flows
- **59 property-based correctness properties** (33 enrichment/core + 26 security) — not example-based tests, but formal specifications that generate randomized inputs to verify invariants hold universally
- **100+ iterations per property = 5,900+ generated test cases** across the full input space
- **Three testing frameworks**: Vitest + fast-check (TypeScript backend/frontend), pytest + hypothesis (Python scraper)

Property coverage includes: auth, RBAC, encryption, rate limiting, circuit breaker, waterfall enrichment, idempotency, webhooks, input sanitization, SSRF prevention, deep link validation, credential handling, and audit logging.

## Roadmap

### ✅ Module 1: Core Backend Foundation
> *Status: Complete*

Express.js API gateway, PostgreSQL schema, JWT auth with refresh rotation, RBAC, workspace management, AES-256-GCM credential encryption, credit/billing system, 27 property-based correctness tests.

---

### ✅ Module 2: Enrichment Orchestration
> *Status: Complete*

Temporal.io workflow engine for orchestrating multi-step data enrichment pipelines. Each enrichment action consumes credits and calls external data providers using stored credentials.

- Temporal.io worker and workflow definitions
- Provider adapter registry (Apollo, Clearbit, Hunter) with pluggable interface
- Waterfall enrichment (try provider A, fall back to B) with idempotency keys
- Credit consumption per action with rollback on failure
- Circuit breaker (sliding window, 5 failure threshold, 60s cooldown)
- Webhook callbacks with HMAC-SHA256 signatures and retry logic
- Job status tracking, batch splitting (1000 records max), and cancellation
- 6 property-based correctness tests for waterfall, idempotency, circuit breaker, and credits

---

### ✅ Module 3: Scraping Microservices
> *Status: Complete*

Python/FastAPI/Playwright scraping service for data sources without APIs. Runs as a standalone microservice communicating with the backend via REST API. Acts as an enrichment provider callable by Temporal.io workflows.

- FastAPI service with Pydantic validation and OpenAPI docs
- Playwright headless Chromium browser pool (5–20 instances, auto-recycling)
- Pluggable page extractors: LinkedIn profiles, company websites, job postings
- Anti-detection: fingerprint randomization, webdriver masking, human-like delays
- Proxy rotation with health monitoring and per-domain cooldowns
- Per-domain rate limiting (token bucket) with YAML policy overrides and robots.txt compliance
- Circuit breaker per target domain (sliding window, 120s cooldown)
- Credential retrieval from backend with in-memory caching (5min TTL)
- Result normalization into Pydantic models matching enrichment pipeline schemas
- Async task queue with priority scheduling and concurrency control
- Batch processing (max 100 targets) with job lifecycle management
- HMAC-SHA256 signed webhook callbacks with retry logic
- Docker multi-stage build with resource limits (2 CPU, 4GB RAM)
- Structured JSON logging, /metrics and /health endpoints
- 15 requirements with 97 acceptance criteria

---

### ✅ Module 4: Spreadsheet UI
> *Status: Complete*

React-based spreadsheet interface using AG Grid for high-performance data manipulation. The primary user interface for viewing, editing, and enriching prospect data.

- React 18+ with TypeScript (strict), Vite 6 build tooling, Tailwind CSS styling
- Zustand 5 state management — 7 domain stores (auth, grid, workspace, job, analytics, search, ui)
- AG Grid v32 with DOM virtualization for 100k+ row datasets, custom alpine theme overrides
- Axios HTTP client with auto token refresh, envelope unwrapping, dual timeout instances (30s/120s)
- Spreadsheet: cell editing with undo stack (50-deep), auto-save (30s interval), context menus, column management (add/hide/reorder/resize/delete)
- CSV import/export via Web Worker for off-main-thread processing (≥10k rows), with column mapping dialog and progress reporting
- Enrichment job polling (5s interval) with terminal status detection, toast notifications, and automatic grid cell updates
- Analytics dashboard: 3 tabs (enrichment/scraping/credits) with Recharts charts, time range filters (24h/7d/30d/90d/custom), parallel data fetching
- Full-text search: debounced typeahead (200ms), faceted sidebar, sort by relevance/date/name, pagination, highlighted matches
- Role-based UI permissions: viewer < member < admin < owner, toolbar buttons conditionally rendered via `useRole()` hook
- Offline detection with banner warning, auto-save skip when offline
- Lazy-loaded routes (AnalyticsDashboard, SearchResultsView) via React.lazy + Suspense
- Settings pages: workspace config, billing/credits, credential management (masked keys), member management
- 7 property-based test suites (fast-check): api-envelope, csv-roundtrip, enrichment-cost, grid-operations, permissions, sort-filter, toast-behavior
- Unit tests with Testing Library + MSW for API mocking

---

### ✅ Module 5: OLAP Analytics Layer
> *Status: Complete*

ClickHouse integration for analytical queries across enrichment data. Separates read-heavy analytics from the OLTP PostgreSQL database.

- ClickHouse schema with ReplacingMergeTree for deduplication
- CDC pipeline from PostgreSQL → ClickHouse
- Pre-aggregated materialized views for dashboards
- Enrichment success rate analytics
- Credit usage analytics and forecasting
- API endpoints for dashboard data

---

### ✅ Module 6: Search
> *Status: Complete*

OpenSearch/ElasticSearch integration for full-text search across enriched prospect data.

- OpenSearch index management and mapping
- Real-time indexing pipeline from PostgreSQL
- Full-text search with fuzzy matching and filters
- Faceted search (by company, title, location, etc.)
- Search result ranking and relevance tuning
- Typeahead/autocomplete API

---

### ✅ Module 7: Infrastructure & DevOps
> *Status: Complete*

Production-grade infrastructure on AWS with CI/CD automation.

- Docker multi-stage builds for all services (backend, scraper, frontend)
- Terraform IaC for AWS: 13 reusable modules (VPC, ECS, ALB, Aurora, ClickHouse, Redis, RabbitMQ, OpenSearch, S3, CloudFront, ECR, Secrets, Monitoring)
- Environment configs for staging (reduced) and production (full-scale, multi-AZ, auto-scaling)
- GitHub Actions CI pipeline: path-filtered jobs for backend, scraper, frontend, terraform
- GitHub Actions Deploy pipeline: ECR push, ECS rolling deploy, S3 + CloudFront for frontend, migration runner, production approval gate
- CloudWatch alarms, dashboard, SNS notifications
- docker-compose.yml for full local dev stack

### ✅ Module 8: Product Enhancements & Growth Features
> *Status: Complete*

Eight sub-modules covering billing, integrations, data operations, workflow builder, AI/ML, team collaboration, performance, and observability.

- **8.1 AI/ML Intelligence** — Data quality scoring (confidence %, freshness), smart field mapping with alias dictionary, fuzzy duplicate detection (Levenshtein), natural language query parser
- **8.2 Visual Workflow Builder** — Workflow CRUD with automatic versioning, graph definition (data_source/enrichment_step/filter/output nodes), version rollback, async execution with run tracking, template cloning, cron scheduling
- **8.3 CRM Integrations** — Salesforce & HubSpot OAuth2 flows, bi-directional field mapping, push/pull records, sync history, encrypted token storage per workspace
- **8.4 Stripe Billing** — Subscription management (free/starter/pro/enterprise), credit pack purchases, Stripe Checkout + Customer Portal, webhook handling, invoice listing
- **8.5 Advanced Data Operations** — CSV import (two-phase preview/commit), export (CSV/JSON), dedup scan + merge, data hygiene stats, bulk delete, saved views CRUD, record activity log
- **8.6 Team & Collaboration** — Extended roles (viewer, billing_admin), activity feed, immutable audit log with CSV export, workspace invitations with 7-day expiry tokens
- **8.7 Performance & Scale** — Redis caching layer (ioredis) with graceful degradation, domain-specific cache helpers (workspace config 5min, user session 15min, provider health 1min), Redis health check
- **8.8 Observability & Operations** — Structured JSON logger with configurable levels, in-memory request/error metrics, GET /api/v1/metrics and GET /api/v1/readiness endpoints, OpenTelemetry distributed tracing with auto-instrumentation (HTTP, Express, PostgreSQL, Redis), OTLP exporter, log-trace correlation (trace_id/span_id in log entries)

---

### ✅ Security Audit
> *Status: Complete*

Defense-in-depth security hardening across all 6 layers of the platform — infrastructure, API gateway, authentication, data protection, observability, and supply chain. 13 requirement areas with 26 formally specified correctness properties validated by property-based tests. See the [Security](#security) section above for full details.

---

## License

Private — All rights reserved.
