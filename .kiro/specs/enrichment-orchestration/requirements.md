# Requirements Document

## Introduction

This module implements the enrichment orchestration layer for the Morket GTM data engine — the core value proposition of the platform. It enables users to define and execute multi-step data enrichment workflows that call external provider APIs (Apollo, Clearbit, Hunter, LinkedIn, etc.) to enrich contact and company records. The module integrates Temporal.io as the workflow engine, supports waterfall enrichment (automatic provider fallback), manages enrichment jobs with full lifecycle tracking, and ties into the existing credit/billing system from Module 1 for consumption-based pricing. All external API calls use retry logic with exponential backoff and circuit breaker patterns for resilience.

## Glossary

- **Enrichment_Service**: The service responsible for orchestrating enrichment workflows, managing jobs, and coordinating provider calls within the backend.
- **Workflow_Engine**: The Temporal.io-based engine that executes multi-step enrichment workflows as durable, idempotent workflow runs.
- **Workflow_Worker**: A Temporal.io worker process running alongside the Express API that polls for and executes workflow tasks and activity tasks.
- **Enrichment_Workflow**: A Temporal.io workflow definition representing a sequence of enrichment steps to execute against one or more input records.
- **Enrichment_Activity**: A Temporal.io activity that performs a single enrichment step — calling an external provider API, consuming credits, and recording the result.
- **Provider_Registry**: A registry of enrichment providers with their capabilities, credit costs, supported fields, and API schemas. Providers are pluggable and configurable per workspace.
- **Enrichment_Provider**: A third-party data provider (e.g., Apollo, Clearbit, Hunter) registered in the Provider_Registry with a unique identifier, supported enrichment fields, and credit cost per call.
- **Enrichment_Job**: A user-initiated request to enrich one or more records. Tracks status (pending, running, completed, failed, partially_completed), progress, and links to individual Enrichment_Records.
- **Enrichment_Record**: A single enrichment result for one input record within a job, storing input data, output data, provider used, credits consumed, status, and timestamps.
- **Waterfall_Strategy**: A fallback configuration where multiple providers are tried in priority order for a given field. If provider A fails or returns incomplete data, provider B is tried, then provider C.
- **Circuit_Breaker**: A resilience pattern that tracks external provider failures and temporarily disables calls to a provider after a configurable failure threshold, preventing cascading failures.
- **Webhook_Subscription**: A registered callback URL for a workspace that receives HTTP POST notifications when enrichment jobs reach a terminal state (completed, failed, partially_completed).
- **Credit_Service**: The existing Module 1 service responsible for debiting and refunding credits within PostgreSQL transactions using SELECT FOR UPDATE.
- **Credential_Service**: The existing Module 1 service responsible for encrypting, storing, and decrypting third-party API credentials using AES-256-GCM.
- **Idempotency_Key**: A unique identifier for each enrichment action execution that prevents duplicate processing when a workflow is retried or replayed by Temporal.io.

## Requirements

### Requirement 1: Provider Registry Management

**User Story:** As a workspace admin, I want to browse and configure enrichment providers, so that I can choose which data sources to use for enrichment.

#### Acceptance Criteria

1. THE Provider_Registry SHALL maintain a catalog of Enrichment_Providers, each identified by a unique provider slug, display name, list of supported enrichment fields, and credit cost per call
2. WHEN a user sends GET /api/v1/providers, THE Enrichment_Service SHALL return the list of all registered Enrichment_Providers with their capabilities and credit costs
3. WHEN a user sends GET /api/v1/providers/:providerSlug, THE Enrichment_Service SHALL return the full details of the specified Enrichment_Provider including supported fields and required credential type
4. THE Provider_Registry SHALL define each Enrichment_Provider with a Zod schema describing the expected input fields and output fields for validation
5. WHEN a new Enrichment_Provider is registered in the Provider_Registry, THE Provider_Registry SHALL validate that the provider slug is unique, the credit cost is a positive integer, and the input/output schemas are valid Zod definitions
6. THE Provider_Registry SHALL support a pluggable architecture where adding a new Enrichment_Provider requires only registering a provider configuration and an adapter function without modifying existing provider code

### Requirement 2: Enrichment Job Creation and Management

**User Story:** As a workspace member, I want to create and manage enrichment jobs, so that I can enrich my contact and company data in bulk or individually.

#### Acceptance Criteria

