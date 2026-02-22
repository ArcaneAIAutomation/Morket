# Requirements — Module 8.5: Advanced Data Operations

## Overview
Backend APIs for bulk data import/export, deduplication, data hygiene metrics, bulk operations, saved views, and record-level activity logging. These endpoints power the frontend spreadsheet UI's data management capabilities.

## Functional Requirements

### 8.5.1 Bulk Import
- Accept CSV upload (multipart/form-data) with column mapping
- Validate rows against expected schema before inserting
- Return validation preview (first 10 rows + error summary) before committing
- Insert valid records into enrichment_records in batches of 1000
- Track import job status (pending, validating, previewing, importing, completed, failed)
- Support field type coercion (string → number, date parsing)

### 8.5.2 Bulk Export
- Export enrichment records as CSV or JSON
- Support filter criteria (status, provider, date range, field values)
- Stream large exports to avoid memory issues
- Limit export to 50,000 records per request

### 8.5.3 Data Deduplication
- Detect duplicates using exact match on configurable key fields (email, company+name)
- Return duplicate groups with merge preview
- Merge strategy: keep_newest (default), keep_most_complete, manual
- Merge operation updates the surviving record and soft-deletes duplicates

### 8.5.4 Data Hygiene Dashboard
- Compute completeness % per field across all workspace records
- Compute freshness: % of records enriched within last 30/60/90 days
- Return stale record count (not enriched in 90+ days)
- Aggregate stats endpoint, not per-record

### 8.5.5 Bulk Operations
- Bulk delete: accept array of record IDs, delete in batches of 1000
- Bulk re-enrich: accept array of record IDs, create new enrichment job
- Return operation result with success/failure counts

### 8.5.6 Saved Views
- CRUD for saved views per workspace (name, filters, sort, column visibility)
- Views are workspace-scoped, created by a user
- Default view per workspace (all records, default columns)

### 8.5.7 Record Activity Log
- Log enrichment events per record (provider, fields changed, timestamp, user)
- Query activity log by record ID with pagination
- Stored in PostgreSQL (not ClickHouse — low volume, needs joins)

## Non-Functional Requirements
- All endpoints workspace-scoped under /api/v1/workspaces/:id/data-ops/...
- Zod validation on all inputs
- RBAC: member+ for read/export, owner for delete/import/dedup
- Batch operations capped at 1000 per request
- CSV parsing uses a streaming parser (no full file in memory)
