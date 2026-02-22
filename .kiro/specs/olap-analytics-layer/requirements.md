# Requirements Document

## Introduction

Module 5 implements the OLAP analytics layer for the Morket GTM data engine. This module introduces ClickHouse as a dedicated analytical database alongside the existing PostgreSQL OLTP store, enabling high-performance aggregation queries over enrichment and scraping event data without impacting transactional workloads. The module consists of four major components: (1) ClickHouse schema and connection management with denormalized tables optimized for read-heavy analytics, (2) a data replication pipeline that streams events from PostgreSQL to ClickHouse via PG NOTIFY and batch inserts, (3) a REST API layer exposing analytics query endpoints under workspace routes, and (4) a frontend analytics dashboard with interactive charts (Recharts) and CSV export. The analytics layer gives workspace owners and admins visibility into enrichment success rates, provider performance, credit consumption trends, scraping throughput, and record growth over time.

## Glossary

- **Analytics_Service**: The backend service module responsible for querying ClickHouse, computing aggregations, and serving analytics data through REST API endpoints.
- **ClickHouse_Client**: The connection manager that maintains a pool of HTTP connections to the ClickHouse server, executes parameterized queries, and handles retries on transient failures.
- **Replication_Pipeline**: The background process that listens for PostgreSQL NOTIFY events on enrichment and scraping channels, buffers incoming events, and batch-inserts them into ClickHouse at configurable intervals.
- **Enrichment_Events_Table**: A denormalized ClickHouse table storing one row per enrichment record event, including job metadata, provider details, credit consumption, status, and timestamps. Uses ReplacingMergeTree engine for deduplication.
- **Scrape_Events_Table**: A denormalized ClickHouse table storing one row per scrape task event, including job metadata, target domain, extractor type, status, duration, and timestamps. Uses ReplacingMergeTree engine for deduplication.
- **Credit_Events_Table**: A denormalized ClickHouse table storing one row per credit transaction event, including workspace, transaction type, amount, source (enrichment or manual), and timestamps. Uses ReplacingMergeTree engine for deduplication.
- **Analytics_Dashboard**: The frontend React component that renders interactive charts and summary tables for workspace analytics data using Recharts.
- **Time_Range_Filter**: A UI control and query parameter that constrains analytics queries to a specific time window (last 24h, 7d, 30d, 90d, or custom date range).
- **CSV_Exporter**: The backend component that streams analytics query results as CSV files for download, supporting large result sets without buffering the entire response in memory.
- **Event_Buffer**: An in-memory buffer within the Replication_Pipeline that accumulates PostgreSQL events and flushes them to ClickHouse in configurable batch sizes to optimize insert throughput.
- **Dead_Letter_Queue**: A PostgreSQL table that stores events that failed to replicate to ClickHouse after exhausting retries, enabling manual inspection and replay.
- **Analytics_Store**: The Zustand store in the frontend managing analytics query results, active time range filter, loading states, and chart configuration.

## Requirements

### Requirement 1: ClickHouse Schema and Connection Management

**User Story:** As a developer, I want a well-structured ClickHouse schema with reliable connection management, so that analytics queries execute efficiently against denormalized event data.

#### Acceptance Criteria

