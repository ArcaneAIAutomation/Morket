# Implementation Plan: Menu Fixes & Options Configuration

## Overview

Incremental implementation starting with bug fixes for three broken pages (Search, Members, Billing), then building the new Options configuration page with backend storage, encryption, and connection testing. Each task builds on previous work. Backend changes come first where needed, then frontend wiring.

## Tasks

- [x] 1. Fix Search page error handling
  - [x] 1.1 Fix error extraction in search store
    - Modify `packages/frontend/src/stores/search.store.ts`
    - Replace `String(err)` in catch blocks with proper error message extraction: check for `err.message` on ApiError-shaped objects, then `Error` instances, then fallback to a generic string
    - Ensure the `error` state property is always a `string`, never an object
    - Add network error detection: if `err.status === 0` or no response, set a connectivity-specific message
    - _Requirements: 1.1, 2.2, 2.3_

  - [x] 1.2 Write property test for error extraction (Property 1)
    - **Property 1: Error extraction always produces a readable string**
    - Generate random error-like values (ApiError objects, Error instances, strings, numbers, null, undefined, arbitrary objects) using fast-check
    - Verify extraction always returns `typeof === 'string'`, non-empty, and not equal to `'[object Object]'`
    - Create `packages/frontend/tests/property/error-extraction.test.ts`
    - **Validates: Requirements 1.1, 2.3**

  - [x] 1.3 Update SearchResultsView with retry and error states
    - Modify `packages/frontend/src/components/SearchResultsView.tsx`
    - Add a "Retry" button in the error state that re-executes the current search query
    - Hide the results list and pagination controls when `search.error` is set
    - Display network-specific error message when status is 0: "Unable to connect to the search service. Check your connection and try again."
    - Show descriptive message for 500 errors: "Search service is unavailable. Please try again later."
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2_


- [x] 2. Fix Members page — backend endpoint and frontend states
  - [x] 2.1 Add members list endpoint to workspace module
    - Add `findAllWithUsers(workspaceId)` to `packages/backend/src/modules/workspace/membership.repository.ts` — JOIN `workspace_memberships` with `users` to return userId, email, displayName, role, joinedAt
    - Add `listMembers(workspaceId)` to `packages/backend/src/modules/workspace/workspace.service.ts`
    - Add `listMembers` handler to `packages/backend/src/modules/workspace/workspace.controller.ts`
    - Wire `GET /:id/members` route in `packages/backend/src/modules/workspace/workspace.routes.ts` with `validate({ params: workspaceParamsSchema })` and `requireRole('member')`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Write property test for members endpoint (Property 2)
    - **Property 2: Members endpoint returns complete member data**
    - Generate random membership+user records using fast-check; verify service returns correct count with all required fields (userId, email, displayName, role, joinedAt) non-null
    - Create `packages/backend/tests/property/members-list.test.ts`
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.3 Update MemberSettings with loading, error, and empty states
    - Modify `packages/frontend/src/components/MemberSettings.tsx`
    - Add `isLoadingMembers` state with loading indicator while fetching
    - Add inline error state with "Retry" button when GET members fails (not just a toast)
    - Add empty state: "No other members yet. Invite someone to get started." with invite form visible
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Fix Billing page crash and resilience
  - [x] 3.1 Refactor BillingSettings for independent section loading
    - Modify `packages/frontend/src/components/BillingSettings.tsx`
    - Split single `useEffect` into two independent data-fetching calls: one for billing info, one for transactions
    - Add separate state pairs: `billingLoading`/`billingError` and `txLoading`/`txError`
    - Add null guards on all `billing.*` property access before rendering
    - Add loading placeholders for credit balance and plan info cards
    - Add per-section error+retry UI: "Unable to load billing information" / "Unable to load transaction history"
    - Wrap rendering in try/catch to prevent ErrorBoundary crashes on unexpected data shapes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3_

  - [x] 3.2 Write property test for billing resilience (Property 3)
    - **Property 3: Billing page resilience to malformed data**
    - Generate random malformed billing data shapes using fast-check; verify component renders without throwing
    - Create `packages/frontend/tests/property/billing-resilience.test.ts`
    - **Validates: Requirements 5.1, 5.4**

  - [x] 3.3 Write property test for billing independence (Property 4)
    - **Property 4: Billing sections render independently**
    - Generate all 4 combinations of success/failure for billing info + transactions; verify each section renders independently
    - Create `packages/frontend/tests/property/billing-independence.test.ts`
    - **Validates: Requirements 5.2, 6.1**