1. WHEN a member or higher role sends POST /api/v1/workspaces/:id/enrichment-jobs with input records and a list of enrichment fields, THE Enrichment_Service SHALL create an Enrichment_Job with status "pending" and return the job ID in the JSON_Envelope
2. WHEN an Enrichment_Job is created with more than 1000 input records, THE Enrichment_Service SHALL split the records into batches of at most 1000 records each for processing
3. WHEN a user sends GET /api/v1/workspaces/:id/enrichment-jobs, THE Enrichment_Service SHALL return a paginated list of Enrichment_Jobs for the workspace in reverse chronological order
4. WHEN a user sends GET /api/v1/workspaces/:id/enrichment-jobs/:jobId, THE Enrichment_Service SHALL return the Enrichment_Job details including status, progress (records completed vs total), and timestamps
5. WHEN a member or higher role sends POST /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel, THE Enrichment_Service SHALL request cancellation of the running Enrichment_Workflow via the Workflow_Engine and update the job status to "cancelled"
6. WHEN a user sends GET /api/v1/workspaces/:id/enrichment-jobs/:jobId/records, THE Enrichment_Service SHALL return a paginated list of Enrichment_Records for the specified job
7. THE Enrichment_Service SHALL validate all input records against the required input schema for the requested enrichment fields before creating the Enrichment_Job
8. IF the input records fail schema validation, THEN THE Enrichment_Service SHALL return a 400 status code with field-level validation errors in the JSON_Envelope

### Requirement 3: Temporal.io Workflow Execution

**User Story:** As a developer, I want enrichment jobs to execute as durable Temporal.io workflows, so that long-running enrichment processes survive failures and can be retried automatically.

#### Acceptance Criteria

1. WHEN an Enrichment_Job transitions to status "pending", THE Workflow_Engine SHALL start a new Enrichment_Workflow with the job ID as the workflow ID to ensure uniqueness
2. THE Workflow_Worker SHALL run alongside the Express API process and poll the Temporal.io server for workflow tasks and activity tasks
3. THE Enrichment_Workflow SHALL execute each enrichment step as a separate Enrichment_Activity with independent retry configuration
4. WHEN the Workflow_Engine starts an Enrichment_Workflow, THE Enrichment_Workflow SHALL process input records sequentially within each batch and batches sequentially to maintain predictable credit consumption
5. WHEN all Enrichment_Activities for an Enrichment_Job complete successfully, THE Enrichment_Workflow SHALL update the job status to "completed"
6. WHEN one or more Enrichment_Activities fail after exhausting retries and at least one succeeds, THE Enrichment_Workflow SHALL update the job status to "partially_completed"
7. WHEN all Enrichment_Activities for an Enrichment_Job fail after exhausting retries, THE Enrichment_Workflow SHALL update the job status to "failed"
8. THE Enrichment_Workflow SHALL use the Enrichment_Job ID combined with the record index and field name as the Idempotency_Key for each Enrichment_Activity to prevent duplicate processing on workflow replay
9. WHEN a cancellation signal is received, THE Enrichment_Workflow SHALL stop scheduling new Enrichment_Activities, allow in-progress activities to complete, and update the job status to "cancelled"

### Requirement 4: Enrichment Activity Execution

**User Story:** As a developer, I want each enrichment step to reliably call external provider APIs with proper error handling, so that enrichment results are accurate and failures are handled gracefully.

#### Acceptance Criteria

1. WHEN an Enrichment_Activity executes, THE Enrichment_Activity SHALL retrieve the decrypted API credentials for the target Enrichment_Provider from the Credential_Service
2. WHEN an Enrichment_Activity calls an external provider API, THE Enrichment_Activity SHALL apply retry logic with exponential backoff starting at 1 second, doubling on each retry, up to a maximum of 3 retries
3. WHEN an external provider API returns a response, THE Enrichment_Activity SHALL validate the response against the Enrichment_Provider output schema before processing the result
4. IF an external provider API response fails schema validation, THEN THE Enrichment_Activity SHALL treat the response as a provider error and record the failure in the Enrichment_Record
5. WHEN an Enrichment_Activity completes successfully, THE Enrichment_Activity SHALL create an Enrichment_Record with the input data, output data, provider slug, credits consumed, and a "success" status
6. WHEN an Enrichment_Activity fails after exhausting all retries, THE Enrichment_Activity SHALL create an Enrichment_Record with a "failed" status, the error reason, and zero credits consumed
7. IF the workspace does not have stored credentials for the target Enrichment_Provider, THEN THE Enrichment_Activity SHALL fail immediately with a descriptive error without retrying
8. THE Enrichment_Activity SHALL set a timeout of 30 seconds for each external provider API call to prevent indefinite blocking