1. THE ClickHouse_Client SHALL maintain a pool of HTTP connections to the ClickHouse server with configurable pool size (default 5), connection timeout (default 5 seconds), and query timeout (default 30 seconds)
2. WHEN the ClickHouse_Client executes a query, THE ClickHouse_Client SHALL use parameterized queries to prevent SQL injection
3. IF the ClickHouse server is unreachable during a query, THEN THE ClickHouse_Client SHALL retry up to 3 times with exponential backoff (1s, 2s, 4s) before returning an error
4. THE Enrichment_Events_Table SHALL use the ReplacingMergeTree engine ordered by (workspace_id, created_at, event_id) with event_id as the deduplication version column, containing columns: event_id (UUID), workspace_id (UUID), job_id (UUID), record_id (UUID), provider_slug (LowCardinality String), enrichment_field (LowCardinality String), status (LowCardinality String: success, failed, skipped), credits_consumed (UInt32), duration_ms (UInt32), error_category (Nullable String), created_at (DateTime), job_created_at (DateTime)
5. THE Scrape_Events_Table SHALL use the ReplacingMergeTree engine ordered by (workspace_id, created_at, event_id) with event_id as the deduplication version column, containing columns: event_id (UUID), workspace_id (UUID), job_id (UUID), task_id (UUID), target_domain (LowCardinality String), target_type (LowCardinality String), status (LowCardinality String: completed, failed, cancelled), duration_ms (UInt32), proxy_used (Nullable String), error_category (Nullable String), created_at (DateTime), job_created_at (DateTime)
6. THE Credit_Events_Table SHALL use the ReplacingMergeTree engine ordered by (workspace_id, created_at, event_id) with event_id as the deduplication version column, containing columns: event_id (UUID), workspace_id (UUID), transaction_type (LowCardinality String: debit, refund, topup), amount (Int32), source (LowCardinality String: enrichment, scraping, manual), reference_id (Nullable UUID), provider_slug (Nullable LowCardinality String), created_at (DateTime)
7. THE ClickHouse_Client SHALL validate the ClickHouse connection on service startup and log a warning if the connection fails, without blocking the Express API from starting
8. THE Analytics_Service SHALL provide a migration mechanism to create and update ClickHouse tables, stored as sequential numbered SQL files under `packages/backend/migrations/clickhouse/`

### Requirement 2: PostgreSQL to ClickHouse Data Replication Pipeline

**User Story:** As a developer, I want enrichment, scraping, and credit events replicated from PostgreSQL to ClickHouse in near-real-time, so that analytics queries reflect recent activity without impacting OLTP performance.

#### Acceptance Criteria

1. WHEN a new enrichment_record is inserted or updated in PostgreSQL, THE Replication_Pipeline SHALL receive a PG NOTIFY event on the "enrichment_events" channel containing the record ID and operation type
2. WHEN a new scrape task result is received via webhook callback from the scraper service, THE Replication_Pipeline SHALL receive a PG NOTIFY event on the "scrape_events" channel containing the task ID and operation type
3. WHEN a credit transaction is committed in PostgreSQL, THE Replication_Pipeline SHALL receive a PG NOTIFY event on the "credit_events" channel containing the transaction ID and operation type
4. WHEN the Event_Buffer receives a PG NOTIFY event, THE Event_Buffer SHALL fetch the full denormalized event data from PostgreSQL and add the event to the in-memory buffer
5. WHEN the Event_Buffer reaches a configurable batch size (default 100 events) or a configurable flush interval (default 5 seconds) elapses, THE Replication_Pipeline SHALL batch-insert the buffered events into the corresponding ClickHouse table
6. IF a batch insert into ClickHouse fails, THEN THE Replication_Pipeline SHALL retry the batch up to 3 times with exponential backoff (1s, 2s, 4s)
7. IF a batch insert fails after exhausting all retries, THEN THE Replication_Pipeline SHALL write the failed events to the Dead_Letter_Queue table in PostgreSQL with the error reason and a retry_count of 0
8. THE Replication_Pipeline SHALL process events idempotently — re-inserting an event with the same event_id SHALL be deduplicated by the ReplacingMergeTree engine without producing duplicate rows
9. WHEN the Replication_Pipeline starts, THE Replication_Pipeline SHALL check the Dead_Letter_Queue for pending events and attempt to replay them before processing new events
10. THE Replication_Pipeline SHALL run as a background process within the Express API server, started during application initialization and gracefully shut down on SIGTERM

### Requirement 3: Analytics Query API — Enrichment Analytics

**User Story:** As a workspace admin, I want to query enrichment analytics, so that I can understand enrichment success rates, provider performance, and credit consumption patterns.

#### Acceptance Criteria

1. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/enrichment/summary with a Time_Range_Filter, THE Analytics_Service SHALL return total enrichment attempts, success count, failure count, success rate percentage, total credits consumed, and average duration in milliseconds for the workspace within the specified time range
2. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/enrichment/by-provider with a Time_Range_Filter, THE Analytics_Service SHALL return per-provider breakdown of enrichment attempts, success count, failure count, success rate, average duration, and total credits consumed
3. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/enrichment/by-field with a Time_Range_Filter, THE Analytics_Service SHALL return per-enrichment-field breakdown of attempts, success count, failure count, and success rate
4. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/enrichment/over-time with a Time_Range_Filter and granularity parameter (hour, day, week), THE Analytics_Service SHALL return time-series data of enrichment attempts, successes, and failures grouped by the specified granularity
5. THE Analytics_Service SHALL validate the Time_Range_Filter using a Zod schema accepting "start" and "end" ISO 8601 date strings, or a preset value from the set (24h, 7d, 30d, 90d)
6. IF the Time_Range_Filter is missing or invalid, THEN THE Analytics_Service SHALL default to the last 30 days
7. THE Analytics_Service SHALL scope all analytics queries to the authenticated user's workspace_id to prevent cross-workspace data access

