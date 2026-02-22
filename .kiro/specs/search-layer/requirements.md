# Requirements Document

## Introduction

Module 6 implements the search layer for the Morket GTM data engine. This module introduces OpenSearch as a full-text search engine alongside the existing PostgreSQL OLTP store and ClickHouse OLAP store, enabling workspace users to perform fast, flexible searches across enrichment records, contact/company data, and scrape results. The module consists of five major components: (1) OpenSearch client and index management with workspace-scoped mappings optimized for full-text search, faceted filtering, and autocomplete, (2) a data indexing pipeline that syncs records from PostgreSQL to OpenSearch via PG NOTIFY triggers and bulk indexing for initial loads, (3) a REST API layer exposing search, suggest, and index management endpoints under workspace routes with Zod validation and RBAC, (4) a frontend search UI with instant search, faceted filters, result highlighting, and autocomplete integrated into the App Shell, and (5) health monitoring for the OpenSearch cluster. The search layer gives workspace members the ability to find any record across their enrichment and scraping data using natural language queries, field-specific filters, and fuzzy matching.

## Glossary

- **Search_Service**: The backend service module responsible for executing search queries against OpenSearch, managing indexes, and serving search results through REST API endpoints.
- **OpenSearch_Client**: The connection manager that maintains a persistent connection to the OpenSearch cluster, executes queries, and handles retries on transient failures.
- **Indexing_Pipeline**: The background process that listens for PostgreSQL NOTIFY events on data change channels, transforms records into OpenSearch documents, and indexes them into the appropriate workspace index.
- **Workspace_Index**: An OpenSearch index scoped to a single workspace, containing all searchable documents (enrichment records, contact/company records, scrape results) for that workspace. Named using the pattern `morket-workspace-{workspaceId}`.
- **Index_Mapping**: The OpenSearch field mapping definition for a Workspace_Index, specifying field types (text, keyword, date, integer), analyzers, and sub-fields for search and aggregation.
- **Search_Query**: A structured query object containing a search term, optional field filters, facet selections, pagination parameters, and sort configuration.
- **Search_Result**: A single document returned from an OpenSearch query, including the document fields, relevance score, and highlighted text fragments.
- **Facet**: An aggregation bucket computed by OpenSearch that groups search results by a specific field value (e.g., provider, status, domain), returning the count of documents per bucket for filtering.
- **Suggestion**: An autocomplete suggestion generated from indexed data, returned as the user types a search query to assist with query formulation.
- **Bulk_Indexer**: The component responsible for indexing large batches of existing records from PostgreSQL into OpenSearch during initial setup or reindexing operations.
- **Index_Event_Buffer**: An in-memory buffer within the Indexing_Pipeline that accumulates change events and flushes them to OpenSearch in configurable batch sizes.
- **Search_Store**: The Zustand store in the frontend managing the current search query, search results, active facet filters, suggestion list, loading states, and pagination.
- **Search_Bar**: The frontend UI component rendered in the App Shell header providing instant search input with autocomplete suggestions and keyboard navigation.
- **Search_Results_View**: The frontend page that displays search results with highlighted matches, faceted filter sidebar, pagination, and sort controls.
- **Document_Type**: A categorical label assigned to each indexed document indicating its source: "enrichment_record", "contact", "company", or "scrape_result".

## Requirements

### Requirement 1: OpenSearch Client and Connection Management

**User Story:** As a developer, I want a reliable OpenSearch client with connection management and retry logic, so that search operations are resilient to transient cluster failures.

#### Acceptance Criteria