### Requirement 5: Waterfall Enrichment Strategy

**User Story:** As a workspace admin, I want to configure fallback providers for each enrichment field, so that if one provider fails or returns incomplete data, the system automatically tries the next provider.

#### Acceptance Criteria

1. WHEN an Enrichment_Job specifies a Waterfall_Strategy for a field, THE Enrichment_Workflow SHALL try providers in the configured priority order until one returns a successful result
2. WHEN the first provider in a Waterfall_Strategy returns an empty or incomplete result for the requested field, THE Enrichment_Workflow SHALL proceed to the next provider in the priority list
3. WHEN the first provider in a Waterfall_Strategy fails with an error, THE Enrichment_Workflow SHALL proceed to the next provider in the priority list after exhausting retries for the current provider
4. WHEN a provider in the Waterfall_Strategy returns a successful and complete result, THE Enrichment_Workflow SHALL stop the waterfall for that field and record the result from the successful provider
5. WHEN all providers in a Waterfall_Strategy fail or return incomplete results, THE Enrichment_Workflow SHALL record the best partial result available (if any) and mark the field enrichment as "exhausted"
6. THE Enrichment_Service SHALL validate that all providers referenced in a Waterfall_Strategy exist in the Provider_Registry and that the workspace has stored credentials for each provider before starting the job
7. THE Enrichment_Workflow SHALL debit credits only for the provider that produces the final accepted result in a waterfall sequence, not for providers that returned incomplete results

### Requirement 6: Credit Integration

**User Story:** As a workspace owner, I want enrichment actions to consume credits from my workspace balance, so that usage is tracked and billed accurately.

#### Acceptance Criteria

1. WHEN an Enrichment_Activity is about to call an external provider API, THE Enrichment_Activity SHALL debit the credit cost defined by the Enrichment_Provider from the workspace balance via the Credit_Service before making the API call
2. IF the workspace credit balance is insufficient to cover the Enrichment_Provider credit cost, THEN THE Enrichment_Activity SHALL fail immediately with an "insufficient credits" error and skip the provider call
3. WHEN an Enrichment_Activity fails after credits have been debited (due to provider error or timeout), THE Enrichment_Activity SHALL refund the debited credits to the workspace balance via the Credit_Service
4. THE Enrichment_Activity SHALL record the credit transaction reference ID in the Enrichment_Record for audit traceability
5. WHEN an Enrichment_Job is created, THE Enrichment_Service SHALL estimate the total credit cost based on the number of records multiplied by the per-call cost of each requested provider and return the estimate in the job creation response
6. IF the estimated total credit cost exceeds the workspace credit balance, THEN THE Enrichment_Service SHALL reject the job creation with an "insufficient credits" error and the estimated cost in the error response

### Requirement 7: Circuit Breaker for External Providers

**User Story:** As a developer, I want the system to detect and isolate failing external providers, so that repeated failures do not waste credits or slow down enrichment jobs.

#### Acceptance Criteria

1. THE Circuit_Breaker SHALL track the failure count for each Enrichment_Provider independently, using a sliding window of the most recent 10 calls
2. WHEN the failure count for an Enrichment_Provider exceeds 5 failures within the sliding window, THE Circuit_Breaker SHALL transition the provider to an "open" state
3. WHILE an Enrichment_Provider is in the "open" state, THE Enrichment_Activity SHALL skip calls to that provider and immediately proceed to the next provider in the Waterfall_Strategy or fail the activity
4. WHEN an Enrichment_Provider has been in the "open" state for 60 seconds, THE Circuit_Breaker SHALL transition the provider to a "half-open" state
5. WHILE an Enrichment_Provider is in the "half-open" state, THE Circuit_Breaker SHALL allow one probe call to the provider
6. WHEN a probe call in the "half-open" state succeeds, THE Circuit_Breaker SHALL transition the provider back to the "closed" state and reset the failure count
7. WHEN a probe call in the "half-open" state fails, THE Circuit_Breaker SHALL transition the provider back to the "open" state for another 60-second cooldown period

### Requirement 8: Enrichment Record Storage

**User Story:** As a workspace member, I want enrichment results stored per record with full provenance, so that I can audit which provider enriched each field and how many credits were consumed.