### Requirement 4: Analytics Query API — Scraping Analytics

**User Story:** As a workspace admin, I want to query scraping analytics, so that I can monitor scraping throughput, domain performance, and failure patterns.

#### Acceptance Criteria

1. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/scraping/summary with a Time_Range_Filter, THE Analytics_Service SHALL return total scrape tasks, completed count, failed count, success rate percentage, and average duration in milliseconds for the workspace within the specified time range
2. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/scraping/by-domain with a Time_Range_Filter, THE Analytics_Service SHALL return per-domain breakdown of scrape tasks, success count, failure count, success rate, and average duration, sorted by total tasks descending
3. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/scraping/by-type with a Time_Range_Filter, THE Analytics_Service SHALL return per-target-type breakdown (linkedin_profile, company_website, job_posting) of scrape tasks, success count, failure count, and success rate
4. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/scraping/over-time with a Time_Range_Filter and granularity parameter, THE Analytics_Service SHALL return time-series data of scrape tasks, completions, and failures grouped by the specified granularity
5. THE Analytics_Service SHALL scope all scraping analytics queries to the authenticated user's workspace_id

### Requirement 5: Analytics Query API — Credit Analytics

**User Story:** As a workspace owner, I want to query credit consumption analytics, so that I can track spending patterns and forecast credit needs.

#### Acceptance Criteria

1. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/credits/summary with a Time_Range_Filter, THE Analytics_Service SHALL return total credits debited, total credits refunded, total credits topped up, and net credit consumption for the workspace within the specified time range
2. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/credits/by-provider with a Time_Range_Filter, THE Analytics_Service SHALL return per-provider breakdown of credits consumed, sorted by consumption descending
3. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/credits/over-time with a Time_Range_Filter and granularity parameter, THE Analytics_Service SHALL return time-series data of credits debited, refunded, and topped up grouped by the specified granularity
4. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/credits/by-source with a Time_Range_Filter, THE Analytics_Service SHALL return credit consumption grouped by source (enrichment, scraping, manual)
5. THE Analytics_Service SHALL scope all credit analytics queries to the authenticated user's workspace_id

### Requirement 6: CSV Export of Analytics Data

**User Story:** As a workspace admin, I want to export analytics data as CSV files, so that I can share reports with stakeholders or import data into external tools.

#### Acceptance Criteria

1. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/enrichment/export?format=csv with a Time_Range_Filter, THE CSV_Exporter SHALL stream the enrichment event data for the workspace and time range as a CSV file download with Content-Type "text/csv" and a Content-Disposition header specifying the filename
2. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/scraping/export?format=csv with a Time_Range_Filter, THE CSV_Exporter SHALL stream the scrape event data as a CSV file download
3. WHEN a member or higher role sends GET /api/v1/workspaces/:id/analytics/credits/export?format=csv with a Time_Range_Filter, THE CSV_Exporter SHALL stream the credit event data as a CSV file download
4. THE CSV_Exporter SHALL stream results using chunked transfer encoding to avoid buffering the entire result set in memory, supporting exports of up to 1 million rows
5. THE CSV_Exporter SHALL include a header row with human-readable column names as the first line of the CSV output
6. THE CSV_Exporter SHALL properly escape CSV field values containing commas, double quotes, or newline characters according to RFC 4180
7. FOR ALL exported CSV data, parsing the CSV output and re-serializing it SHALL produce byte-identical output (round-trip property)

### Requirement 7: Frontend Analytics Dashboard — Layout and Navigation

**User Story:** As a workspace member, I want an analytics dashboard accessible from the main navigation, so that I can view workspace performance metrics at a glance.

#### Acceptance Criteria

