# Implementation Plan: Enrichment Orchestration (Module 2)

## Overview

Build the enrichment orchestration layer on top of Module 1's foundation. Implementation proceeds bottom-up: database schema → shared utilities (circuit breaker, provider registry, adapters) → repositories → services → Temporal integration → HTTP layer → route registration → tests. Each task builds incrementally so there is no orphaned code.

## Tasks

- [x] 1. Database migrations for enrichment tables
  - [x] 1.1 Create migration `009_create_enrichment_jobs.ts`
    - Define `enrichment_job_status` enum type (pending, running, completed, failed, partially_completed, cancelled)
    - Create `enrichment_jobs` table with all columns: id (UUID PK), workspace_id (FK), status, requested_fields (JSONB), waterfall_config (JSONB nullable), total_records, completed_records, failed_records, estimated_credits, created_by (FK), created_at, updated_at, completed_at (nullable)
    - Add index on `(workspace_id, created_at DESC)`
    - Write `down` function to drop table and enum
    - _Requirements: 10.1, 10.4, 10.5, 10.6_

  - [x] 1.2 Create migration `010_create_enrichment_records.ts`
    - Define `enrichment_record_status` enum type (success, failed, skipped)
    - Create `enrichment_records` table with all columns: id (UUID PK), job_id (FK to enrichment_jobs), workspace_id (FK), input_data (JSONB), output_data (JSONB nullable), provider_slug, credits_consumed, status, error_reason (nullable), idempotency_key (UNIQUE), credit_transaction_id (nullable), created_at, updated_at
    - Add index on `(job_id, created_at)` and unique index on `idempotency_key`
    - Foreign keys cascade on delete
    - Write `down` function to drop table and enum
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 1.3 Create migration `011_create_webhook_subscriptions.ts`
    - Create `webhook_subscriptions` table: id (UUID PK), workspace_id (FK), callback_url, event_types (JSONB), secret_key, is_active (default true), created_by (FK), created_at, updated_at
    - Add index on `(workspace_id)`
    - Write `down` function to drop table
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

- [x] 2. Provider adapter types and implementations
  - [x] 2.1 Create `adapters/types.ts` with `ProviderAdapter` interface and `ProviderResult` type
    - Define `ProviderAdapter.enrich(credentials, input)` returning `Promise<ProviderResult>`
    - Define `ProviderResult` with `success`, `data`, `isComplete`, and optional `error` fields
    - Define `EnrichmentFieldType` union type
    - _Requirements: 1.1, 1.6_

  - [x] 2.2 Implement `adapters/apollo.adapter.ts`
    - Implement `ProviderAdapter` interface for Apollo API
    - HTTP call with 30s timeout, parse response into `ProviderResult`
    - Handle API errors and map to `{ success: false }` results
    - _Requirements: 1.6, 4.8_

  - [x] 2.3 Implement `adapters/clearbit.adapter.ts`
    - Implement `ProviderAdapter` interface for Clearbit API
    - HTTP call with 30s timeout, parse response into `ProviderResult`
    - _Requirements: 1.6, 4.8_

  - [x] 2.4 Implement `adapters/hunter.adapter.ts`
    - Implement `ProviderAdapter` interface for Hunter API
    - HTTP call with 30s timeout, parse response into `ProviderResult`
    - _Requirements: 1.6, 4.8_

