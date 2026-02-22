# Tasks Document

## Task 1: ClickHouse Client & Migration Infrastructure
- [x] Install `@clickhouse/client` package in `packages/backend`
- [x] Add ClickHouse env vars to `src/config/env.ts` schema: `CLICKHOUSE_URL` (default `http://localhost:8123`), `CLICKHOUSE_DATABASE` (default `morket`), `CLICKHOUSE_USER` (default `default`), `CLICKHOUSE_PASSWORD` (optional in dev/test)
- [x] Add ClickHouse env vars to `packages/backend/.env.example`
- [x] Create `src/clickhouse/client.ts` with singleton pattern: `initClickHouse(config)`, `getClickHouse()`, `closeClickHouse()`, `healthCheck()` — matching `getPool()`/`initPool()` pattern from `src/shared/db.ts`
- [x] Create `packages/backend/migrations/clickhouse/` directory
- [x] Create `packages/backend/migrations/clickhouse/runner.ts` — reads numbered `.sql` files, tracks applied migrations in a `_ch_migrations` ClickHouse table, executes in order
- [x] Create `packages/backend/migrations/clickhouse/001_enrichment_events.sql` — ReplacingMergeTree table with columns per design (event_id, workspace_id, job_id, record_id, provider_slug, enrichment_field, status, credits_consumed, duration_ms, error_category, created_at, job_created_at), partitioned by `toYYYYMM(created_at)`, ordered by `(workspace_id, created_at, event_id)`
- [x] Create `packages/backend/migrations/clickhouse/002_scrape_events.sql` — ReplacingMergeTree table with columns per design
- [x] Create `packages/backend/migrations/clickhouse/003_credit_events.sql` — ReplacingMergeTree table with columns per design
- [x] Add ClickHouse health check to existing `/api/v1/health` endpoint (non-blocking — report status but don't fail if CH is down)
- [x] Write unit tests for `client.ts` (initialization, getClickHouse throws when not initialized, healthCheck)
- [x] Write unit tests for migration runner logic (ordering, idempotency, tracking table)
- [ ] Requirement: 1

## Task 2: PostgreSQL Triggers & Dead Letter Queue Migration
- [x] Create `packages/backend/migrations/012_create_dead_letter_queue.ts` with up/down functions — creates `dead_letter_queue` table (id UUID PK, channel VARCHAR, event_payload JSONB, error_reason TEXT, retry_count INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 5, status VARCHAR DEFAULT 'pending', created_at TIMESTAMPTZ, next_retry_at TIMESTAMPTZ) with partial index on `(status, next_retry_at) WHERE status = 'pending'`
- [x] Create `packages/backend/migrations/013_create_replication_triggers.ts` with up/down functions — creates `notify_enrichment_event()` trigger function on `enrichment_records` (AFTER INSERT OR UPDATE), `notify_credit_event()` trigger function on `credit_transactions` (AFTER INSERT), and `notify_scrape_event(p_task_id, p_job_id)` callable function for scrape webhook handler
- [x] NOTIFY payloads contain only identifiers (record_id/transaction_id/task_id + operation type) to stay under 8KB limit
- [x] Write unit tests for migration up/down idempotency
- [ ] Requirement: 13, 12

## Task 3: Replication Pipeline — PG LISTEN, Buffer & Flush
- [x] Create `src/modules/replication/replication.service.ts` — opens dedicated PG connection (not from pool) for `LISTEN enrichment_events`, `LISTEN scrape_events`, `LISTEN credit_events`
- [x] Implement in-memory event buffer with dual-trigger flush: configurable batch size (default 100 events) OR configurable flush interval (default 5 seconds), whichever comes first
- [x] Create `src/modules/replication/replication.queries.ts` — denormalized SELECT queries that fetch full event data from PostgreSQL using identifiers received via NOTIFY (enrichment: JOIN enrichment_records + enrichment_jobs; credit: from credit_transactions; scrape: from scrape task data)
- [x] Implement batch INSERT into ClickHouse using `client.insert({ format: 'JSONEachRow' })` per channel table
- [x] Add retry logic for failed ClickHouse inserts: 3 attempts with exponential backoff (1s, 2s, 4s)
- [x] On retries exhausted: write failed events to dead letter queue via `dlq.repository.ts`
- [x] After successful flush: invalidate analytics cache for affected workspace IDs
- [x] Implement graceful shutdown: flush remaining buffer on SIGTERM, close dedicated PG connection
- [x] Wire replication service startup into `src/index.ts` application initialization (start after pool init, stop on shutdown)
- [x] Write unit tests for buffer flush logic (size trigger, interval trigger, mixed)
- [x] Write unit tests for retry behavior and DLQ fallback
- [x] Requirement: 2

## Task 4: Dead Letter Queue Repository & Replay
- [x] Create `src/modules/replication/dlq.repository.ts` with functions: `insertDLQEvent`, `getPendingEvents(limit)`, `markReplayed(id)`, `markExhausted(id)`, `incrementRetry(id, nextRetryAt)`, `resetExhausted()`, `listEvents(options)` — all using parameterized queries, snake_case → camelCase mapping
- [x] Add DLQ replay logic to replication service: on startup and every 60s, fetch pending DLQ events where `next_retry_at <= NOW()`, attempt re-insert into ClickHouse, update status accordingly
- [x] Status transitions: `pending → replayed` (success), `pending → pending` with incremented retry_count (transient failure), `pending → exhausted` (retry_count >= max_retries)
- [x] Create `src/modules/replication/dlq.routes.ts` — admin-only routes: `GET /api/v1/admin/analytics/dead-letter-queue` (paginated list), `POST /api/v1/admin/analytics/dead-letter-queue/replay` (reset exhausted events)
- [x] Wire DLQ admin routes into `src/app.ts` with authenticate + admin role check
- [x] Write unit tests for DLQ repository CRUD and status transitions
- [x] Write property-based tests for DLQ lifecycle (Property 6 from design: status transitions follow valid paths only)
- [ ] Requirement: 12

## Task 5: Analytics Schemas & Cache
- [x] Create `src/modules/analytics/analytics.schemas.ts` with Zod schemas: `timeRangeQuerySchema` (preset enum OR custom start/end with max 365-day validation), `granularitySchema` (hour/day/week), `paginationQuerySchema`, `workspaceParamsSchema`, `exportQuerySchema` (format=csv + time range)
- [x] Create `src/modules/analytics/analytics.cache.ts` — in-memory LRU cache with configurable TTL (default 60s) and max entries (1000). Methods: `get<T>(key)`, `set<T>(key, data, ttlMs?)`, `invalidateWorkspace(workspaceId)`, `clear()`, `size()`. Cache key format: `analytics:${workspaceId}:${queryType}:${stableHash(params)}`
- [x] Write unit tests for cache: TTL expiry, LRU eviction at max entries, workspace invalidation removes all matching keys, get returns null for expired entries
- [x] Write property-based tests for cache key uniqueness (Property 3: different params → different keys, same params → same key)
- [x] Write property-based tests for time range validation (Property 1: start < end, max 365 days, end <= now)
- [ ] Requirement: 11, 14

## Task 6: Analytics Service — Enrichment Queries
- [x] Create `src/modules/analytics/analytics.service.ts` with factory function `createAnalyticsService()`
- [x] Implement `getEnrichmentSummary(workspaceId, timeRange)` — parameterized ClickHouse query against `enrichment_events`: COUNT, countIf(status='success'), countIf(status='failed'), success rate, SUM(credits_consumed), AVG(duration_ms). Cache-wrapped.
- [x] Implement `getEnrichmentByProvider(workspaceId, timeRange)` — GROUP BY provider_slug with same aggregations. Cache-wrapped.
- [x] Implement `getEnrichmentByField(workspaceId, timeRange)` — GROUP BY enrichment_field with count/success/failure/rate. Cache-wrapped.
- [x] Implement `getEnrichmentOverTime(workspaceId, timeRange, granularity)` — time-bucketed using ClickHouse `toStartOfHour`/`toStartOfDay`/`toStartOfWeek` functions. Cache-wrapped.
- [x] All queries use parameterized `{workspaceId:UUID}` binding to prevent injection and enforce workspace isolation
- [x] All queries scoped with `WHERE workspace_id = {workspaceId:UUID} AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}`
- [x] Write unit tests for each query method (mock ClickHouse client, verify parameterized queries contain workspace_id filter)
- [x] Requirement: 3

## Task 7: Analytics Service — Scraping & Credit Queries
- [x] Implement `getScrapingSummary(workspaceId, timeRange)` — aggregation against `scrape_events`. Cache-wrapped.
- [x] Implement `getScrapingByDomain(workspaceId, timeRange)` — GROUP BY target_domain, ORDER BY tasks DESC. Cache-wrapped.
- [x] Implement `getScrapingByType(workspaceId, timeRange)` — GROUP BY target_type. Cache-wrapped.
- [x] Implement `getScrapingOverTime(workspaceId, timeRange, granularity)` — time-bucketed. Cache-wrapped.
- [x] Implement `getCreditSummary(workspaceId, timeRange)` — sumIf by transaction_type against `credit_events`. Cache-wrapped.
- [x] Implement `getCreditByProvider(workspaceId, timeRange)` — GROUP BY provider_slug WHERE transaction_type='debit'. Cache-wrapped.
- [x] Implement `getCreditBySource(workspaceId, timeRange)` — GROUP BY source. Cache-wrapped.
- [x] Implement `getCreditOverTime(workspaceId, timeRange, granularity)` — time-bucketed by transaction_type. Cache-wrapped.
- [x] All queries parameterized with workspace_id scoping
- [x] Write unit tests for each query method (mock ClickHouse client)
- [x] Requirement: 4, 5

## Task 8: Analytics Controller, Routes & CSV Export
- [x] Create `src/modules/analytics/analytics.controller.ts` with factory function `createAnalyticsController()` — 15 handlers (5 enrichment + 5 scraping + 5 credits) that parse validated query params, call service, return `{ success, data, error, meta: { cached, queryTimeMs } }` envelope
- [x] Create `src/modules/analytics/analytics.routes.ts` with `createAnalyticsRoutes()` returning a single Router (`mergeParams: true`) — mounts all 15 endpoints under `/enrichment/*`, `/scraping/*`, `/credits/*` sub-paths, applies `validate()` + `requireRole('member')` middleware
- [x] Create `src/modules/analytics/csv-exporter.ts` — `streamCSVExport(res, options)` function that streams ClickHouse query results as CSV with `Content-Type: text/csv`, `Content-Disposition: attachment`, chunked transfer encoding, RFC 4180 escaping, header row
- [x] Wire analytics routes into `src/app.ts`: `app.use('/api/v1/workspaces/:id/analytics', authenticate, createAnalyticsRoutes())`
- [x] Wire DLQ admin routes into `src/app.ts`: `app.use('/api/v1/admin/analytics', authenticate, createDLQRoutes())`
- [x] Handle ClickHouse unreachable: return 503 with `ANALYTICS_UNAVAILABLE` error code
- [x] Handle zero results: return 200 with empty data array and zero-value summary fields
- [x] Write unit tests for controller handlers (mock service, verify envelope format and meta fields)
- [x] Write unit tests for CSV exporter (RFC 4180 escaping, header row, streaming)
- [x] Write property-based tests for CSV round-trip fidelity (Property 4: serialize → parse → re-serialize produces identical output)
- [x] Write property-based tests for JSON envelope consistency (Property 7)
- [ ] Requirement: 3, 4, 5, 6, 14

## Task 9: Frontend Analytics Types, API Client & Store
- [x] Install `recharts` package in `packages/frontend`
- [x] Create `src/types/analytics.types.ts` — TypeScript interfaces for all analytics response shapes (EnrichmentSummary, ProviderBreakdown, FieldBreakdown, TimeSeriesPoint, ScrapingSummary, DomainBreakdown, TargetTypeBreakdown, CreditSummary, CreditProviderBreakdown, CreditSourceBreakdown, CreditTimeSeriesPoint)
- [x] Create `src/api/analytics.api.ts` — typed API client functions for all 15 analytics endpoints + 3 CSV export endpoints, using existing Axios `apiClient` instance
- [x] Create `src/stores/analytics.store.ts` — Zustand store with: activeTab, timeRangePreset/customTimeRange, selectedProvider (drill-down), data slices per tab (summary + breakdowns + time-series), per-section isLoading flags, error state, actions (setActiveTab, setTimeRange, setCustomTimeRange, setSelectedProvider, fetchEnrichmentData, fetchScrapingData, fetchCreditData, reset)
- [x] Create `src/hooks/useAnalytics.ts` — hook that fetches data for active tab on mount and time range change, manages 60s auto-refresh via `setInterval` (pauses when tab not visible via `document.visibilityState`), cleans up on unmount
- [x] Write unit tests for analytics store state transitions (tab switching, time range changes, loading states)
- [x] Write unit tests for useAnalytics hook (auto-refresh, visibility pause, cleanup)
- [x] Requirement: 7

## Task 10: Frontend Analytics Dashboard — Layout & Shared Components
- [x] Create `src/components/analytics/TimeRangeFilter.tsx` — preset buttons (24h, 7d, 30d, 90d) with active state, "Custom" button opening date range picker (two date inputs), validates end > start and max 365 days
- [x] Create `src/components/analytics/SummaryCards.tsx` — reusable component accepting `{ label, value, format }[]`, renders horizontal card row with Tailwind grid, skeleton placeholders when loading, format types: number, percentage, duration, credits
- [x] Create `src/components/analytics/AnalyticsDashboard.tsx` — main page with tab bar (Enrichment, Scraping, Credits), TimeRangeFilter at top, renders active tab component, accessible to member+ role
- [x] Add route to React Router: `/workspaces/:workspaceId/analytics` → AnalyticsDashboard
- [x] Add "Analytics" link to sidebar navigation (chart icon) between "Jobs" and "Settings"
- [x] Write component render tests (loading skeleton, empty state, tab switching)
- [x] Requirement: 7

## Task 11: Frontend Analytics Dashboard — Tab Components
- [x] Create `src/components/analytics/EnrichmentTab.tsx` — SummaryCards (total, success rate, credits, avg duration), Recharts LineChart (attempts/successes/failures over time, auto-granularity: 24h→hour, 7d/30d→day, 90d→week), Recharts BarChart (per-provider, clickable for drill-down filtering), sortable field breakdown table, "Export CSV" button
- [x] Create `src/components/analytics/ScrapingTab.tsx` — SummaryCards (total tasks, success rate, avg duration), Recharts LineChart (over time), horizontal Recharts BarChart (top 10 domains), sortable target type table, "Export CSV" button
- [x] Create `src/components/analytics/CreditsTab.tsx` — SummaryCards (debited, refunded, topped up, net), Recharts AreaChart (stacked over time), Recharts PieChart (by source), sortable provider consumption table, "Export CSV" button
- [x] CSV export buttons trigger `window.location.href` to backend export endpoint with current time range params
- [x] All charts use Recharts `ResponsiveContainer` for adaptive sizing
- [x] Write component render tests for each tab (loading, empty, populated states)
- [x] Requirement: 8, 9, 10