#### Acceptance Criteria

1. THE Enrichment_Service SHALL store each Enrichment_Record with the following fields: record ID (UUID), job ID, workspace ID, input data (JSON), output data (JSON), provider slug, credits consumed, status (success, failed, skipped), error reason (nullable), idempotency key, created_at, and updated_at
2. WHEN a user sends GET /api/v1/workspaces/:id/enrichment-records/:recordId, THE Enrichment_Service SHALL return the full Enrichment_Record including input data, output data, and provenance metadata
3. THE Enrichment_Service SHALL enforce a unique constraint on the Idempotency_Key column of the Enrichment_Records table to prevent duplicate records from workflow replays
4. WHEN an Enrichment_Activity writes an Enrichment_Record with an Idempotency_Key that already exists, THE Enrichment_Service SHALL return the existing record without creating a duplicate
5. THE Enrichment_Service SHALL index the Enrichment_Records table on (job_id, created_at) for efficient paginated retrieval of records within a job

### Requirement 9: Webhook Notification Support

**User Story:** As a developer integrating with Morket, I want to receive webhook notifications when enrichment jobs complete, so that I can trigger downstream processing without polling.

#### Acceptance Criteria

1. WHEN an admin or owner sends POST /api/v1/workspaces/:id/webhooks with a callback URL and a list of event types, THE Enrichment_Service SHALL create a Webhook_Subscription for the workspace
2. WHEN a user sends GET /api/v1/workspaces/:id/webhooks, THE Enrichment_Service SHALL return all Webhook_Subscriptions for the workspace
3. WHEN a user sends DELETE /api/v1/workspaces/:id/webhooks/:webhookId, THE Enrichment_Service SHALL remove the Webhook_Subscription
4. WHEN an Enrichment_Job reaches a terminal state (completed, failed, partially_completed, cancelled), THE Enrichment_Service SHALL send an HTTP POST to each matching Webhook_Subscription URL with the job ID, status, and summary statistics in the request body
5. WHEN a webhook delivery fails, THE Enrichment_Service SHALL retry delivery up to 3 times with exponential backoff starting at 5 seconds
6. THE Enrichment_Service SHALL include an HMAC-SHA256 signature in the X-Webhook-Signature header of each webhook delivery, computed using a per-subscription secret key, so that receivers can verify authenticity
7. THE Enrichment_Service SHALL set a timeout of 10 seconds for each webhook delivery attempt to prevent blocking on unresponsive endpoints

### Requirement 10: Database Schema for Enrichment Module

**User Story:** As a developer, I want a well-structured database schema for enrichment data, so that jobs, records, and webhooks are stored reliably with proper constraints and indexes.

#### Acceptance Criteria

1. THE Database_Schema SHALL define an enrichment_jobs table with UUID primary key, workspace_id (foreign key to workspaces), status (enum: pending, running, completed, failed, partially_completed, cancelled), requested_fields (JSON array), waterfall_config (JSON, nullable), total_records (integer), completed_records (integer default 0), failed_records (integer default 0), estimated_credits (integer), created_by (foreign key to users), created_at, updated_at, and completed_at (nullable) columns
2. THE Database_Schema SHALL define an enrichment_records table with UUID primary key, job_id (foreign key to enrichment_jobs), workspace_id (foreign key to workspaces), input_data (JSONB), output_data (JSONB, nullable), provider_slug (varchar), credits_consumed (integer default 0), status (enum: success, failed, skipped), error_reason (text, nullable), idempotency_key (varchar, unique), credit_transaction_id (UUID, nullable), created_at, and updated_at columns
3. THE Database_Schema SHALL define a webhook_subscriptions table with UUID primary key, workspace_id (foreign key to workspaces), callback_url (varchar), event_types (JSON array), secret_key (varchar), is_active (boolean default true), created_by (foreign key to users), created_at, and updated_at columns
4. THE Database_Schema SHALL define indexes on enrichment_jobs(workspace_id, created_at DESC), enrichment_records(job_id, created_at), enrichment_records(idempotency_key) UNIQUE, and webhook_subscriptions(workspace_id)
5. THE Database_Schema SHALL use UUID primary keys generated via gen_random_uuid() for all new tables
6. THE Database_Schema SHALL enforce referential integrity through foreign key constraints between enrichment_jobs and workspaces, enrichment_records and enrichment_jobs, enrichment_records and workspaces, and webhook_subscriptions and workspaces