- [x] 3. Circuit breaker and provider registry
  - [x] 3.1 Implement `circuit-breaker.ts`
    - Implement `ICircuitBreaker` with `canCall`, `recordSuccess`, `recordFailure`, `getState`, `reset` methods
    - Sliding window of 10 most recent calls per provider
    - Threshold: 5 failures → open state; 60s cooldown → half-open; probe success → closed, probe fail → open
    - Accept injectable `CircuitBreakerConfig` for testability
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 3.2 Write property tests for circuit breaker (`tests/property/circuit-breaker.property.test.ts`)
    - **Property 1: State transitions are deterministic** — Given the same sequence of success/failure calls, the circuit breaker always reaches the same state
    - **Validates: Requirements 7.1, 7.2, 7.6, 7.7**
    - **Property 2: Open state blocks all calls** — After exceeding the failure threshold, `canCall` always returns false until cooldown expires
    - **Validates: Requirements 7.2, 7.3**
    - **Property 3: Sliding window bounds** — The recentCalls array never exceeds windowSize entries
    - **Validates: Requirement 7.1**

  - [x] 3.3 Implement `provider-registry.ts`
    - In-memory `Map<string, ProviderDefinition>` keyed by slug
    - Implement `IProviderRegistry`: `getProvider`, `getAllProviders`, `getProvidersForField`, `validateProviders`, `estimateCredits`
    - Register Apollo, Clearbit, Hunter providers with Zod input/output schemas, credit costs, supported fields, and adapter references
    - Validate uniqueness of slugs and positive credit costs on registration
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 3.4 Write unit tests for provider registry (`provider-registry.test.ts`)
    - Test provider lookup by slug, listing all providers, filtering by field
    - Test `estimateCredits` calculation with and without waterfall config
    - Test validation rejects duplicate slugs and non-positive credit costs
    - _Requirements: 1.1, 1.4, 1.5_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Repositories for enrichment data
  - [x] 5.1 Implement `job.repository.ts`
    - `createJob(params)` — INSERT returning camelCase `EnrichmentJob`
    - `getJobById(jobId, workspaceId)` — SELECT by id scoped to workspace
    - `listJobs(workspaceId, pagination)` — paginated SELECT ordered by created_at DESC
    - `updateJobStatus(jobId, status, counters?)` — UPDATE status, completed_records, failed_records, completed_at
    - Map snake_case rows to camelCase domain interfaces
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 10.1_

  - [x] 5.2 Implement `record.repository.ts`
    - `createRecord(params)` — INSERT with ON CONFLICT (idempotency_key) DO NOTHING RETURNING, return existing if conflict
    - `getRecordById(recordId, workspaceId)` — SELECT by id scoped to workspace
    - `listRecordsByJob(jobId, workspaceId, pagination)` — paginated SELECT ordered by created_at
    - `getRecordByIdempotencyKey(key)` — SELECT by idempotency_key for replay detection
    - Map snake_case rows to camelCase domain interfaces
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.3 Implement `webhook.repository.ts`
    - `createSubscription(params)` — INSERT returning camelCase `WebhookSubscription`
    - `listSubscriptions(workspaceId)` — SELECT all active subscriptions for workspace
    - `getSubscriptionById(webhookId, workspaceId)` — SELECT by id scoped to workspace
    - `deleteSubscription(webhookId, workspaceId)` — DELETE by id scoped to workspace
    - `getSubscriptionsByEventType(workspaceId, eventType)` — SELECT active subscriptions matching event type
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 6. Zod schemas for all endpoints (`enrichment.schemas.ts`)
  - [x] 6.1 Define request/response Zod schemas
    - `createJobBodySchema` — records array, fields array, optional waterfallConfig
    - `jobParamsSchema` — workspaceId + jobId UUIDs
    - `recordParamsSchema` — workspaceId + recordId UUIDs
    - `paginationQuerySchema` — page (default 1), limit (default 50, max 100)
    - `createWebhookBodySchema` — callbackUrl (URL), eventTypes (non-empty string array)
    - `webhookParamsSchema` — workspaceId + webhookId UUIDs
    - `workspaceParamsSchema` — workspaceId UUID
    - `providerParamsSchema` — providerSlug string
    - Export inferred TypeScript types for all schemas
    - _Requirements: 2.1, 2.7, 2.8, 9.1_