1. THE App_Shell SHALL add an "Analytics" link to the sidebar navigation between "Jobs" and "Settings", routing to `/workspaces/:workspaceId/analytics`
2. THE Analytics_Dashboard SHALL render a tab bar with tabs for "Enrichment", "Scraping", and "Credits" analytics sections
3. THE Analytics_Dashboard SHALL render a Time_Range_Filter control (dropdown with presets: Last 24h, Last 7d, Last 30d, Last 90d, and a Custom date range picker) that applies to all charts and tables on the active tab
4. WHEN the user changes the Time_Range_Filter, THE Analytics_Store SHALL fetch updated analytics data from the backend and re-render all charts and tables on the active tab
5. WHEN analytics data is loading, THE Analytics_Dashboard SHALL display skeleton placeholders for charts and tables without blocking user interaction with the Time_Range_Filter or tab navigation
6. THE Analytics_Dashboard SHALL be accessible to users with member role or higher in the active workspace

### Requirement 8: Frontend Analytics Dashboard — Enrichment Tab

**User Story:** As a workspace member, I want to visualize enrichment performance, so that I can identify which providers and fields perform well and where failures occur.

#### Acceptance Criteria

1. THE Analytics_Dashboard enrichment tab SHALL display a summary card row showing total enrichments, success rate, total credits consumed, and average duration for the selected time range
2. THE Analytics_Dashboard enrichment tab SHALL render a line chart (Recharts LineChart) showing enrichment attempts, successes, and failures over time with the granularity auto-selected based on the time range (hourly for 24h, daily for 7d/30d, weekly for 90d)
3. THE Analytics_Dashboard enrichment tab SHALL render a bar chart (Recharts BarChart) showing per-provider success and failure counts
4. THE Analytics_Dashboard enrichment tab SHALL render a table showing per-enrichment-field breakdown with columns: field name, attempts, successes, failures, and success rate, sortable by each column
5. WHEN the user clicks a provider bar in the bar chart, THE Analytics_Dashboard SHALL filter the over-time chart and field table to show data for the selected provider only
6. THE Analytics_Dashboard enrichment tab SHALL include an "Export CSV" button that triggers a download of the enrichment event data for the selected time range via the CSV export endpoint

### Requirement 9: Frontend Analytics Dashboard — Scraping Tab

**User Story:** As a workspace member, I want to visualize scraping performance, so that I can monitor throughput and identify problematic domains.

#### Acceptance Criteria

1. THE Analytics_Dashboard scraping tab SHALL display a summary card row showing total scrape tasks, success rate, and average duration for the selected time range
2. THE Analytics_Dashboard scraping tab SHALL render a line chart showing scrape tasks, completions, and failures over time with auto-selected granularity
3. THE Analytics_Dashboard scraping tab SHALL render a horizontal bar chart showing the top 10 domains by scrape task count with success/failure breakdown
4. THE Analytics_Dashboard scraping tab SHALL render a table showing per-target-type breakdown with columns: target type, tasks, successes, failures, success rate, and average duration, sortable by each column
5. THE Analytics_Dashboard scraping tab SHALL include an "Export CSV" button that triggers a download of the scrape event data for the selected time range

### Requirement 10: Frontend Analytics Dashboard — Credits Tab

**User Story:** As a workspace member, I want to visualize credit consumption, so that I can track spending and plan credit purchases.

#### Acceptance Criteria

1. THE Analytics_Dashboard credits tab SHALL display a summary card row showing total debited, total refunded, total topped up, and net consumption for the selected time range
2. THE Analytics_Dashboard credits tab SHALL render an area chart (Recharts AreaChart) showing credit debits, refunds, and top-ups over time with auto-selected granularity
3. THE Analytics_Dashboard credits tab SHALL render a pie chart (Recharts PieChart) showing credit consumption by source (enrichment, scraping, manual)
4. THE Analytics_Dashboard credits tab SHALL render a table showing per-provider credit consumption with columns: provider, credits consumed, percentage of total, sorted by consumption descending
5. THE Analytics_Dashboard credits tab SHALL include an "Export CSV" button that triggers a download of the credit event data for the selected time range

### Requirement 11: Analytics Query Performance and Caching

**User Story:** As a developer, I want analytics queries to execute within acceptable latency bounds, so that the dashboard remains responsive even with large event volumes.

#### Acceptance Criteria

