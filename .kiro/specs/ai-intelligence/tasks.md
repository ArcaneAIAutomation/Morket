# Tasks — Module 8.1: AI/ML Intelligence (Backend)

## 1. Database
- [x] Migration 021: quality_scores table with indexes

## 2. Utilities
- [x] Levenshtein distance + normalized similarity (similarity.ts)
- [x] Smart field mapper with alias dictionary (field-mapper.ts)

## 3. Schemas
- [x] Zod schemas for all endpoints (quality, field mapping, duplicates, NL query)

## 4. Repository
- [x] Quality score upsert, get, summary aggregation
- [x] Fetch records for duplicate detection
- [x] Fetch records for quality scoring

## 5. Service
- [x] Quality score computation (confidence + freshness + per-field)
- [x] Quality summary
- [x] Field mapping suggestions (Levenshtein + alias dictionary)
- [x] Fuzzy duplicate detection (pairwise similarity)
- [x] Natural language query parser (keyword extraction → filters)

## 6. Controller & Routes
- [x] Controller factory with all HTTP handlers
- [x] Routes with mergeParams, Zod validation, RBAC (member+)

## 7. App Wiring
- [x] Mount AI routes under /api/v1/workspaces/:id/ai

## 8. Validation
- [x] Zero TypeScript diagnostics