- [x] 4. Checkpoint — Bug fixes complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create Options backend — database migration and repository
  - [x] 5.1 Create service_configurations migration
    - Create `packages/backend/migrations/023_create_service_configurations.ts`
    - Define `up`: CREATE TABLE `service_configurations` with columns: id (UUID PK), workspace_id (FK), service_key (VARCHAR 50), service_group (VARCHAR 50), encrypted_values (TEXT), iv (VARCHAR 24), auth_tag (VARCHAR 24), status (VARCHAR 20 DEFAULT 'configured'), last_tested_at (TIMESTAMPTZ), created_by (UUID FK), created_at, updated_at
    - Add UNIQUE constraint on (workspace_id, service_key)
    - Add index on workspace_id
    - Define `down`: DROP TABLE
    - _Requirements: 8.1_

  - [x] 5.2 Create options repository
    - Create `packages/backend/src/modules/workspace/options.repository.ts`
    - Implement `findAllByWorkspace(workspaceId)` — SELECT all configs for a workspace
    - Implement `findByServiceKey(workspaceId, serviceKey)` — SELECT single config
    - Implement `upsert(workspaceId, serviceKey, data)` — INSERT ON CONFLICT UPDATE
    - Implement `deleteByServiceKey(workspaceId, serviceKey)` — DELETE
    - Implement `updateStatus(workspaceId, serviceKey, status, lastTestedAt)` — UPDATE status fields
    - All queries use parameterized SQL
    - _Requirements: 8.1_

- [x] 6. Create Options backend — service, schemas, and controller
  - [x] 6.1 Add Zod schemas for options endpoints
    - Add to `packages/backend/src/modules/workspace/workspace.schemas.ts`
    - Define `serviceKeyEnum` with all valid service keys: apollo, clearbit, hunter, scraper, salesforce, hubspot, stripe, temporal, opensearch, redis, clickhouse
    - Define `upsertOptionsSchema` with `values: z.record(z.string().min(1), z.string())` and non-empty refinement
    - Define `optionsParamsSchema` with `id: z.string().uuid()` and `serviceKey: serviceKeyEnum`
    - _Requirements: 7.4, 8.1_

  - [x] 6.2 Create options service with encryption and masking
    - Create `packages/backend/src/modules/workspace/options.service.ts`
    - Implement `listConfigurations(workspaceId, masterKey)` — decrypt and mask sensitive fields (fields containing `key`, `secret`, `token`, `password` → `****` + last 4 chars); return non-sensitive fields in full
    - Implement `upsertConfiguration(workspaceId, serviceKey, serviceGroup, values, userId, masterKey)` — encrypt values using `deriveWorkspaceKey` + AES-256-GCM; log audit entry with userId, workspaceId, serviceKey (no values)
    - Implement `deleteConfiguration(workspaceId, serviceKey)` — remove from DB
    - Implement `testConnection(workspaceId, serviceKey, masterKey)` — decrypt config, run lightweight health check per service type, return `{ success, responseTimeMs, error? }`
    - For enrichment provider keys (apollo, clearbit, hunter), sync credential to existing credential store on upsert
    - _Requirements: 8.2, 8.3, 8.6, 9.2, 10.6_

  - [x] 6.3 Write property test for encryption round trip (Property 6)
    - **Property 6: Configuration encryption round trip**
    - Generate random `Record<string, string>` objects; verify encrypt→decrypt→JSON.parse produces deeply equal objects
    - Create `packages/backend/tests/property/options-encryption.test.ts`
    - **Validates: Requirements 8.2**

  - [x] 6.4 Write property test for sensitive field masking (Property 7)
    - **Property 7: Sensitive field masking**
    - Generate random strings; verify masking rules: length > 4 → `****` + last 4 chars and not equal to original; length ≤ 4 → unchanged
    - Create `packages/backend/tests/property/options-masking.test.ts`
    - **Validates: Requirements 8.3**

  - [x] 6.5 Write property test for audit log exclusion (Property 8)
    - **Property 8: Audit log excludes configuration values**
    - Generate random config values; verify audit log entry contains userId, workspaceId, serviceKey but does not contain any config value strings
    - Create `packages/backend/tests/property/options-audit.test.ts`
    - **Validates: Requirements 8.6**

  - [x] 6.6 Add options controller and wire routes
    - Add options handlers to `packages/backend/src/modules/workspace/workspace.controller.ts`: `listOptions`, `upsertOption`, `deleteOption`, `testOptionConnection`
    - Wire routes in `packages/backend/src/modules/workspace/workspace.routes.ts`:
      - `GET /:id/options` with `requireRole('admin')`
      - `PUT /:id/options/:serviceKey` with `requireRole('admin')` and `validate({ params: optionsParamsSchema, body: upsertOptionsSchema })`
      - `DELETE /:id/options/:serviceKey` with `requireRole('admin')` and `validate({ params: optionsParamsSchema })`
      - `POST /:id/options/:serviceKey/test` with `requireRole('admin')` and `validate({ params: optionsParamsSchema })`
    - _Requirements: 8.1, 8.4, 8.5_

