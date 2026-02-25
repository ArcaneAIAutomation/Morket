# Requirements Document

## Introduction

This feature addresses two concerns in the Morket application:

1. **Broken pages**: Three frontend pages currently fail at runtime due to missing backend endpoints, incorrect error object rendering, and unhandled API failures. The Search page renders `[object Object]` and shows server error toasts. The Members settings page shows "Failed to load members" because no GET endpoint exists for listing workspace members. The Billing settings page crashes the React ErrorBoundary because the component attempts to render before data loads and does not gracefully handle API failures.

2. **Options configuration page**: A new dedicated settings tab where workspace administrators can configure all third-party service access tokens, API keys, and integration settings needed to make the enrichment pipeline, scraping, CRM integrations, and billing work end-to-end. This consolidates the existing per-provider credential management with broader service configuration (Stripe keys, Temporal connection, OpenSearch, Redis, scraper service URL, etc.) into a single "Options" settings area.

## Glossary

- **Search_Page**: The frontend view at `/workspaces/:workspaceId/search` that performs full-text search via OpenSearch and displays results with facets, sorting, and pagination.
- **Members_Page**: The frontend settings tab at `/workspaces/:workspaceId/settings/members` that lists workspace members, allows inviting new members, changing roles, and removing members.
- **Billing_Page**: The frontend settings tab at `/workspaces/:workspaceId/settings/billing` that displays credit balance, plan info, and transaction history.
- **Options_Page**: A new frontend settings tab at `/workspaces/:workspaceId/settings/options` that provides a unified configuration area for all third-party service integrations and API keys.
- **API_Client**: The Axios-based HTTP client in the frontend that wraps all backend calls, unwraps the `{ success, data, error, meta }` envelope, and handles 401/429/403/500 responses.
- **Error_State**: A UI state displayed when an API call fails, showing a user-friendly message and optional retry action instead of raw error objects or blank screens.
- **Workspace_Service**: The backend service layer in `packages/backend/src/modules/workspace/` that handles workspace CRUD and membership operations.
- **Credit_Routes**: The backend Express router in `packages/backend/src/modules/credit/` mounted at `/api/v1/workspaces/:id/billing` that serves billing info and transaction history.
- **ErrorBoundary**: The React error boundary component that catches unhandled render errors and displays a fallback UI with a reload button.
- **Service_Configuration**: A stored record associating a workspace with connection parameters for a third-party service (e.g., Stripe API key, scraper service URL, Temporal namespace).

## Requirements

### Requirement 1: Search Page Error Display

**User Story:** As a user, I want the Search page to display readable error messages when search fails, so that I can understand what went wrong instead of seeing `[object Object]`.

#### Acceptance Criteria

1. WHEN a search API call returns an error, THE Search_Page SHALL display the error message as a human-readable string, not as a raw object representation.
2. WHEN the search API returns a 500 status, THE Search_Page SHALL display a descriptive error message such as "Search service is unavailable. Please try again later." in the error state area.
3. WHEN the search API returns an error, THE Search_Page SHALL provide a "Retry" button that re-executes the search query.
4. WHILE the Search_Page is in an Error_State, THE Search_Page SHALL hide the results list and pagination controls.

### Requirement 2: Search Page Graceful Degradation

**User Story:** As a user, I want the Search page to handle missing backend services gracefully, so that the page remains usable even when OpenSearch is unavailable.

#### Acceptance Criteria

1. WHEN the Search_Page loads and the initial search call fails, THE Search_Page SHALL display the error state with a retry option instead of showing loading skeletons indefinitely.
2. IF the search API call throws a network error, THEN THE Search_Page SHALL display "Unable to connect to the search service. Check your connection and try again."
3. THE Search_Page SHALL ensure that the error property in the search store is always stored as a string, not as an object.

### Requirement 3: Members Page — Backend List Endpoint

**User Story:** As a workspace member, I want to view all members of my workspace, so that I can see who has access and what roles they hold.

#### Acceptance Criteria

1. THE Workspace_Service SHALL expose a `GET /api/v1/workspaces/:id/members` endpoint that returns all members of the specified workspace.
2. WHEN the `GET /api/v1/workspaces/:id/members` endpoint is called, THE Workspace_Service SHALL return an array of member objects containing userId, email, displayName, role, and joinedAt fields.
3. THE `GET /api/v1/workspaces/:id/members` endpoint SHALL require the `member` role or higher for access.
4. WHEN the workspace has no members other than the owner, THE Workspace_Service SHALL return an array containing at least the owner.

### Requirement 4: Members Page — Frontend Error Handling

**User Story:** As a user, I want the Members page to clearly indicate loading and error states, so that I understand whether members are being fetched or if something went wrong.

#### Acceptance Criteria

1. WHILE the Members_Page is fetching members, THE Members_Page SHALL display a loading indicator.
2. WHEN the members API call fails, THE Members_Page SHALL display an inline error message with a "Retry" button instead of only showing a toast notification.
3. WHEN the members API call succeeds but returns an empty array, THE Members_Page SHALL display "No other members yet. Invite someone to get started." with the invite form visible.

### Requirement 5: Billing Page Crash Prevention

