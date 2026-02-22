# Morket

A modern GTM (Go-To-Market) data engine — think Clay.com, built from scratch. Morket provides data enrichment orchestration, multi-tenant workspace management, and a consumption-based credit system, all backed by a robust TypeScript/Express API.

## What is Morket?

Morket helps sales and marketing teams enrich their prospect data by orchestrating calls to multiple data providers (Apollo, Clearbit, LinkedIn, etc.) through a unified platform. Teams get:

- **Multi-tenant workspaces** to organize enrichment activities
- **Encrypted credential storage** for third-party API keys
- **Consumption-based billing** with credit tracking
- **Role-based access control** across workspace members
- **A spreadsheet-like UI** for managing and enriching data (coming soon)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Client / SDK                         │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│                   API Gateway (Express.js)               │
│  Rate Limiter → Request ID → Logger → Helmet/CORS       │
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

The backend follows a layered architecture: **Routes → Controllers → Services → Repositories**, with each domain (auth, workspace, credential, credit, enrichment) as a self-contained module.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, TypeScript (strict), Express.js |
| Database (OLTP) | PostgreSQL (Aurora-compatible) |
| Workflow Engine | Temporal.io (durable enrichment workflows) |
| Auth | JWT (15min access / 7d refresh) with bcrypt |
| Encryption | AES-256-GCM with per-workspace key derivation |
| Validation | Zod (backend), Pydantic (scraper) |
| Testing | Vitest + fast-check (backend), pytest + hypothesis (scraper) |
| Scraping | Python 3.11+, FastAPI, Playwright (headless Chromium) |
| Frontend (planned) | React 18+, Zustand, AG Grid, Tailwind CSS |
| Infrastructure | Docker, Terraform, GitHub Actions, AWS |

## Current Status: Module 7 — Infrastructure & Deployment ✅

All 7 modules are complete. Application code (Modules 1–6) covers the full backend API, enrichment orchestration, scraping microservices, spreadsheet UI, OLAP analytics, and search layer. Module 7 provides Docker containerization, Terraform IaC for AWS, and GitHub Actions CI/CD pipelines.

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

# Health
GET    /api/v1/health
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
- Temporal.io server (for enrichment workflows)
- Python 3.11+ (for scraper service)
- Playwright (installed via `playwright install chromium`)

### Setup

```bash
# Clone
git clone https://github.com/<your-username>/Morket.git
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
```

## Project Structure

```
packages/
├── backend/                           # Express.js API (Modules 1 & 2)
│   ├── src/
│   │   ├── config/env.ts              # Zod-validated env config
│   │   ├── middleware/                 # Auth, RBAC, validation, rate limiting, logging, errors
│   │   ├── modules/
│   │   │   ├── auth/                  # User registration, login, JWT, refresh tokens
│   │   │   ├── workspace/             # Workspace CRUD, membership management
│   │   │   ├── credential/            # Encrypted API credential storage
│   │   │   ├── credit/                # Billing, credits, transaction ledger
│   │   │   └── enrichment/            # Enrichment orchestration (Module 2)
│   │   │       ├── adapters/          # Provider adapters (Apollo, Clearbit, Hunter)
│   │   │       ├── temporal/          # Temporal.io client, activities, workflows, worker
│   │   │       ├── circuit-breaker.ts # Sliding window circuit breaker
│   │   │       ├── provider-registry.ts # In-memory provider registry
│   │   │       ├── job.repository.ts  # Enrichment job persistence
│   │   │       ├── record.repository.ts # Enrichment record persistence
│   │   │       ├── webhook.repository.ts # Webhook subscription persistence
│   │   │       ├── enrichment.service.ts # Job lifecycle orchestration
│   │   │       ├── webhook.service.ts # Webhook delivery with HMAC + retries
│   │   │       ├── enrichment.controller.ts # HTTP handlers
│   │   │       ├── enrichment.routes.ts # Route factories
│   │   │       └── enrichment.schemas.ts # Zod validation schemas
│   │   ├── shared/                    # DB pool, encryption, errors, envelope, logger, types
│   │   ├── app.ts                     # Express app assembly
│   │   └── server.ts                  # Entry point
│   ├── migrations/                    # 11 sequential PostgreSQL migrations
│   └── tests/
│       ├── integration/               # End-to-end HTTP flow tests
│       └── property/                  # fast-check property-based tests
│
└── scraper/                           # Python scraping service (Module 3)
    ├── src/
    │   ├── config/                    # Pydantic Settings, domain policies (YAML)
    │   ├── routers/                   # FastAPI route handlers
    │   ├── services/                  # Task queue, job orchestration
    │   ├── browser/                   # Browser pool, fingerprint randomizer
    │   ├── extractors/                # Pluggable page extractors (linkedin, company, job)
    │   ├── proxy/                     # Proxy manager, rotation, health checks
    │   ├── resilience/                # Circuit breaker, domain rate limiter
    │   ├── integration/               # Credential client, webhook callbacks
    │   ├── models/                    # Pydantic request/response models, normalizers
    │   └── main.py                    # FastAPI app entry point
    ├── tests/                         # pytest + hypothesis tests
    ├── Dockerfile                     # Multi-stage production build
    ├── docker-compose.yml             # Resource-limited container config
    └── pyproject.toml                 # Python project config (Black, Ruff, pytest)
```

## Testing

```bash
npm test              # Run all 400 tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

The test suite includes:
- **Unit tests** — Schema validation, error classes, middleware behavior, service logic, adapter behavior
- **Property-based tests** — 33 correctness properties with 100+ iterations each (fast-check) covering auth, RBAC, workspace, credential, credit, circuit breaker, waterfall enrichment, and idempotency
- **Integration tests** — Full HTTP flows: register → login → workspace → credentials → billing → enrichment jobs → webhooks → providers

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

- React 18+ with TypeScript and Zustand state management
- AG Grid with DOM virtualization for 100k+ row datasets
- Column-level enrichment triggers (right-click → enrich)
- Real-time updates via WebSocket/SSE
- CSV/Excel import and export
- Tailwind CSS styling with responsive layout
- Keyboard shortcuts and bulk operations

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

## License

Private — All rights reserved.