- [x] 7. Checkpoint — Options backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Create Options frontend — page, routing, and API client
  - [x] 8.1 Create options API client
    - Create `packages/frontend/src/api/options.api.ts`
    - Implement `getOptions(workspaceId)` — GET `/workspaces/:id/options`
    - Implement `saveOption(workspaceId, serviceKey, values)` — PUT `/workspaces/:id/options/:serviceKey`
    - Implement `deleteOption(workspaceId, serviceKey)` — DELETE `/workspaces/:id/options/:serviceKey`
    - Implement `testConnection(workspaceId, serviceKey)` — POST `/workspaces/:id/options/:serviceKey/test`
    - Define frontend types: `ServiceConfiguration`, `ConnectionTestResult`
    - _Requirements: 7.1, 9.1_

  - [x] 8.2 Create OptionsSettings component
    - Create `packages/frontend/src/components/OptionsSettings.tsx`
    - Organize into 5 collapsible groups: Enrichment Providers, Scraping Service, CRM Integrations, Billing, Infrastructure
    - Each service shows: name, status indicator (green=configured, gray=not_configured, red=error), config form fields, "Test Connection" button
    - Define form fields per service key (Apollo/Clearbit/Hunter: apiKey; Stripe: secretKey+webhookSecret; Scraper: serviceUrl+serviceKey; etc.)
    - Client-side Zod validation before submit
    - "Test Connection" button: loading spinner while in progress, success indicator with response time, failure indicator with error message
    - Role-gate: only render for admin+ via `useRole().can('manage_credentials')`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 8.3 Write property test for options validation (Property 5)
    - **Property 5: Options Zod validation rejects invalid configurations**
    - Generate random invalid config objects (empty values, missing fields, invalid service keys); verify Zod schema rejects them
    - Create `packages/frontend/tests/property/options-validation.test.ts`
    - **Validates: Requirements 7.4**

  - [x] 8.4 Wire Options tab into settings layout and routing
    - Modify `packages/frontend/src/components/SettingsLayout.tsx` — add `{ to: 'options', label: 'Options' }` tab after Credentials
    - Modify `packages/frontend/src/App.tsx` — add lazy-loaded route `settings/options` → `OptionsSettings`
    - _Requirements: 7.1_

- [x] 9. Credential sync for enrichment providers
  - [x] 9.1 Implement enrichment provider credential sync
    - In `options.service.ts` `upsertConfiguration`, when serviceKey is `apollo`, `clearbit`, or `hunter`, call the existing credential service to create/update the corresponding credential entry for backward compatibility
    - _Requirements: 10.6_

  - [x] 9.2 Write property test for credential sync (Property 9)
    - **Property 9: Enrichment provider credential sync**
    - Generate random enrichment provider configs; verify credential is retrievable via credential service after options upsert
    - Create `packages/backend/tests/property/options-credential-sync.test.ts`
    - **Validates: Requirements 10.6**

- [x] 10. Final checkpoint — All features complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Bug fixes (tasks 1–3) are independent of each other and can be implemented in any order
- Options backend (tasks 5–6) must be completed before Options frontend (task 8)
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- All backend code uses TypeScript strict mode with Zod validation
- All frontend code uses React 18 + TypeScript + Zustand + Tailwind CSS
