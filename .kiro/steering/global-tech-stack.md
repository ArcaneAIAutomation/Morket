---
inclusion: always
---

# Global Tech Stack Standards

This project is building Morket, a modern GTM data engine (Clay.com competitor). All modules must adhere to these technology choices.

## Project Structure

Monorepo using VS Code workspaces:
```
packages/
  backend/     # Express.js API (Modules 1 & 2 — COMPLETE)
  scraper/     # Python scraping microservices (Module 3 — IN PROGRESS)
  frontend/    # React spreadsheet UI (planned)
```

## Backend (packages/backend) — IMPLEMENTED
- **Language**: Node.js with TypeScript (strict mode)
- **Framework**: Express.js for API gateway
- **Database (OLTP)**: PostgreSQL (targeting Amazon Aurora compatibility)
- **Auth**: JWT-based (15min access, 7d refresh) with bcrypt (12 rounds) and RBAC middleware
- **Encryption**: AES-256-GCM with HKDF per-workspace key derivation
- **Validation**: Zod schemas at middleware level for all request payloads
- **Testing**: Vitest + fast-check (property-based) + supertest (HTTP integration)
- **Architecture**: Layered — Routes → Controllers → Services → Repositories
- **Modules**: auth, workspace, credential, credit, enrichment (each self-contained with own routes/controller/service/schemas/repository)
- **Workflow Engine**: Temporal.io for durable enrichment workflows (Module 2)
- **Provider Adapters**: Apollo, Clearbit, Hunter with pluggable adapter interface
- **Circuit Breaker**: In-memory sliding window circuit breaker for external provider calls
- **Webhook Delivery**: HMAC-SHA256 signed webhooks with retry logic and exponential backoff

## Backend — PLANNED
- **Database (OLAP)**: ClickHouse (Module 5)
- **Search**: OpenSearch/ElasticSearch (Module 6)
- **Cache/Queue**: Redis, RabbitMQ (Module 4+)

## Frontend (planned — Module 4)
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand (lightweight, performant)
- **Grid/Spreadsheet**: AG Grid for DOM virtualization
- **Styling**: Tailwind CSS

## Scraping Microservices (packages/scraper) — IN PROGRESS (Module 3)
- **Language**: Python 3.11+
- **Browser Automation**: Playwright (headless Chromium)
- **Framework**: FastAPI with automatic OpenAPI docs
- **Validation**: Pydantic v2 models and Settings
- **Testing**: pytest + pytest-asyncio + hypothesis (property-based)
- **Linting**: Black + Ruff
- **Containerization**: Docker multi-stage build with resource limits
- **Architecture**: FastAPI routers → Services → Browser Pool / Extractors / Proxy Manager
- **Components**: Browser Pool, Page Extractors (pluggable), Proxy Manager, Fingerprint Randomizer, Domain Rate Limiter, Circuit Breaker, Credential Client, Result Normalizer, Task Queue (asyncio)
- **Integration**: Acts as enrichment provider callable by backend Temporal.io workflows via REST API
- **Auth**: Service-to-service via X-Service-Key header
- **Webhook Delivery**: HMAC-SHA256 signed callbacks with retry logic

## Infrastructure (planned — Module 7)
- **Containerization**: Docker
- **IaC**: Terraform
- **CI/CD**: GitHub Actions
- **Cloud**: AWS (ECS Fargate, Lambda, Aurora, S3)

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