**User Story:** As a user, I want the Billing page to load without crashing, so that I can view my credit balance and transaction history.

#### Acceptance Criteria

1. WHEN the billing API call fails, THE Billing_Page SHALL display an inline error state with a "Retry" button instead of crashing the ErrorBoundary.
2. WHEN the transactions API call fails independently of the billing info call, THE Billing_Page SHALL still display the billing info section and show an error message only in the transactions section.
3. WHILE billing data is loading, THE Billing_Page SHALL display loading placeholders for the credit balance and plan info cards.
4. IF the billing API returns an unexpected data shape, THEN THE Billing_Page SHALL catch the rendering error and display a recoverable error state instead of triggering the ErrorBoundary.

### Requirement 6: Billing Page Data Resilience

**User Story:** As a user, I want the Billing page to handle partial data gracefully, so that one failing API call does not prevent the entire page from rendering.

#### Acceptance Criteria

1. THE Billing_Page SHALL make the billing info and transactions API calls independently, so that a failure in one does not block the other.
2. WHEN the billing info API call fails, THE Billing_Page SHALL display "Unable to load billing information" with a retry button in the billing info section, while still attempting to load transactions.
3. WHEN the transactions API call fails, THE Billing_Page SHALL display "Unable to load transaction history" with a retry button in the transactions section, while still displaying billing info if available.

### Requirement 7: Options Configuration Page — Service Registry

**User Story:** As a workspace administrator, I want a dedicated Options page where I can configure all third-party service connections, so that I can set up the enrichment pipeline, scraping, CRM integrations, and billing from a single location.

#### Acceptance Criteria

1. THE Options_Page SHALL be accessible as a new tab labeled "Options" in the Settings navigation, positioned after the "Credentials" tab.
2. THE Options_Page SHALL require the `admin` role or higher for access.
3. THE Options_Page SHALL organize service configurations into logical groups: Enrichment Providers, Scraping Service, CRM Integrations, Billing, and Infrastructure.
4. WHEN a user saves a service configuration, THE Options_Page SHALL validate the configuration values using client-side Zod schemas before submitting to the backend.
5. THE Options_Page SHALL display the current configuration status for each service (configured, not configured, or error) using color-coded status indicators.

### Requirement 8: Options Configuration Page — Backend Storage

**User Story:** As a workspace administrator, I want service configurations to be securely stored and retrievable, so that they persist across sessions and are protected at rest.

#### Acceptance Criteria

1. THE Workspace_Service SHALL expose CRUD endpoints for service configurations at `/api/v1/workspaces/:id/options`.
2. WHEN a service configuration contains sensitive values (API keys, secrets, tokens), THE Workspace_Service SHALL encrypt the sensitive values using the existing AES-256-GCM per-workspace encryption before storage.
3. WHEN service configurations are retrieved via the GET endpoint, THE Workspace_Service SHALL return masked values for sensitive fields (showing only the last 4 characters) and never return raw secrets.
4. THE `GET /api/v1/workspaces/:id/options` endpoint SHALL require the `admin` role or higher.
5. THE `PUT /api/v1/workspaces/:id/options/:serviceKey` endpoint SHALL require the `admin` role or higher.
6. WHEN a service configuration is created or updated, THE Workspace_Service SHALL log an audit entry containing the user ID, workspace ID, and service key, without logging the configuration values.

### Requirement 9: Options Configuration Page — Connection Testing

**User Story:** As a workspace administrator, I want to test service connections from the Options page, so that I can verify my configuration is correct before relying on it.

#### Acceptance Criteria

1. THE Options_Page SHALL provide a "Test Connection" button for each configurable service.
2. WHEN the "Test Connection" button is clicked, THE Options_Page SHALL call a backend endpoint that performs a lightweight connectivity check against the target service.
3. WHEN the connection test succeeds, THE Options_Page SHALL display a success indicator with the response time.
4. WHEN the connection test fails, THE Options_Page SHALL display the failure reason in a user-readable format.
5. WHILE a connection test is in progress, THE Options_Page SHALL disable the "Test Connection" button and show a loading spinner.

### Requirement 10: Options Page — Service Configuration Groups

**User Story:** As a workspace administrator, I want service configurations organized by category, so that I can quickly find and configure the services I need.

#### Acceptance Criteria

1. THE Options_Page SHALL display an "Enrichment Providers" group containing configuration fields for Apollo, Clearbit, and Hunter API credentials, with a note that these mirror the Credentials tab for backward compatibility.
2. THE Options_Page SHALL display a "Scraping Service" group containing fields for the scraper service URL and service key (X-Service-Key).
3. THE Options_Page SHALL display a "CRM Integrations" group containing OAuth connection status and configuration for Salesforce and HubSpot.
4. THE Options_Page SHALL display a "Billing" group containing Stripe API key configuration and webhook secret.
5. THE Options_Page SHALL display an "Infrastructure" group containing optional configuration fields for Temporal namespace/address, OpenSearch endpoint, Redis URL, and ClickHouse connection.
6. WHEN a service in the "Enrichment Providers" group is configured via the Options_Page, THE Options_Page SHALL sync the credential to the existing Credentials store to maintain backward compatibility.
