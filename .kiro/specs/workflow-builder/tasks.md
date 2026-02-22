# Tasks — Module 8.2: Visual Workflow Builder (Backend)

## 1. Database
- [x] Migration 020: workflows, workflow_versions, workflow_runs tables with indexes

## 2. Schemas
- [x] Zod schemas: graph definition (nodes + edges), CRUD, rollback, schedule, runs

## 3. Repository
- [x] Workflow CRUD (list, create, get, update meta, delete)
- [x] Version management (create, list, get, get latest, increment)
- [x] Run tracking (create, complete, list paginated, get)
- [x] Template queries (list, get)
- [x] Schedule update

## 4. Service
- [x] Workflow CRUD with automatic versioning on update
- [x] Version rollback (copies target version as new version)
- [x] Async execution with run tracking (placeholder for Temporal dispatch)
- [x] Template listing + clone into workspace
- [x] Schedule management

## 5. Controller & Routes
- [x] Controller factory with all HTTP handlers
- [x] Routes with mergeParams, Zod validation, RBAC
- [x] Template routes before :workflowId to avoid param conflict

## 6. App Wiring
- [x] Mount workflow routes under /api/v1/workspaces/:id/workflows

## 7. Validation
- [x] Zero TypeScript diagnostics