1. THE Analytics_Service SHALL execute summary and breakdown queries against ClickHouse within 500 milliseconds for workspaces with up to 10 million events
2. THE Analytics_Service SHALL execute time-series queries against ClickHouse within 1 second for workspaces with up to 10 million events
3. WHEN the same analytics query is requested within a configurable TTL (default 60 seconds), THE Analytics_Service SHALL return the cached result from an in-memory LRU cache without querying ClickHouse
4. THE Analytics_Service SHALL key the cache on workspace_id, query type, time range, and granularity to prevent serving stale or cross-workspace data
5. WHEN the Replication_Pipeline flushes a batch of events for a workspace, THE Analytics_Service SHALL invalidate cached results for that workspace to ensure freshness
6. THE Analytics_Service SHALL limit the maximum time range for a single query to 365 days to prevent unbounded full-table scans

### Requirement 12: Dead Letter Queue Management

**User Story:** As a developer, I want failed replication events tracked and replayable, so that no analytics data is permanently lost due to transient ClickHouse failures.

#### Acceptance Criteria

1. THE Dead_Letter_Queue SHALL be a PostgreSQL table with columns: id (UUID), channel (varchar: enrichment_events, scrape_events, credit_events), event_payload (JSONB), error_reason (text), retry_count (integer default 0), max_retries (integer default 5), created_at (DateTime), next_retry_at (DateTime), and status (varchar: pending, replayed, exhausted)
2. WHEN the Replication_Pipeline replays a Dead_Letter_Queue event successfully, THE Replication_Pipeline SHALL update the event status to "replayed"
3. WHEN a Dead_Letter_Queue event has been retried max_retries times and still fails, THE Replication_Pipeline SHALL update the event status to "exhausted" and log an error with the event details
4. WHEN an admin sends GET /api/v1/admin/analytics/dead-letter-queue, THE Analytics_Service SHALL return a paginated list of Dead_Letter_Queue events with their status and error reasons
5. WHEN an admin sends POST /api/v1/admin/analytics/dead-letter-queue/replay, THE Analytics_Service SHALL reset all "exhausted" events to "pending" status with retry_count reset to 0 for manual replay

### Requirement 13: PostgreSQL Trigger and Notification Setup

**User Story:** As a developer, I want PostgreSQL triggers that emit NOTIFY events on data changes, so that the replication pipeline receives change events without polling.

#### Acceptance Criteria

1. THE Database_Schema SHALL define a PostgreSQL trigger on the enrichment_records table that fires AFTER INSERT OR UPDATE and sends a PG NOTIFY on the "enrichment_events" channel with a JSON payload containing the record_id and operation type (INSERT or UPDATE)
2. THE Database_Schema SHALL define a PostgreSQL trigger on the credit_transactions table (or equivalent credit ledger table) that fires AFTER INSERT and sends a PG NOTIFY on the "credit_events" channel with a JSON payload containing the transaction_id
3. THE Database_Schema SHALL define a PostgreSQL function that the scraper webhook handler calls after persisting scrape results, sending a PG NOTIFY on the "scrape_events" channel with a JSON payload containing the task_id and job_id
4. THE Database_Schema SHALL store these triggers and functions as sequential numbered migration files under `packages/backend/migrations/`
5. THE PG NOTIFY payload SHALL be limited to identifiers only (UUIDs and operation type) — the Replication_Pipeline SHALL fetch full event data from PostgreSQL using the identifiers to avoid exceeding the 8000-byte NOTIFY payload limit

### Requirement 14: Analytics API Input Validation and Error Handling

**User Story:** As a developer, I want all analytics API inputs validated and errors handled consistently, so that the analytics endpoints are robust and return predictable responses.

#### Acceptance Criteria

1. THE Analytics_Service SHALL validate all query parameters (time range, granularity, pagination) using Zod schemas at the middleware level before executing queries
2. IF a query parameter fails Zod validation, THEN THE Analytics_Service SHALL return a 400 status code with field-level validation errors in the JSON envelope
3. IF ClickHouse is unreachable when an analytics query is executed, THEN THE Analytics_Service SHALL return a 503 status code with an error message indicating the analytics service is temporarily unavailable
4. THE Analytics_Service SHALL return all responses in the standard JSON envelope format `{ success, data, error, meta }` consistent with existing backend endpoints
5. THE Analytics_Service SHALL include pagination metadata (total count, page, page size, has_next) in the meta field for paginated endpoints
6. WHEN an analytics query returns zero results, THE Analytics_Service SHALL return a 200 status code with an empty data array and zero-value summary fields rather than a 404

