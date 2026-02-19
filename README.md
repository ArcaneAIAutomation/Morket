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
        ┌──────────┬───────┴───────┬──────────┐
        ▼          ▼               ▼          ▼
   Auth Module  Workspace    Credential   Credit/Billing
                 Module       Module       Module
        │          │               │          │
        └──────────┴───────┬───────┴──────────┘
                           ▼
                  PostgreSQL (Aurora)
```

The backend follows a layered architecture: **Routes → Controllers → Services → Repositories**, with each domain (auth, workspace, credential, credit) as a self-contained module.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, TypeScript (strict), Express.js |
| Database (OLTP) | PostgreSQL (Aurora-compatible) |
| Auth | JWT (15min access / 7d refresh) with bcrypt |
| Encryption | AES-256-GCM with per-workspace key derivation |
| Validation | Zod schemas at middleware level |
| Testing | Vitest, fast-check (property-based), supertest |
| Frontend (planned) | React 18+, Zustand, AG Grid, Tailwind CSS |
| Scraping (planned) | Python 3.11+, Playwright, FastAPI |
| Workflow (planned) | Temporal.io |
| Infrastructure | Docker, Terraform, GitHub Actions, AWS |

## Current Status: Module 1 — Core Backend Foundation ✅

The foundation is fully implemented with 313 tests passing across 34 test files.

### What's built

- **JWT Authentication** — Register, login, refresh token rotation, logout. Bcrypt (12 rounds), rate-limited auth endpoints (5/min per IP).
- **RBAC Middleware** — Role hierarchy (owner > admin > member > viewer), workspace-scoped permissions enforced at the middleware level.
- **Workspace Management** — CRUD with slug generation, member management (add/remove/update role), last-owner protection.
- **Encrypted Credential Storage** — AES-256-GCM with HKDF per-workspace key derivation. API responses only expose masked keys (last 4 chars).
- **Credit/Billing System** — Consumption-based credits with `SELECT FOR UPDATE` concurrency control, auto-recharge, immutable transaction ledger, paginated history.
- **API Infrastructure** — Consistent JSON envelope responses, X-Request-Id tracing, structured JSON logging, Helmet security headers, CORS, sliding-window rate limiting.
- **Database Migrations** — 8 sequential migration files covering all tables and indexes.
- **27 Correctness Properties** — Property-based tests using fast-check validating auth, RBAC, workspace, credential, and credit invariants.

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

# Health
GET    /api/v1/health
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
packages/backend/
├── src/
│   ├── config/env.ts              # Zod-validated env config
│   ├── middleware/                 # Auth, RBAC, validation, rate limiting, logging, errors
│   ├── modules/
│   │   ├── auth/                  # User registration, login, JWT, refresh tokens
│   │   ├── workspace/             # Workspace CRUD, membership management
│   │   ├── credential/            # Encrypted API credential storage
│   │   └── credit/                # Billing, credits, transaction ledger
│   ├── shared/                    # DB pool, encryption, errors, envelope, logger, types
│   ├── app.ts                     # Express app assembly
│   └── server.ts                  # Entry point
├── migrations/                    # Sequential PostgreSQL migrations
└── tests/
    ├── integration/               # End-to-end HTTP flow tests
    └── property/                  # fast-check property-based tests
```

## Testing

```bash
npm test              # Run all 313 tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

The test suite includes:
- **Unit tests** — Schema validation, error classes, middleware behavior, service logic
- **Property-based tests** — 27 correctness properties with 100+ iterations each (fast-check)
- **Integration tests** — Full HTTP flows: register → login → workspace → credentials → billing

## Roadmap

### ✅ Module 1: Core Backend Foundation
> *Status: Complete*

Express.js API gateway, PostgreSQL schema, JWT auth with refresh rotation, RBAC, workspace management, AES-256-GCM credential encryption, credit/billing system, 27 property-based correctness tests.

---

### 🔲 Module 2: Enrichment Orchestration
> *Status: Planned*

Temporal.io workflow engine for orchestrating multi-step data enrichment pipelines. Each enrichment action consumes credits and calls external data providers using stored credentials.

- Temporal.io worker and workflow definitions
- Enrichment action registry (Apollo, Clearbit, LinkedIn, etc.)
- Waterfall enrichment (try provider A, fall back to B)
- Credit consumption per action with rollback on failure
- Webhook callbacks for async enrichment results
- Job status tracking and retry logic

---

### 🔲 Module 3: Scraping Microservices
> *Status: Planned*

Python/Playwright-based scraping services for data sources that don't offer APIs. Runs as isolated microservices communicating via RabbitMQ.

- FastAPI scraping service with Playwright browser automation
- Anti-detection: proxy rotation, fingerprint randomization, rate limiting
- Credential retrieval from Module 1's encrypted storage
- Result normalization and schema validation
- Docker containerization with resource limits
- Circuit breaker pattern for external service failures

---

### 🔲 Module 4: Spreadsheet UI
> *Status: Planned*

React-based spreadsheet interface using AG Grid for high-performance data manipulation. The primary user interface for viewing, editing, and enriching prospect data.

- React 18+ with TypeScript and Zustand state management
- AG Grid with DOM virtualization for 100k+ row datasets
- Column-level enrichment triggers (right-click → enrich)
- Real-time updates via WebSocket/SSE
- CSV/Excel import and export
- Tailwind CSS styling with responsive layout
- Keyboard shortcuts and bulk operations

---

### 🔲 Module 5: OLAP Analytics Layer
> *Status: Planned*

ClickHouse integration for analytical queries across enrichment data. Separates read-heavy analytics from the OLTP PostgreSQL database.

- ClickHouse schema with ReplacingMergeTree for deduplication
- CDC pipeline from PostgreSQL → ClickHouse
- Pre-aggregated materialized views for dashboards
- Enrichment success rate analytics
- Credit usage analytics and forecasting
- API endpoints for dashboard data

---

### 🔲 Module 6: Search
> *Status: Planned*

OpenSearch/ElasticSearch integration for full-text search across enriched prospect data.

- OpenSearch index management and mapping
- Real-time indexing pipeline from PostgreSQL
- Full-text search with fuzzy matching and filters
- Faceted search (by company, title, location, etc.)
- Search result ranking and relevance tuning
- Typeahead/autocomplete API

---

### 🔲 Module 7: Infrastructure & DevOps
> *Status: Planned*

Production-grade infrastructure on AWS with CI/CD automation.

- Docker multi-stage builds for all services
- Terraform IaC for AWS (ECS Fargate, Aurora, S3, ElastiCache)
- GitHub Actions CI/CD pipeline (lint → test → build → deploy)
- Redis caching layer for workspace configs and session data
- CloudWatch logging and alerting
- Blue/green deployment strategy

## License

Private — All rights reserved.