1. THE OpenSearch_Client SHALL maintain a persistent connection to the OpenSearch cluster using the official `@opensearch-project/opensearch` Node.js client with configurable node URLs, request timeout (default 10 seconds), and max retries (default 3)
2. WHEN the OpenSearch_Client executes a query or indexing operation and the cluster is unreachable, THE OpenSearch_Client SHALL retry up to 3 times with exponential backoff (1s, 2s, 4s) before returning an error
3. THE OpenSearch_Client SHALL validate the OpenSearch cluster connection on service startup and log a warning if the connection fails, without blocking the Express API from starting
4. THE OpenSearch_Client SHALL read cluster configuration from environment variables: `OPENSEARCH_NODE_URLS` (comma-separated), `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, and `OPENSEARCH_REQUEST_TIMEOUT_MS`
5. IF the OpenSearch cluster requires TLS, THEN THE OpenSearch_Client SHALL support configurable TLS settings via the `OPENSEARCH_SSL_CERT_PATH` environment variable
6. THE OpenSearch_Client SHALL expose a health check method that returns the cluster health status (green, yellow, red), number of active nodes, and number of active shards


### Requirement 2: Index Management and Mapping

**User Story:** As a developer, I want automated index creation and mapping management, so that each workspace has a properly configured search index with the correct field types and analyzers.

#### Acceptance Criteria

1. WHEN a new workspace is created, THE Search_Service SHALL create a Workspace_Index named `morket-workspace-{workspaceId}` with the predefined Index_Mapping
2. THE Index_Mapping SHALL define the following fields with appropriate types: `document_type` (keyword), `record_id` (keyword), `workspace_id` (keyword), `name` (text with keyword sub-field), `email` (text with keyword sub-field), `company` (text with keyword sub-field), `job_title` (text with keyword sub-field), `location` (text with keyword sub-field), `phone` (keyword), `domain` (keyword), `provider_slug` (keyword), `enrichment_status` (keyword), `enrichment_fields` (keyword array), `raw_data` (object, enabled: false), `tags` (keyword array), `source_url` (keyword), `scrape_target_type` (keyword), `created_at` (date), `updated_at` (date)
3. THE Index_Mapping SHALL configure a custom analyzer named `morket_analyzer` using the standard tokenizer with lowercase, asciifolding, and edge_ngram (min 2, max 15) token filters for autocomplete support
4. THE Index_Mapping SHALL apply the `morket_analyzer` to the `name`, `email`, `company`, `job_title`, and `location` text fields at index time, and use the standard analyzer at search time
5. WHEN a workspace is deleted, THE Search_Service SHALL delete the corresponding Workspace_Index from OpenSearch
6. THE Search_Service SHALL provide a reindex endpoint that deletes and recreates a Workspace_Index with the latest Index_Mapping and triggers a full re-import from PostgreSQL
7. THE Search_Service SHALL store index mapping definitions as versioned configuration files under `packages/backend/src/modules/search/mappings/` to support future mapping evolution

### Requirement 3: Data Indexing Pipeline — Incremental Updates

**User Story:** As a developer, I want data changes in PostgreSQL automatically synced to OpenSearch in near-real-time, so that search results reflect recent record updates without manual intervention.

#### Acceptance Criteria

1. WHEN an enrichment_record is inserted or updated in PostgreSQL, THE Indexing_Pipeline SHALL receive a PG NOTIFY event on the "search_index_enrichment" channel containing the record_id and operation type (INSERT, UPDATE, or DELETE)
2. WHEN a contact or company record is inserted, updated, or deleted in the spreadsheet data tables, THE Indexing_Pipeline SHALL receive a PG NOTIFY event on the "search_index_records" channel containing the record_id and operation type
3. WHEN a scrape result is persisted via the scraper webhook callback, THE Indexing_Pipeline SHALL receive a PG NOTIFY event on the "search_index_scrape" channel containing the task_id and operation type
4. WHEN the Index_Event_Buffer receives a PG NOTIFY event, THE Index_Event_Buffer SHALL fetch the full document data from PostgreSQL, transform the record into an OpenSearch document matching the Index_Mapping, and add the document to the in-memory buffer
5. WHEN the Index_Event_Buffer reaches a configurable batch size (default 50 documents) or a configurable flush interval (default 3 seconds) elapses, THE Indexing_Pipeline SHALL send a bulk index request to OpenSearch for the buffered documents
6. WHEN a DELETE operation is received, THE Indexing_Pipeline SHALL send a bulk delete request to remove the document from the Workspace_Index
7. IF a bulk index request to OpenSearch fails, THEN THE Indexing_Pipeline SHALL retry the batch up to 3 times with exponential backoff (1s, 2s, 4s) before logging the failed documents as errors
8. THE Indexing_Pipeline SHALL process events idempotently — re-indexing a document with the same record_id SHALL overwrite the existing document without producing duplicates
9. THE Indexing_Pipeline SHALL run as a background process within the Express API server, started during application initialization and gracefully shut down on SIGTERM

### Requirement 4: Bulk Indexing for Initial Data Load

**User Story:** As a developer, I want a bulk indexing mechanism for loading existing data into OpenSearch, so that workspaces with pre-existing records have searchable data immediately after the search feature is enabled.

#### Acceptance Criteria

1. WHEN an admin sends POST /api/v1/workspaces/:id/search/reindex, THE Bulk_Indexer SHALL read all enrichment records, contact/company records, and scrape results for the workspace from PostgreSQL and index them into the Workspace_Index
2. THE Bulk_Indexer SHALL process records in batches of 500 documents per bulk request to avoid overwhelming the OpenSearch cluster
3. WHEN a bulk indexing operation is in progress, THE Search_Service SHALL return the indexing status (running, completed, failed) and progress (documents indexed / total documents) via GET /api/v1/workspaces/:id/search/reindex/status
4. THE Bulk_Indexer SHALL use scroll queries against PostgreSQL with cursor-based pagination to avoid loading the entire dataset into memory
5. IF a bulk indexing batch fails after retries, THEN THE Bulk_Indexer SHALL log the failed batch details and continue with the remaining batches rather than aborting the entire operation
6. WHEN the bulk indexing operation completes, THE Bulk_Indexer SHALL log the total documents indexed, total failures, and elapsed time
7. THE Bulk_Indexer SHALL acquire a distributed lock (using PostgreSQL advisory locks) before starting a reindex operation to prevent concurrent reindex runs for the same workspace


### Requirement 5: Full-Text Search API

**User Story:** As a workspace member, I want to search across all my workspace data using natural language queries with filters and sorting, so that I can quickly find specific contacts, companies, or enrichment results.

#### Acceptance Criteria

1. WHEN a member or higher role sends POST /api/v1/workspaces/:id/search with a Search_Query containing a search term, THE Search_Service SHALL execute a multi-match query against the `name`, `email`, `company`, `job_title`, and `location` fields in the Workspace_Index and return matching Search_Results
2. THE Search_Service SHALL support field-specific search using the syntax `field:value` within the search term (e.g., `company:Acme` searches only the company field)
3. THE Search_Service SHALL support fuzzy matching with a configurable fuzziness parameter (default "AUTO") to handle typos and spelling variations
4. WHEN the Search_Query includes filter parameters, THE Search_Service SHALL apply term filters for keyword fields (`document_type`, `provider_slug`, `enrichment_status`, `scrape_target_type`, `tags`) as boolean must clauses
5. WHEN the Search_Query includes a date range filter on `created_at` or `updated_at`, THE Search_Service SHALL apply a range filter with the specified start and end dates
6. THE Search_Service SHALL return search results with highlighted text fragments for matching fields, using `<mark>` tags as the highlight delimiter with a fragment size of 150 characters
7. THE Search_Service SHALL support pagination via `page` (default 1) and `pageSize` (default 20, max 100) parameters, returning total hit count and pagination metadata in the `meta` field of the JSON envelope
8. THE Search_Service SHALL support sorting by `_score` (relevance, default), `created_at`, `updated_at`, or `name` in ascending or descending order
9. THE Search_Service SHALL scope all search queries to the authenticated user's workspace_id by including a mandatory term filter on `workspace_id` to prevent cross-workspace data access
10. THE Search_Service SHALL validate the Search_Query using a Zod schema at the middleware level before executing the OpenSearch query

### Requirement 6: Faceted Search and Aggregations

**User Story:** As a workspace member, I want to see aggregated counts by category alongside my search results, so that I can narrow down results using faceted filters.

#### Acceptance Criteria

1. WHEN a search query is executed, THE Search_Service SHALL return Facets for the following fields: `document_type`, `provider_slug`, `enrichment_status`, `scrape_target_type`, and `tags`, each containing up to 20 buckets with document counts
2. WHEN the Search_Query includes active facet filter selections, THE Search_Service SHALL apply the selected facet values as term filters and recompute the remaining facet counts to reflect the filtered result set
3. THE Search_Service SHALL return facet results in the `meta.facets` field of the JSON envelope, structured as an object keyed by field name with each value being an array of `{ value, count }` objects
4. WHEN a facet field has zero matching documents for a bucket, THE Search_Service SHALL omit that bucket from the facet results rather than returning a zero count
5. THE Search_Service SHALL compute facets using OpenSearch terms aggregations with a minimum document count of 1

### Requirement 7: Search Suggestions and Autocomplete

**User Story:** As a workspace member, I want autocomplete suggestions as I type my search query, so that I can find records faster and discover relevant search terms.

#### Acceptance Criteria

1. WHEN a member or higher role sends GET /api/v1/workspaces/:id/search/suggest?q={prefix} with a prefix of at least 2 characters, THE Search_Service SHALL return up to 10 autocomplete suggestions matching the prefix
2. THE Search_Service SHALL generate suggestions from the `name`, `company`, and `job_title` fields using the edge_ngram sub-field configured in the Index_Mapping
3. THE Search_Service SHALL deduplicate suggestions so that identical text values from different documents appear only once in the suggestion list
4. THE Search_Service SHALL return suggestions sorted by document frequency (most common matches first)
5. THE Search_Service SHALL scope suggestion queries to the authenticated user's workspace_id
6. THE Search_Service SHALL execute suggestion queries within 100 milliseconds for indexes with up to 1 million documents
7. THE Search_Service SHALL validate the suggestion query parameter using a Zod schema requiring a minimum length of 2 characters and a maximum length of 100 characters

### Requirement 8: PostgreSQL Triggers for Search Indexing

**User Story:** As a developer, I want PostgreSQL triggers that emit NOTIFY events on data changes, so that the indexing pipeline receives change events without polling.

#### Acceptance Criteria

1. THE Database_Schema SHALL define a PostgreSQL trigger on the enrichment_records table that fires AFTER INSERT OR UPDATE OR DELETE and sends a PG NOTIFY on the "search_index_enrichment" channel with a JSON payload containing the record_id, workspace_id, and operation type (INSERT, UPDATE, or DELETE)
2. THE Database_Schema SHALL define a PostgreSQL trigger on the contact/company records table (spreadsheet data) that fires AFTER INSERT OR UPDATE OR DELETE and sends a PG NOTIFY on the "search_index_records" channel with a JSON payload containing the record_id, workspace_id, and operation type
3. THE Database_Schema SHALL define a PostgreSQL function that the scraper webhook handler calls after persisting scrape results, sending a PG NOTIFY on the "search_index_scrape" channel with a JSON payload containing the task_id, workspace_id, and job_id
4. THE Database_Schema SHALL store these triggers and functions as sequential numbered migration files under `packages/backend/migrations/`
5. THE PG NOTIFY payload SHALL be limited to identifiers only (UUIDs and operation type) — the Indexing_Pipeline SHALL fetch full document data from PostgreSQL using the identifiers to avoid exceeding the 8000-byte NOTIFY payload limit


### Requirement 9: Search API Input Validation and Error Handling

**User Story:** As a developer, I want all search API inputs validated and errors handled consistently, so that the search endpoints are robust and return predictable responses.

#### Acceptance Criteria

1. THE Search_Service SHALL validate all request bodies and query parameters (search term, filters, pagination, sort) using Zod schemas at the middleware level before executing queries
2. IF a request parameter fails Zod validation, THEN THE Search_Service SHALL return a 400 status code with field-level validation errors in the JSON envelope
3. IF OpenSearch is unreachable when a search query is executed, THEN THE Search_Service SHALL return a 503 status code with an error message indicating the search service is temporarily unavailable
4. THE Search_Service SHALL return all responses in the standard JSON envelope format `{ success, data, error, meta }` consistent with existing backend endpoints
5. THE Search_Service SHALL include pagination metadata (total, page, pageSize, totalPages) in the `meta` field for search result responses
6. WHEN a search query returns zero results, THE Search_Service SHALL return a 200 status code with an empty data array and zero-value facets rather than a 404
7. IF a search query takes longer than 10 seconds to execute, THEN THE Search_Service SHALL abort the query and return a 408 status code with a timeout error message

### Requirement 10: Frontend Search Bar and Autocomplete

**User Story:** As a workspace member, I want a search bar in the application header with instant autocomplete, so that I can quickly search across all my workspace data from any page.

#### Acceptance Criteria

1. THE Search_Bar SHALL be rendered in the App_Shell header bar, visible on all authenticated pages, with a text input and a search icon
2. WHEN the user types at least 2 characters in the Search_Bar, THE Search_Store SHALL send GET /api/v1/workspaces/:id/search/suggest?q={prefix} debounced by 200 milliseconds and display the returned suggestions in a dropdown below the input
3. WHEN the user selects a suggestion from the dropdown (via click or Enter key), THE Search_Bar SHALL populate the input with the selected suggestion text and navigate to the Search_Results_View with the selected term as the active query
4. WHEN the user presses Enter in the Search_Bar without selecting a suggestion, THE Search_Bar SHALL navigate to the Search_Results_View with the current input text as the active query
5. WHEN the user presses Escape or clicks outside the suggestion dropdown, THE Search_Bar SHALL close the dropdown without navigating
6. THE Search_Bar SHALL support keyboard navigation of the suggestion dropdown using Arrow Up, Arrow Down, and Enter keys
7. WHEN the Search_Bar is focused, THE Search_Bar SHALL display a keyboard shortcut hint (Ctrl/Cmd+K) and pressing Ctrl/Cmd+K from any page SHALL focus the Search_Bar
8. THE Search_Bar SHALL display a clear button (X icon) when the input contains text, and clicking the clear button SHALL empty the input and close the suggestion dropdown

### Requirement 11: Frontend Search Results View

**User Story:** As a workspace member, I want a search results page with highlighted matches, faceted filters, and pagination, so that I can browse and refine search results effectively.

#### Acceptance Criteria

1. THE Search_Results_View SHALL be accessible at the route `/workspaces/:workspaceId/search` and display results from POST /api/v1/workspaces/:id/search
2. THE Search_Results_View SHALL display each Search_Result as a card showing the document type icon, name/title, highlighted text fragments, provider badge, status badge, and timestamp
3. THE Search_Results_View SHALL render highlighted text fragments using `<mark>` tags with a distinct background color to visually distinguish matched terms
4. THE Search_Results_View SHALL render a faceted filter sidebar on the left showing checkboxes for each Facet (document type, provider, status, scrape target type, tags) with document counts
5. WHEN the user toggles a facet checkbox, THE Search_Store SHALL update the active filters and re-execute the search query with the selected facet values, updating both results and facet counts
6. THE Search_Results_View SHALL display pagination controls at the bottom showing current page, total pages, and total results, with Previous/Next buttons
7. THE Search_Results_View SHALL display a sort dropdown allowing the user to sort by Relevance, Newest First, Oldest First, or Name (A-Z)
8. WHEN the user clicks on a search result card, THE Search_Results_View SHALL navigate to the source record — enrichment record detail, spreadsheet row, or scrape result detail — depending on the document_type
9. WHEN search results are loading, THE Search_Results_View SHALL display skeleton placeholders for result cards without blocking interaction with the facet sidebar or sort controls
10. WHEN the search query returns zero results, THE Search_Results_View SHALL display an empty state message with suggestions to broaden the search (remove filters, check spelling, try different terms)
11. THE Search_Results_View SHALL display the total result count and query execution time at the top of the results list

### Requirement 12: OpenSearch Cluster Health Monitoring

**User Story:** As a developer, I want to monitor the health of the OpenSearch cluster, so that I can detect and respond to cluster issues before they impact search functionality.

#### Acceptance Criteria

1. THE Search_Service SHALL expose a GET /api/v1/admin/search/health endpoint (admin role required) that returns the OpenSearch cluster health status (green, yellow, red), number of nodes, number of active shards, number of unassigned shards, and cluster name
2. THE Search_Service SHALL expose a GET /api/v1/admin/search/indices endpoint (admin role required) that returns a list of all Workspace_Indexes with their document count, storage size, and health status
3. WHEN the OpenSearch cluster health status is "red", THE Search_Service SHALL log an error-level message every 60 seconds until the status recovers
4. THE Search_Service SHALL include OpenSearch cluster health in the existing GET /api/v1/health endpoint response, adding an `opensearch` field with status and latency
5. WHEN the OpenSearch cluster is unreachable during a health check, THE Search_Service SHALL report the opensearch status as "unavailable" in the health endpoint without causing the overall health check to fail

### Requirement 13: Search Module Database Schema

**User Story:** As a developer, I want a database schema to track search indexing state and reindex operations, so that the system can manage indexing progress and recover from failures.

#### Acceptance Criteria

1. THE Database_Schema SHALL define a `search_index_status` table with columns: id (UUID), workspace_id (UUID, foreign key to workspaces, unique), last_indexed_at (DateTime, nullable), document_count (integer default 0), index_version (integer default 1), status (varchar: active, reindexing, error), error_reason (text, nullable), created_at (DateTime), updated_at (DateTime)
2. THE Database_Schema SHALL define a `search_reindex_jobs` table with columns: id (UUID), workspace_id (UUID, foreign key to workspaces), status (varchar: pending, running, completed, failed), total_documents (integer default 0), indexed_documents (integer default 0), failed_documents (integer default 0), started_at (DateTime, nullable), completed_at (DateTime, nullable), error_reason (text, nullable), created_at (DateTime)
3. THE Database_Schema SHALL define indexes on `search_index_status(workspace_id)` UNIQUE and `search_reindex_jobs(workspace_id, created_at DESC)`
4. THE Database_Schema SHALL use UUID primary keys generated via `gen_random_uuid()` for all new tables
5. THE Database_Schema SHALL store these tables and the PG NOTIFY triggers as sequential numbered migration files under `packages/backend/migrations/`

### Requirement 14: Search Query Serialization Round-Trip

**User Story:** As a developer, I want search queries to be serializable and deserializable without data loss, so that queries can be stored, shared, and replayed reliably.

#### Acceptance Criteria

1. THE Search_Service SHALL define a Zod schema for the Search_Query object that validates the search term (string, max 500 characters), filters (object with optional keyword and date range fields), facets (array of field names), pagination (page, pageSize), and sort (field, direction)
2. THE Search_Service SHALL serialize Search_Query objects to JSON for logging and audit purposes
3. FOR ALL valid Search_Query objects, serializing to JSON and deserializing back through the Zod schema SHALL produce an equivalent Search_Query object (round-trip property)
4. THE Search_Service SHALL define a Zod schema for the Search_Result response that validates the document fields, score, and highlights
5. FOR ALL Search_Result responses returned by OpenSearch, parsing through the Search_Result Zod schema and re-serializing SHALL produce an equivalent object (round-trip property)

### Requirement 15: Search Performance and Caching

**User Story:** As a developer, I want search queries to execute within acceptable latency bounds, so that the search experience remains responsive even with large indexes.

#### Acceptance Criteria

1. THE Search_Service SHALL execute full-text search queries against OpenSearch within 200 milliseconds for indexes with up to 1 million documents
2. THE Search_Service SHALL execute suggestion queries within 100 milliseconds for indexes with up to 1 million documents
3. WHEN the same suggestion query prefix is requested within a configurable TTL (default 30 seconds), THE Search_Service SHALL return the cached result from an in-memory LRU cache without querying OpenSearch
4. THE Search_Service SHALL key the suggestion cache on workspace_id and query prefix to prevent serving cross-workspace suggestions
5. WHEN the Indexing_Pipeline flushes a batch of documents for a workspace, THE Search_Service SHALL invalidate cached suggestions for that workspace to ensure freshness
6. THE Search_Service SHALL limit the maximum result window (page × pageSize) to 10,000 documents to prevent deep pagination performance degradation, returning a 400 error if exceeded
