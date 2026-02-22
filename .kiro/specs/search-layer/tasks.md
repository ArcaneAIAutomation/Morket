# Implementation Plan: Module 6 — Search Layer

## Overview

Implements full-text search for the Morket GTM data engine using OpenSearch. The plan follows incremental steps: OpenSearch client → schema/migrations → index mapping → indexing pipeline → search/suggest API → caching → admin health → frontend search UI. Each task builds on the previous, with property-based and unit tests woven in close to implementation.

## Tasks

- [x] 1. OpenSearch client and environment configuration
  - [x] 1.1 Install `@opensearch-project/opensearch` package in `packages/backend`
    - Add to `package.json` dependencies
    - _Requirements: 1.1_

  - [x] 1.2 Add OpenSearch env vars to `src/config/env.ts` schema
    - `OPENSEARCH_NODE_URLS` (comma-separated, default `http://localhost:9200`), `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, `OPENSEARCH_REQUEST_TIMEOUT_MS` (default 10000), `OPENSEARCH_SSL_CERT_PATH` (optional)
    - Add to `packages/backend/.env.example`
    - _Requirements: 1.4, 1.5_

  - [x] 1.3 Create `src/modules/search/opensearch/client.ts` with singleton pattern
    - `initOpenSearch(config)`, `getOpenSearch()` (throws if not initialized), `healthCheck()` returning `ClusterHealth` (status, numberOfNodes, activeShards, unassignedShards, clusterName)
    - Configurable node URLs, auth, TLS, request timeout (10s), max retries (3) with exponential backoff (1s, 2s, 4s)
    - Match existing `getPool()`/`getClickHouse()` singleton pattern
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.4 Wire OpenSearch initialization into `src/index.ts`
    - Call `initOpenSearch()` during app startup; log warning if cluster unreachable but do not block Express from starting
    - Add graceful shutdown for OpenSearch client
    - _Requirements: 1.3_

  - [x] 1.5 Write unit tests for `opensearch/client.ts`
    - Test initialization, getOpenSearch throws when not initialized, healthCheck, retry behavior on transient failures, TLS config
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Database schema and migrations
  - [x] 2.1 Create `packages/backend/migrations/014_create_search_index_status.ts`
    - `search_index_status` table: id (UUID PK), workspace_id (UUID FK UNIQUE), last_indexed_at, document_count, index_version, status (active/reindexing/error), error_reason, created_at, updated_at
    - Include up/down functions
    - _Requirements: 13.1, 13.3, 13.4, 13.5_

  - [x] 2.2 Create `packages/backend/migrations/015_create_search_reindex_jobs.ts`
    - `search_reindex_jobs` table: id (UUID PK), workspace_id (UUID FK), status (pending/running/completed/failed), total_documents, indexed_documents, failed_documents, started_at, completed_at, error_reason, created_at
    - Index on `(workspace_id, created_at DESC)`
    - Include up/down functions
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

  - [x] 2.3 Create `packages/backend/migrations/016_create_search_notify_triggers.ts`
    - `notify_search_index_enrichment()` trigger on `enrichment_records` (AFTER INSERT OR UPDATE OR DELETE)
    - `notify_search_index_records()` trigger on `records` table (AFTER INSERT OR UPDATE OR DELETE)
    - `notify_search_index_scrape(p_task_id, p_workspace_id, p_job_id)` callable function
    - All NOTIFY payloads contain only identifiers (UUIDs + operation type) to stay under 8KB limit
    - Include up/down functions
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 3. Checkpoint — Ensure all migrations are correct
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Index mapping and Zod schemas
  - [x] 4.1 Create `src/modules/search/mappings/workspace-index.v1.ts`
    - Export the OpenSearch index mapping definition with `morket_analyzer` (standard tokenizer + lowercase + asciifolding + edge_ngram min 2 max 15)
    - Apply `morket_analyzer` at index time and `standard` analyzer at search time for `name`, `email`, `company`, `job_title`, `location` fields
    - All field types per design: keyword, text with keyword sub-field, date, object (enabled: false)
    - _Requirements: 2.2, 2.3, 2.4, 2.7_

  - [x] 4.2 Create `src/modules/search/search.schemas.ts`
    - `searchQuerySchema`: q (string max 500), filters (keyword arrays + date ranges), facets, page/pageSize (max 100), sort (field + direction), fuzziness
    - `suggestQuerySchema`: q (string min 2, max 100)
    - `searchResultSchema`: all document fields, score, highlights
    - `workspaceParamsSchema`: id (UUID)
    - _Requirements: 5.10, 7.7, 9.1, 14.1, 14.4_

  - [x] 4.3 Write property test: SearchQuery serialization round-trip (Property 1)
    - **Property 1: SearchQuery serialization round-trip**
    - Generate arbitrary SearchQuery objects, serialize to JSON, deserialize through `searchQuerySchema.parse()`, verify deep equality
    - **Validates: Requirements 14.3**

  - [x] 4.4 Write property test: SearchResult serialization round-trip (Property 2)
    - **Property 2: SearchResult serialization round-trip**
    - Generate arbitrary SearchResult objects, parse through `searchResultSchema.parse()`, re-serialize, verify equality
    - **Validates: Requirements 14.5**

  - [x] 4.5 Write property test: Index naming follows workspace pattern (Property 15)
    - **Property 15: Index naming follows workspace pattern**
    - Generate random UUIDs, verify index name is exactly `morket-workspace-{workspaceId}` and is deterministic
    - **Validates: Requirements 2.1**

  - [x] 4.6 Write property test: NOTIFY payload contains only identifiers (Property 16)
    - **Property 16: NOTIFY payload contains only identifiers**
    - Generate random record IDs and operation types, verify payload contains only identifier fields and is under 8000 bytes
    - **Validates: Requirements 8.5**

- [x] 5. Search repository and service — index management
  - [x] 5.1 Create `src/modules/search/search.repository.ts`
    - PostgreSQL queries for: `upsertIndexStatus`, `getIndexStatus`, `createReindexJob`, `updateReindexProgress`, `getLatestReindexJob`
    - Full document fetch queries: `fetchEnrichmentRecord`, `fetchContactCompanyRecord`, `fetchScrapeResult` (for indexing pipeline)
    - Cursor-based batch queries: `fetchEnrichmentRecordsBatch`, `fetchContactCompanyRecordsBatch`, `fetchScrapeResultsBatch` (for bulk reindex)
    - All parameterized queries, snake_case → camelCase mapping
    - _Requirements: 3.4, 4.1, 4.4, 13.1, 13.2_

  - [x] 5.2 Create `src/modules/search/search.service.ts` with factory function `createSearchService(cache)`
    - Implement `createWorkspaceIndex(workspaceId)` — creates index `morket-workspace-{workspaceId}` with v1 mapping
    - Implement `deleteWorkspaceIndex(workspaceId)` — deletes the workspace index
    - Implement `reindexWorkspace(workspaceId)` — acquires advisory lock (`pg_advisory_xact_lock`), creates reindex job, reads records in cursor-based batches of 500, bulk indexes to OpenSearch, updates progress, handles partial failures
    - Implement `getReindexStatus(workspaceId)` — returns latest reindex job status and progress
    - _Requirements: 2.1, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.3 Write unit tests for search repository
    - Test parameterized queries, cursor pagination, document fetch transformations
    - _Requirements: 3.4, 4.4_

  - [x] 5.4 Write unit tests for index management in search service
    - Test createWorkspaceIndex, deleteWorkspaceIndex, reindexWorkspace (mock OpenSearch client), advisory lock acquisition, partial failure handling
    - _Requirements: 2.1, 2.5, 2.6, 4.5, 4.7_

- [x] 6. Search service — query execution, suggestions, and facets
  - [x] 6.1 Implement `search(workspaceId, query)` in search service
    - Build OpenSearch query: multi-match across `name`, `email`, `company`, `job_title`, `location` with configurable fuzziness
    - Parse `field:value` syntax for field-specific search (validate field against allowlist)
    - Apply term filters for keyword fields, range filters for date fields
    - Add mandatory `workspace_id` term filter for workspace scoping
    - Add highlight configuration with `<mark>` tags, fragment size 150
    - Add terms aggregations for facets (document_type, provider_slug, enrichment_status, scrape_target_type, tags) with min_doc_count 1
    - Compute pagination: `from = (page - 1) * pageSize`, `size = pageSize`, reject if `page * pageSize > 10000`
    - Apply sort configuration
    - Set 10s query timeout; throw 408 on timeout, 503 on unreachable
    - Escape user search terms to prevent query injection
    - Return results with highlights, facets, and pagination metadata in JSON envelope
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 9.3, 9.4, 9.5, 9.6, 9.7, 15.1, 15.6_

  - [x] 6.2 Implement `suggest(workspaceId, prefix)` in search service
    - Query `name`, `company`, `job_title` fields using edge_ngram sub-field
    - Scope to workspace_id
    - Deduplicate suggestions, sort by document frequency, return max 10
    - Check LRU cache first (key: `search:{workspaceId}:suggest:{prefix}`, TTL 30s); on miss, query OpenSearch and cache result
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 15.2, 15.3_

  - [x] 6.3 Write property test: Workspace scoping on all queries (Property 5)
    - **Property 5: Workspace scoping on all queries**
    - Generate random workspace UUIDs and search/suggest queries, verify built OpenSearch query body always contains workspace_id term filter
    - **Validates: Requirements 5.9, 7.5**

  - [x] 6.4 Write property test: Field-specific query parsing (Property 6)
    - **Property 6: Field-specific query parsing**
    - Generate random `field:value` strings and plain search terms, verify correct query type (field-specific match vs multi-match)
    - **Validates: Requirements 5.2**

  - [x] 6.5 Write property test: Filter application produces correct query clauses (Property 7)
    - **Property 7: Filter application produces correct query clauses**
    - Generate random filter combinations (0–5 keyword filters, 0–2 date ranges), verify correct number and type of filter clauses in generated query
    - **Validates: Requirements 5.4, 5.5**

  - [x] 6.6 Write property test: Pagination with max window guard (Property 8)
    - **Property 8: Pagination computes correct from/size with max window guard**
    - Generate random page (1–1000) and pageSize (1–100), verify from/size calculation and rejection when page × pageSize > 10,000
    - **Validates: Requirements 5.7, 15.6**

  - [x] 6.7 Write property test: Response envelope structure (Property 9)
    - **Property 9: Response envelope structure**
    - Generate random search responses, verify envelope has success/data/error/meta, and meta has correct pagination math (totalPages = ceil(total / pageSize))
    - **Validates: Requirements 9.4, 9.5**

  - [x] 6.8 Write property test: Suggestion response invariants (Property 10)
    - **Property 10: Suggestion response invariants**
    - Generate random suggestion arrays, verify max 10 items, no duplicates, sorted by frequency descending
    - **Validates: Requirements 7.1, 7.3, 7.4**

  - [x] 6.9 Write property test: Facet buckets have no zero counts (Property 11)
    - **Property 11: Facet buckets have no zero counts**
    - Generate random facet results, verify every bucket has count ≥ 1
    - **Validates: Requirements 6.4**

  - [x] 6.10 Write unit tests for search and suggest in search service
    - Mock OpenSearch client; test multi-match query, field:value parsing, facet filters, date range filters, highlight config, sort, pagination, zero results (200 with empty array), timeout (408), unreachable (503)
    - _Requirements: 5.1–5.10, 6.1–6.5, 7.1–7.7, 9.3, 9.6, 9.7_

- [x] 7. Checkpoint — Ensure search service logic is correct
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Search cache
  - [x] 8.1 Create `src/modules/search/search.cache.ts`
    - LRU cache matching `analytics.cache.ts` pattern
    - Key format: `search:{workspaceId}:suggest:{prefix}`, default TTL 30s, max 500 entries
    - Methods: `get(key)`, `set(key, data, ttlMs?)`, `invalidateWorkspace(workspaceId)`, `clear()`, `size()`
    - _Requirements: 15.3, 15.4, 15.5_

  - [x] 8.2 Write property test: Cache key isolation by workspace (Property 13)
    - **Property 13: Cache key isolation by workspace**
    - Generate pairs of distinct workspace UUIDs with same prefix, verify separate cache entries stored and returned
    - **Validates: Requirements 15.3, 15.4**

  - [x] 8.3 Write property test: Cache invalidation on index flush (Property 14)
    - **Property 14: Cache invalidation on index flush**
    - Populate cache for a workspace, simulate flush/invalidation, verify subsequent get returns cache miss
    - **Validates: Requirements 15.5**

  - [x] 8.4 Write unit tests for search cache
    - Test LRU eviction, TTL expiry, workspace invalidation clears all matching keys, get returns null for expired entries
    - _Requirements: 15.3, 15.4, 15.5_

- [x] 9. Search indexing pipeline
  - [x] 9.1 Create `src/modules/search/search.indexing-pipeline.ts`
    - Dedicated `pg.Client` connection for LISTEN (not from pool) — same pattern as `createReplicationService()`
    - Listen on channels: `search_index_enrichment`, `search_index_records`, `search_index_scrape`
    - On NOTIFY: parse JSON payload, fetch full document from PostgreSQL using record IDs, transform to OpenSearch document matching index mapping
    - In-memory event buffer: flush on batch size (default 50) or flush interval (default 3s), whichever comes first
    - Bulk index/delete requests to OpenSearch
    - Retry failed bulk operations 3 times with exponential backoff (1s, 2s, 4s); log failed documents on exhaustion
    - Invalidate suggestion cache for affected workspace IDs after each flush
    - Idempotent: re-indexing same record_id overwrites without duplicates
    - Graceful shutdown: flush remaining buffer on SIGTERM, close dedicated PG connection
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 9.2 Wire indexing pipeline startup into `src/index.ts`
    - Start after pool and OpenSearch init, stop on shutdown
    - _Requirements: 3.9_

  - [x] 9.3 Write property test: Document transformation preserves required fields (Property 3)
    - **Property 3: Document transformation preserves required fields**
    - Generate random PG rows for each document type, verify transformed OpenSearch documents have all required fields (document_type, record_id, workspace_id, created_at, updated_at) with correct types
    - **Validates: Requirements 3.4**

  - [x] 9.4 Write property test: Idempotent indexing (Property 4)
    - **Property 4: Idempotent indexing**
    - Verify that indexing the same document multiple times produces exactly one document with that record_id (uses _id = record_id in bulk request)
    - **Validates: Requirements 3.8**

  - [x] 9.5 Write unit tests for indexing pipeline
    - Mock PG client and OpenSearch client; test event buffering, flush on batch size, flush on interval, retry behavior, DELETE handling, cache invalidation on flush, graceful shutdown
    - _Requirements: 3.1–3.9_

- [x] 10. Search controller and routes
  - [x] 10.1 Create `src/modules/search/search.controller.ts` with factory function `createSearchController(service)`
    - `search` — POST handler: extract workspaceId from params, parse validated body, call service.search, return JSON envelope with data + meta (facets, pagination, executionTimeMs)
    - `suggest` — GET handler: extract workspaceId + q param, call service.suggest, return JSON envelope
    - `reindex` — POST handler: extract workspaceId, call service.reindexWorkspace, return 202 with job info
    - `getReindexStatus` — GET handler: extract workspaceId, call service.getReindexStatus, return JSON envelope
    - `getClusterHealth` — GET handler: call service.getClusterHealth, return JSON envelope
    - `getIndexList` — GET handler: call service.getIndexList, return JSON envelope
    - _Requirements: 5.1, 5.10, 7.1, 7.7, 4.3, 9.1, 9.2, 9.4, 12.1, 12.2_

  - [x] 10.2 Create `src/modules/search/search.routes.ts`
    - Factory function `createSearchRoutes()` returning `{ searchRoutes, adminSearchRoutes }`
    - `searchRoutes` (workspace-scoped, mergeParams: true): POST `/search` (member+), GET `/search/suggest` (member+), POST `/search/reindex` (admin), GET `/search/reindex/status` (admin)
    - `adminSearchRoutes`: GET `/admin/search/health` (admin), GET `/admin/search/indices` (admin)
    - Zod validation middleware on all endpoints
    - RBAC middleware via `requireRole()`
    - _Requirements: 5.1, 5.10, 7.1, 7.7, 9.1, 12.1, 12.2_

  - [x] 10.3 Wire search routes into `src/app.ts`
    - Mount `searchRoutes` under workspace router, `adminSearchRoutes` at top level
    - Add OpenSearch health to existing `/api/v1/health` endpoint (non-blocking — report status as "unavailable" if unreachable)
    - _Requirements: 12.4, 12.5_

  - [x] 10.4 Write property test: Invalid inputs return 400 (Property 12)
    - **Property 12: Invalid inputs return 400**
    - Generate strings outside valid ranges (search term > 500 chars, suggest prefix < 2 chars, invalid sort field, pageSize > 100, non-UUID workspace ID), verify 400 response with field-level errors
    - **Validates: Requirements 9.2, 7.7**

  - [x] 10.5 Write unit tests for search controller
    - Mock service; test HTTP request/response handling, status codes (200, 202, 400, 408, 503), JSON envelope format, pagination metadata
    - _Requirements: 9.1–9.7_

- [x] 11. Checkpoint — Ensure backend search API is fully functional
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Admin health monitoring
  - [x] 12.1 Implement `getClusterHealth()` and `getIndexList()` in search service
    - `getClusterHealth()`: return cluster status (green/yellow/red), node count, active shards, unassigned shards, cluster name
    - `getIndexList()`: return all `morket-workspace-*` indexes with document count, storage size, health status
    - Log error-level message every 60s when cluster status is "red" (use interval timer, clear on recovery)
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 12.2 Write unit tests for health monitoring
    - Test cluster health response formatting, index list filtering, red status logging interval
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 13. Frontend types and API client
  - [x] 13.1 Create `packages/frontend/src/types/search.types.ts`
    - TypeScript types: `SearchQuery`, `SearchFilters`, `SearchSort`, `SearchResult`, `FacetBucket`, `Suggestion`, `SearchResponse`, `SuggestResponse`, `ReindexStatus`
    - _Requirements: 5.1, 6.1, 7.1_

  - [x] 13.2 Create `packages/frontend/src/api/search.api.ts`
    - `searchRecords(workspaceId, query)` — POST `/api/v1/workspaces/:id/search`
    - `fetchSuggestions(workspaceId, prefix)` — GET `/api/v1/workspaces/:id/search/suggest?q={prefix}`
    - `triggerReindex(workspaceId)` — POST `/api/v1/workspaces/:id/search/reindex`
    - `getReindexStatus(workspaceId)` — GET `/api/v1/workspaces/:id/search/reindex/status`
    - _Requirements: 5.1, 7.1, 4.3_

- [x] 14. Frontend Zustand store and search hook
  - [x] 14.1 Create `packages/frontend/src/stores/search.store.ts`
    - Zustand store with state: query, filters, sort, page, pageSize, results, totalResults, totalPages, facets, executionTimeMs, suggestions, suggestionsLoading, loading, error
    - Actions: `setQuery`, `executeSearch(workspaceId)`, `fetchSuggestions(workspaceId, prefix)`, `toggleFacet(field, value)`, `setSort`, `setPage`, `clearFilters`, `reset`
    - _Requirements: 10.2, 11.5, 11.6, 11.7_

  - [x] 14.2 Create `packages/frontend/src/hooks/useSearch.ts`
    - Custom hook wrapping store actions with debounced suggestion fetching (200ms)
    - _Requirements: 10.2_

  - [x] 14.3 Write unit tests for search store
    - Test state transitions, API call mocking with msw, filter toggling, pagination, reset
    - _Requirements: 10.2, 11.5_

- [x] 15. Frontend SearchBar component
  - [x] 15.1 Create `packages/frontend/src/components/search/SearchBar.tsx`
    - Text input with search icon in App Shell header, visible on all authenticated pages
    - Debounced autocomplete: fetch suggestions after 2+ chars typed, 200ms debounce
    - Suggestion dropdown with keyboard navigation (Arrow Up/Down, Enter, Escape)
    - Click or Enter on suggestion: populate input, navigate to Search Results View
    - Enter without suggestion: navigate with current input text
    - Escape or click outside: close dropdown
    - Clear button (X icon) when input has text
    - Ctrl/Cmd+K global shortcut to focus search bar
    - Keyboard shortcut hint displayed when focused
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 15.2 Write unit tests for SearchBar
    - Test keyboard navigation, debounce behavior, suggestion selection, clear button, Ctrl/Cmd+K shortcut, Escape closes dropdown
    - _Requirements: 10.1–10.8_

- [x] 16. Frontend Search Results View
  - [x] 16.1 Create `packages/frontend/src/components/search/SearchResultCard.tsx`
    - Display document type icon, name/title, highlighted text fragments (`<mark>` tags), provider badge, status badge, timestamp
    - Click navigates to source record based on document_type
    - _Requirements: 11.2, 11.3, 11.8_

  - [x] 16.2 Create `packages/frontend/src/components/search/FacetSidebar.tsx`
    - Checkboxes for each facet field (document_type, provider_slug, enrichment_status, scrape_target_type, tags) with document counts
    - Toggle updates active filters and re-executes search
    - _Requirements: 11.4, 11.5_

  - [x] 16.3 Create `packages/frontend/src/components/search/SearchPagination.tsx`
    - Current page, total pages, total results, Previous/Next buttons
    - _Requirements: 11.6_

  - [x] 16.4 Create `packages/frontend/src/components/search/SearchResultsView.tsx`
    - Route: `/workspaces/:workspaceId/search`
    - Compose SearchResultCard, FacetSidebar, SearchPagination
    - Sort dropdown: Relevance, Newest First, Oldest First, Name (A-Z)
    - Display total result count and query execution time at top
    - Skeleton placeholders while loading (don't block facet sidebar or sort)
    - Empty state with suggestions to broaden search
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11_

  - [x] 16.5 Add search route to frontend router and integrate SearchBar into App Shell header
    - _Requirements: 10.1, 11.1_

  - [x] 16.6 Write unit tests for SearchResultsView
    - Test result rendering, facet toggling, pagination controls, sort dropdown, empty state, skeleton loading, highlighted text rendering
    - _Requirements: 11.1–11.11_

- [x] 17. Integration tests
  - [x] 17.1 Write backend integration tests in `tests/integration/search.integration.test.ts`
    - Full search flow: index a document → search → verify result
    - Reindex flow: create workspace → bulk reindex → verify documents indexed
    - Faceted search: index documents with different types → filter → verify results and facet counts
    - Suggest flow: index documents → query suggestions → verify autocomplete
    - Health endpoint returns cluster status
    - Admin indices endpoint returns workspace index list
    - _Requirements: 5.1, 4.1, 6.1, 7.1, 12.1, 12.2_

- [x] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests go in `packages/backend/tests/property/search.property.test.ts` using fast-check with 100+ iterations
- Unit tests are co-located with source files as `*.test.ts`
- Migrations are numbered sequentially starting from 014
- Backend follows existing layered architecture: Routes → Controllers → Services → Repository
- Frontend follows existing patterns: Zustand stores, React components, @testing-library/react + vitest + msw