- [x] 7. Enrichment service and webhook service
  - [x] 7.1 Implement `enrichment.service.ts`
    - `createJob` — validate input records against provider input schemas, validate waterfall providers exist and have credentials, estimate credits, check balance via Credit Service, insert job, start Temporal workflow, return job with estimate
    - `getJob` — fetch job by id scoped to workspace, throw NotFoundError if missing
    - `listJobs` — paginated list by workspace
    - `cancelJob` — send cancel signal to Temporal workflow, update job status to cancelled
    - `getRecord` — fetch record by id scoped to workspace
    - `listRecords` — paginated list by job
    - Batch splitting: split input records into batches of 1000 max
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.6, 6.5, 6.6_

  - [x] 7.2 Implement `webhook.service.ts`
    - `createSubscription` — generate secret key (crypto.randomBytes), insert subscription
    - `listSubscriptions` — list all for workspace
    - `deleteSubscription` — delete by id, throw NotFoundError if missing
    - `deliverEvent` — query matching subscriptions, for each: serialize payload, compute HMAC-SHA256 with secret key, POST with `X-Webhook-Signature` header, 10s timeout, retry up to 3 times with exponential backoff (5s, 10s, 20s)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 7.3 Write unit tests for enrichment service (`enrichment.service.test.ts`)
    - Test job creation validates input, estimates credits, rejects insufficient balance
    - Test batch splitting for >1000 records
    - Test cancelJob sends Temporal cancel signal
    - Mock repositories and Credit/Credential services
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 6.5, 6.6_

  - [x] 7.4 Write unit tests for webhook service (`webhook.service.test.ts`)
    - Test HMAC signature generation
    - Test retry logic on delivery failure
    - Test 10s timeout enforcement
    - _Requirements: 9.5, 9.6, 9.7_

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Temporal.io integration
  - [x] 9.1 Implement `temporal/client.ts`
    - Create and export Temporal client connection factory
    - `startEnrichmentWorkflow(jobId, input)` — start workflow with ID `enrichment-job-{jobId}` on task queue `enrichment-tasks`
    - `cancelEnrichmentWorkflow(jobId)` — send cancellation signal to workflow
    - _Requirements: 3.1, 3.9_

  - [x] 9.2 Implement `temporal/activities.ts`
    - `enrichRecord` activity — the core enrichment activity:
      1. Check idempotency: query existing record by idempotency key, return if exists
      2. Check circuit breaker state for provider
      3. Debit credits via Credit Service (SELECT FOR UPDATE transaction)
      4. Decrypt credentials via Credential Service
      5. Call provider adapter with 30s timeout
      6. Validate response against provider output schema
      7. On success: record circuit breaker success, insert enrichment_record (success), return result
      8. On failure: record circuit breaker failure, refund credits, insert enrichment_record (failed)
      9. On missing credentials: fail immediately without retry
    - Record credit_transaction_id in enrichment_record for audit
    - Activity retry policy: max 3 attempts, 1s initial interval, backoff coefficient 2.0
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4_

  - [x] 9.3 Implement `temporal/workflows.ts`
    - `enrichmentWorkflow` — durable workflow definition:
      1. Update job status to "running"
      2. Process batches sequentially, records sequentially within each batch
      3. For each record+field: resolve provider list (waterfall or single), iterate providers
      4. Waterfall logic: try providers in order, stop on complete success, skip incomplete/failed, debit only accepted result
      5. Use idempotency key format `{jobId}:{recordIndex}:{fieldName}:{providerSlug}`
      6. Handle cancellation signal: stop scheduling new activities, let in-progress complete
      7. Compute final status: all success → completed, mixed → partially_completed, all fail → failed
      8. Update job with final status and counters
      9. Trigger webhook delivery for terminal state
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_

  - [x] 9.4 Implement `temporal/worker.ts`
    - Create Temporal worker that registers workflows and activities
    - Connect to Temporal server, poll task queue `enrichment-tasks`
    - Export factory function for starting the worker alongside the Express process
    - _Requirements: 3.2_

  - [x] 9.5 Write property tests for waterfall and idempotency (`tests/property/enrichment.property.test.ts`)
    - **Property 4: Waterfall stops on first complete result** — For any sequence of provider results where at least one is complete, the waterfall returns the first complete result's provider
    - **Validates: Requirements 5.1, 5.4**
    - **Property 5: Idempotency key uniqueness** — For any combination of jobId, recordIndex, fieldName, providerSlug, the generated idempotency key is unique
    - **Validates: Requirements 3.8, 8.3**
    - **Property 6: Credit debit equals refund on failure** — For any enrichment activity that fails after debit, the refunded amount equals the debited amount
    - **Validates: Requirements 6.1, 6.3, 5.7**

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. HTTP layer — controller and routes
  - [x] 11.1 Implement `enrichment.controller.ts`
    - Factory function `createEnrichmentController()` returning handlers:
      - `listProviders` — GET /providers, returns all providers from registry
      - `getProvider` — GET /providers/:providerSlug, returns single provider or 404
      - `createJob` — POST /workspaces/:id/enrichment-jobs, delegates to enrichment service
      - `listJobs` — GET /workspaces/:id/enrichment-jobs, paginated
      - `getJob` — GET /workspaces/:id/enrichment-jobs/:jobId
      - `cancelJob` — POST /workspaces/:id/enrichment-jobs/:jobId/cancel
      - `listRecords` — GET /workspaces/:id/enrichment-jobs/:jobId/records, paginated
      - `getRecord` — GET /workspaces/:id/enrichment-records/:recordId
      - `createWebhook` — POST /workspaces/:id/webhooks
      - `listWebhooks` — GET /workspaces/:id/webhooks
      - `deleteWebhook` — DELETE /workspaces/:id/webhooks/:webhookId
    - All handlers use `successResponse` envelope and `next(err)` pattern
    - _Requirements: 1.2, 1.3, 2.1, 2.3, 2.4, 2.5, 2.6, 8.2, 9.1, 9.2, 9.3_

  - [x] 11.2 Implement `enrichment.routes.ts`
    - Factory function `createEnrichmentRoutes(encryptionMasterKey)` returning Router
    - Provider routes (public within authenticated scope): GET /providers, GET /providers/:providerSlug
    - Job routes (member+): POST, GET list, GET detail, POST cancel, GET records
    - Record routes (member+): GET single record
    - Webhook routes: POST (admin+), GET (member+), DELETE (admin+)
    - Apply `validate()` middleware with appropriate Zod schemas on each route
    - Apply `requireRole()` middleware per endpoint
    - Use `Router({ mergeParams: true })` for workspace-scoped routes
    - _Requirements: 1.2, 1.3, 2.1, 2.3, 2.4, 2.5, 2.6, 8.2, 9.1, 9.2, 9.3_

  - [x] 11.3 Register enrichment routes in `app.ts`
    - Import `createEnrichmentRoutes` in `src/app.ts`
    - Mount provider routes: `app.use('/api/v1/providers', authenticate, createEnrichmentRoutes(...))`
    - Mount workspace-scoped enrichment routes: `app.use('/api/v1/workspaces/:id/enrichment-jobs', authenticate, ...)`
    - Mount workspace-scoped webhook routes: `app.use('/api/v1/workspaces/:id/webhooks', authenticate, ...)`
    - Mount workspace-scoped record routes: `app.use('/api/v1/workspaces/:id/enrichment-records', authenticate, ...)`
    - _Requirements: 1.2, 1.3, 2.1, 9.1_

