---
inclusion: always
---

# Global Tech Stack Standards

This project is building a modern GTM data engine (Clay.com competitor). All modules must adhere to these technology choices:

## Backend
- **Language**: Node.js with TypeScript (strict mode)
- **Framework**: Express.js for API gateway
- **Database (OLTP)**: PostgreSQL (targeting Amazon Aurora compatibility)
- **Database (OLAP)**: ClickHouse (future module)
- **Search**: OpenSearch/ElasticSearch (future module)
- **Workflow Engine**: Temporal.io (future module)
- **Cache/Queue**: Redis, RabbitMQ (future module)
- **Auth**: JWT-based with RBAC

## Frontend
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand (lightweight, performant)
- **Grid/Spreadsheet**: AG Grid for DOM virtualization
- **Styling**: Tailwind CSS

## Scraping Microservices
- **Language**: Python 3.11+
- **Browser Automation**: Playwright
- **Framework**: FastAPI

## Infrastructure
- **Containerization**: Docker
- **IaC**: Terraform
- **CI/CD**: GitHub Actions
- **Cloud**: AWS (ECS Fargate, Lambda, Aurora, S3)

## Coding Standards
- All API routes must have input validation (zod for TypeScript, pydantic for Python)
- All database operations must use parameterized queries (no raw SQL interpolation)
- All secrets/credentials must be encrypted at rest and never committed to source control
- All API endpoints must return consistent JSON response envelopes: `{ success, data, error }`
- Use ESLint + Prettier for TypeScript, Black + Ruff for Python
- Write unit tests for all business logic; property-based tests for data transformation logic
