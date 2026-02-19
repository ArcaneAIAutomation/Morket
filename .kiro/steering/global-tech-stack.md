---
inclusion: always
---

# Global Tech Stack Standards

This project is building Morket, a modern GTM data engine (Clay.com competitor). All modules must adhere to these technology choices.

## Project Structure

Monorepo using VS Code workspaces:
```
packages/
  backend/     # Express.js API (Module 1 — COMPLETE)
  frontend/    # React spreadsheet UI (planned)
  scraper/     # Python scraping microservices (planned)
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
- **Modules**: auth, workspace, credential, credit (each self-contained with own routes/controller/service/schemas/repository)

## Backend — PLANNED
- **Database (OLAP)**: ClickHouse (Module 5)
- **Search**: OpenSearch/ElasticSearch (Module 6)
- **Workflow Engine**: Temporal.io (Module 2)
- **Cache/Queue**: Redis, RabbitMQ (Module 2+)

## Frontend (planned — Module 4)
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand (lightweight, performant)
- **Grid/Spreadsheet**: AG Grid for DOM virtualization
- **Styling**: Tailwind CSS

## Scraping Microservices (planned — Module 3)
- **Language**: Python 3.11+
- **Browser Automation**: Playwright
- **Framework**: FastAPI

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
