# Tasks — Module 8.5: Advanced Data Operations

## 1. Database
- [x] Migration 019: saved_views, record_activity_log tables with indexes

## 2. Schemas
- [x] Zod schemas for all endpoints (import, export, dedup, bulk ops, views, activity)

## 3. Repository
- [x] Saved views CRUD (list, create, update, get, delete)
- [x] Record activity log (create entry, get paginated log)
- [x] Hygiene stats (aggregate queries on enrichment_records)
- [x] Dedup scan (composite key grouping)
- [x] Bulk delete records
- [x] Export query with filters

## 4. Service
- [x] CSV import preview with in-memory session store (15min TTL)
- [x] Import commit (session retrieval + cleanup)
- [x] Export records as CSV/JSON
- [x] Dedup scan + merge with activity logging
- [x] Hygiene stats
- [x] Bulk delete with activity logging
- [x] Saved views CRUD
- [x] Activity log retrieval

## 5. Controller & Routes
- [x] Controller factory with all HTTP handlers
- [x] Routes with mergeParams, Zod validation, RBAC
- [x] Multer middleware for CSV upload (10MB limit)

## 6. App Wiring
- [x] Mount data-ops routes under /api/v1/workspaces/:id/data-ops

## 7. Validation
- [x] Zero TypeScript diagnostics