- [x] 12. Install Temporal.io dependencies
  - Add `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` to `packages/backend/package.json`
  - _Requirements: 3.1, 3.2_

- [x] 13. Integration tests and final property tests
  - [x] 13.1 Write integration tests for enrichment API endpoints (`tests/integration/enrichment.integration.test.ts`)
    - Test POST /enrichment-jobs creates job and returns 201 with job ID and estimated credits
    - Test GET /enrichment-jobs returns paginated list
    - Test GET /enrichment-jobs/:jobId returns job details
    - Test POST /enrichment-jobs/:jobId/cancel returns updated job
    - Test GET /enrichment-jobs/:jobId/records returns paginated records
    - Test GET /enrichment-records/:recordId returns single record
    - Test 400 on invalid input records
    - Test 402 on insufficient credits
    - Mock Temporal client and repositories
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.5, 6.6_

  - [x] 13.2 Write integration tests for webhook API endpoints (`tests/integration/webhook.integration.test.ts`)
    - Test POST /webhooks creates subscription (admin+)
    - Test GET /webhooks lists subscriptions
    - Test DELETE /webhooks/:webhookId removes subscription
    - Test RBAC: member cannot create/delete webhooks
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 13.3 Write integration tests for provider API endpoints (`tests/integration/provider.integration.test.ts`)
    - Test GET /providers returns all registered providers
    - Test GET /providers/:providerSlug returns provider details
    - Test GET /providers/:providerSlug returns 404 for unknown slug
    - _Requirements: 1.2, 1.3_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- Temporal.io packages (task 12) can be installed at any point before running Temporal-dependent code
- The circuit breaker and provider registry are pure in-memory components with no database dependencies, making them ideal early implementation targets
