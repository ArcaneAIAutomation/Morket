# Requirements Document

## Introduction

Module 4 implements the frontend spreadsheet UI for the Morket GTM data engine — the primary user-facing interface. Morket competes with Clay.com by providing a spreadsheet-style workspace where each row represents a contact or company record and each column represents a data field that can be enriched from external providers (Apollo, Clearbit, Hunter, web scraping). The frontend is a React 18+ TypeScript single-page application using AG Grid for high-performance DOM-virtualized grid rendering, Zustand for state management, and Tailwind CSS for styling. It consumes the existing backend REST API (Modules 1 & 2) and presents workspace management, enrichment configuration, job monitoring, credential management, and credit/billing features through an intuitive spreadsheet-centric interface.

## Glossary

- **App_Shell**: The top-level React application component responsible for routing, authentication state, workspace selection, and rendering the primary layout (sidebar navigation, header, content area).
- **Auth_Module**: The frontend module handling user registration, login, token storage, automatic token refresh, and logout flows by communicating with the backend auth API.
- **API_Client**: A centralized HTTP client (Axios or Fetch wrapper) that attaches JWT access tokens to requests, handles token refresh on 401 responses, and parses the backend JSON envelope format `{ success, data, error, meta }`.
- **Spreadsheet_View**: The core AG Grid-based view where users view, edit, and enrich contact/company records in a tabular spreadsheet layout.
- **Record**: A single row in the Spreadsheet_View representing a contact or company entity with data fields as columns.
- **Column_Definition**: The schema for a column in the Spreadsheet_View, including field name, data type, display label, width, sort/filter configuration, and optional enrichment provider binding.
- **Enrichment_Panel**: A side panel or modal UI that allows users to configure enrichment runs — selecting target columns, providers, waterfall strategies, and previewing estimated credit costs before execution.
- **Job_Monitor**: A UI component that displays the status and progress of active and historical enrichment jobs, including per-record success/failure breakdowns.
- **Workspace_Switcher**: A UI component in the App_Shell header that allows users to switch between workspaces they are members of.
- **Settings_View**: A collection of settings pages for managing workspace members, roles, API credentials, billing, and credit balances.
- **Toast_Notification**: A transient UI notification (success, error, warning, info) displayed to the user after actions complete or errors occur.
- **Grid_Store**: The Zustand store managing the spreadsheet's row data, column definitions, selection state, sort/filter state, and pagination.
- **Auth_Store**: The Zustand store managing authentication tokens, current user profile, and login/logout state transitions.
- **Workspace_Store**: The Zustand store managing the current workspace context, workspace list, and workspace membership data.

## Requirements

### Requirement 1: Application Shell and Routing

**User Story:** As a user, I want a responsive application shell with navigation, so that I can access all Morket features from a consistent layout.

#### Acceptance Criteria

1. THE App_Shell SHALL render a sidebar navigation with links to Spreadsheet_View, Job_Monitor, and Settings_View sections
2. THE App_Shell SHALL render a header bar containing the Workspace_Switcher, current user avatar, and a logout button
3. WHEN the user is not authenticated, THE App_Shell SHALL redirect all routes to the login page
4. WHEN the user is authenticated but has no workspaces, THE App_Shell SHALL display a workspace creation prompt instead of the main layout
5. THE App_Shell SHALL use React Router for client-side routing with the following route structure: `/login`, `/register`, `/workspaces/:workspaceId/spreadsheet`, `/workspaces/:workspaceId/jobs`, `/workspaces/:workspaceId/settings/*`
6. WHEN the browser window width is below 768px, THE App_Shell SHALL collapse the sidebar into a hamburger menu to support tablet-sized viewports
7. THE App_Shell SHALL persist the last active workspace ID in localStorage so that returning users are directed to their most recent workspace

### Requirement 2: Authentication Flows

**User Story:** As a user, I want to register, log in, and stay authenticated, so that I can securely access my Morket workspaces.

#### Acceptance Criteria

1. WHEN a user submits the registration form with a valid email, password (minimum 8 characters), and display name, THE Auth_Module SHALL send POST /api/v1/auth/register and store the returned access and refresh tokens in the Auth_Store
2. WHEN a user submits the login form with valid credentials, THE Auth_Module SHALL send POST /api/v1/auth/login and store the returned access and refresh tokens in the Auth_Store
3. WHEN the backend returns a 401 response to any API request, THE API_Client SHALL attempt to refresh the access token by sending POST /api/v1/auth/refresh with the stored refresh token
4. WHEN the token refresh succeeds, THE API_Client SHALL retry the original failed request with the new access token
5. WHEN the token refresh fails (invalid or expired refresh token), THE Auth_Module SHALL clear all stored tokens, reset the Auth_Store, and redirect the user to the login page
6. WHEN the user clicks the logout button, THE Auth_Module SHALL send POST /api/v1/auth/logout, clear all stored tokens, reset the Auth_Store, and redirect to the login page
7. THE Auth_Store SHALL store tokens in memory only (not localStorage) to reduce XSS token theft risk, with the refresh token persisted in an httpOnly cookie if supported by the backend
8. IF the registration or login request fails with a validation error, THEN THE Auth_Module SHALL display field-level error messages adjacent to the corresponding form inputs
9. WHEN a registration or login request is in progress, THE Auth_Module SHALL disable the submit button and display a loading indicator to prevent duplicate submissions

### Requirement 3: API Client and Backend Communication

**User Story:** As a developer, I want a centralized API client that handles authentication headers and response parsing, so that all backend communication is consistent and reliable.

#### Acceptance Criteria

1. THE API_Client SHALL attach the JWT access token from the Auth_Store as a Bearer token in the Authorization header of every authenticated request
2. THE API_Client SHALL parse all backend responses expecting the JSON envelope format `{ success, data, error, meta }` and return the `data` field on success or throw a typed error on failure
3. WHEN the backend returns a rate limit error (429), THE API_Client SHALL display a Toast_Notification informing the user to wait before retrying
4. WHEN the backend returns a server error (500), THE API_Client SHALL display a generic Toast_Notification indicating a server error occurred
5. THE API_Client SHALL include a request timeout of 30 seconds for standard API calls and 120 seconds for enrichment job creation requests
6. THE API_Client SHALL serialize request parameters using Zod schemas matching the backend's expected input formats to catch validation errors before sending requests

### Requirement 4: Spreadsheet Grid View

**User Story:** As a GTM analyst, I want a spreadsheet-style grid to view and manage my contact and company records, so that I can work with enrichment data in a familiar tabular interface.

#### Acceptance Criteria

1. THE Spreadsheet_View SHALL render records using AG Grid with DOM virtualization, supporting datasets of 100,000+ rows without degrading scroll performance
2. THE Spreadsheet_View SHALL display a configurable set of columns defined by Column_Definitions stored in the Grid_Store
3. WHEN the user clicks a column header, THE Spreadsheet_View SHALL sort the records by that column in ascending order, and clicking again SHALL toggle to descending order
4. WHEN the user types in a column filter input, THE Spreadsheet_View SHALL filter visible records to those matching the filter text for that column
5. WHEN the user double-clicks a cell, THE Spreadsheet_View SHALL enter inline edit mode for that cell, allowing the user to modify the value
6. WHEN the user finishes editing a cell (blur or Enter key), THE Spreadsheet_View SHALL save the updated value to the Grid_Store and visually indicate the cell has been modified
7. THE Spreadsheet_View SHALL support multi-row selection via checkbox column, Shift+click for range selection, and Ctrl/Cmd+click for individual toggle selection
8. WHEN the user right-clicks a selected row or rows, THE Spreadsheet_View SHALL display a context menu with options: "Enrich Selected", "Delete Selected", and "Export Selected"
9. THE Spreadsheet_View SHALL display a status bar at the bottom showing total row count, selected row count, and current filter state
10. WHEN the user resizes a column by dragging the column border, THE Spreadsheet_View SHALL persist the column width in the Grid_Store
11. WHEN the user reorders columns by dragging a column header, THE Spreadsheet_View SHALL persist the column order in the Grid_Store
12. THE Spreadsheet_View SHALL render enrichment status per cell using color-coded indicators: green for enriched, yellow for pending, red for failed, and gray for empty

### Requirement 5: Record Management (CRUD)

**User Story:** As a GTM analyst, I want to add, edit, and delete records in the spreadsheet, so that I can maintain my contact and company data.

#### Acceptance Criteria

1. WHEN the user clicks the "Add Row" button, THE Spreadsheet_View SHALL append a new empty Record at the bottom of the grid and focus the first editable cell
2. WHEN the user selects one or more rows and clicks "Delete Selected", THE Spreadsheet_View SHALL display a confirmation dialog stating the number of records to be deleted
3. WHEN the user confirms deletion, THE Spreadsheet_View SHALL remove the selected Records from the Grid_Store and display a Toast_Notification confirming the deletion count
4. WHEN the user modifies a cell value, THE Grid_Store SHALL track the modification as a pending change until the user explicitly saves or the auto-save interval triggers
5. THE Spreadsheet_View SHALL auto-save pending changes to the backend every 30 seconds if unsaved modifications exist in the Grid_Store
6. WHEN auto-save or manual save fails, THE Spreadsheet_View SHALL display a Toast_Notification with the error and retain the pending changes for retry
7. WHEN the user presses Ctrl/Cmd+Z, THE Spreadsheet_View SHALL undo the last cell edit, row addition, or row deletion within the current session (up to 50 undo steps)

### Requirement 6: Data Import and Export

**User Story:** As a GTM analyst, I want to import records from CSV files and export my data, so that I can bring in existing contact lists and share enriched data with other tools.

#### Acceptance Criteria

1. WHEN the user clicks "Import CSV", THE Spreadsheet_View SHALL open a file picker dialog accepting .csv files up to 10MB in size
2. WHEN a CSV file is selected, THE Spreadsheet_View SHALL parse the file using a Web Worker to avoid blocking the main thread and display a column mapping preview showing source CSV columns mapped to target Column_Definitions
3. WHEN the user confirms the column mapping, THE Spreadsheet_View SHALL insert the parsed records into the Grid_Store and display a Toast_Notification with the import count
4. IF the CSV file contains rows that fail validation (missing required fields, invalid data types), THEN THE Spreadsheet_View SHALL skip invalid rows, import valid rows, and display a summary showing the count of skipped rows with reasons
5. WHEN the user clicks "Export CSV", THE Spreadsheet_View SHALL generate a CSV file from the current grid data (respecting active filters if the user chooses "Export Filtered") and trigger a browser download
6. WHEN the user selects rows and chooses "Export Selected" from the context menu, THE Spreadsheet_View SHALL generate a CSV file containing only the selected Records
7. WHEN exporting more than 10,000 records, THE Spreadsheet_View SHALL perform the CSV generation in a Web Worker and display a progress indicator

### Requirement 7: Enrichment Configuration and Execution

**User Story:** As a GTM analyst, I want to configure and run enrichment on my records directly from the spreadsheet, so that I can fill in missing data fields using external providers.

#### Acceptance Criteria

1. WHEN the user selects one or more rows and clicks "Enrich", THE Enrichment_Panel SHALL open displaying the selected record count and available enrichment fields
2. THE Enrichment_Panel SHALL list available enrichment fields (email, phone, company_info, job_title, social_profiles, address) with the providers that support each field, fetched from GET /api/v1/providers
3. WHEN the user selects enrichment fields, THE Enrichment_Panel SHALL display the estimated credit cost calculated as (selected records × credit cost per provider per field) and the current workspace credit balance
4. THE Enrichment_Panel SHALL allow the user to configure a waterfall strategy per field by dragging providers into priority order
5. WHEN the user clicks "Run Enrichment", THE Enrichment_Panel SHALL send POST /api/v1/workspaces/:id/enrichment-jobs with the selected records, fields, and waterfall configuration
6. IF the estimated credit cost exceeds the workspace credit balance, THEN THE Enrichment_Panel SHALL disable the "Run Enrichment" button and display a warning with a link to the billing settings
7. WHEN the enrichment job is created successfully, THE Enrichment_Panel SHALL close, display a Toast_Notification with the job ID, and the Spreadsheet_View SHALL update the enrichment status indicators for the affected cells to "pending"
8. WHEN enrichment results are received (via polling or job completion), THE Spreadsheet_View SHALL update the corresponding cells with the enriched data and change the status indicators to "enriched" or "failed"

### Requirement 8: Enrichment Job Monitoring

**User Story:** As a GTM analyst, I want to monitor the progress of my enrichment jobs, so that I can track completion and investigate failures.

#### Acceptance Criteria

1. THE Job_Monitor SHALL display a list of enrichment jobs for the current workspace fetched from GET /api/v1/workspaces/:id/enrichment-jobs, sorted by creation date descending
2. THE Job_Monitor SHALL display each job's status (pending, running, completed, failed, partially_completed, cancelled), progress bar (completed records / total records), estimated credits, and creation timestamp
3. WHEN an enrichment job has status "running", THE Job_Monitor SHALL poll GET /api/v1/workspaces/:id/enrichment-jobs/:jobId every 5 seconds to update the progress display
4. WHEN the user clicks on a job row, THE Job_Monitor SHALL expand the row to show a detailed breakdown of enrichment records fetched from GET /api/v1/workspaces/:id/enrichment-jobs/:jobId/records with per-record status, provider used, and credits consumed
5. WHEN the user clicks "Cancel" on a running job, THE Job_Monitor SHALL send POST /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel and update the job status display to "cancelled"
6. THE Job_Monitor SHALL display a summary card at the top showing total jobs run, total records enriched, total credits consumed, and success rate for the current workspace
7. WHEN a job transitions to a terminal state (completed, failed, partially_completed), THE Job_Monitor SHALL stop polling for that job and display a Toast_Notification with the final status

### Requirement 9: Workspace Management

**User Story:** As a workspace owner, I want to create and manage workspaces, so that I can organize my team's enrichment data.

#### Acceptance Criteria

1. WHEN the user clicks "Create Workspace", THE Settings_View SHALL display a form requesting a workspace name and send POST /api/v1/workspaces on submission
2. WHEN a workspace is created successfully, THE Workspace_Store SHALL add the new workspace to the workspace list and the Workspace_Switcher SHALL select the new workspace as active
3. THE Workspace_Switcher SHALL display a dropdown listing all workspaces the user is a member of, fetched from GET /api/v1/workspaces
4. WHEN the user selects a different workspace from the Workspace_Switcher, THE Workspace_Store SHALL update the active workspace, the App_Shell SHALL navigate to the new workspace's spreadsheet route, and the Grid_Store SHALL load the new workspace's data
5. WHEN the user navigates to workspace settings, THE Settings_View SHALL display the workspace name and allow admins and owners to edit the name via PUT /api/v1/workspaces/:id
6. WHEN the workspace owner clicks "Delete Workspace", THE Settings_View SHALL display a confirmation dialog requiring the user to type the workspace name to confirm, then send DELETE /api/v1/workspaces/:id

### Requirement 10: Member and Role Management

**User Story:** As a workspace admin, I want to invite members and manage roles, so that I can control who has access to the workspace and what they can do.

#### Acceptance Criteria

1. THE Settings_View SHALL display a members list showing each member's name, email, role (owner, admin, member, viewer), and join date
2. WHEN an admin or owner clicks "Invite Member", THE Settings_View SHALL display a form requesting the invitee's email and role, then send POST /api/v1/workspaces/:id/members
3. WHEN an admin or owner changes a member's role via the role dropdown, THE Settings_View SHALL send PUT /api/v1/workspaces/:id/members/:userId/role and update the displayed role on success
4. WHEN an admin or owner clicks "Remove" on a member, THE Settings_View SHALL display a confirmation dialog and send DELETE /api/v1/workspaces/:id/members/:userId on confirmation
5. THE Settings_View SHALL disable role management controls for users whose role is insufficient (viewers and members cannot manage roles)
6. IF the backend rejects a member removal because the member is the last owner, THEN THE Settings_View SHALL display a Toast_Notification explaining that a workspace must have at least one owner

### Requirement 11: API Credential Management

**User Story:** As a workspace admin, I want to store and manage API credentials for enrichment providers, so that the enrichment engine can authenticate with external services.

#### Acceptance Criteria

1. THE Settings_View SHALL display a credentials list showing each stored credential's provider name, a masked key (last 4 characters only), and creation date, fetched from GET /api/v1/workspaces/:id/credentials
2. WHEN an admin or owner clicks "Add Credential", THE Settings_View SHALL display a form with fields for provider name (dropdown of registered providers), API key, and API secret, then send POST /api/v1/workspaces/:id/credentials
3. WHEN a credential is stored successfully, THE Settings_View SHALL add the credential to the list displaying only the masked key and display a Toast_Notification confirming storage
4. WHEN an admin or owner clicks "Delete" on a credential, THE Settings_View SHALL display a confirmation dialog and send DELETE /api/v1/workspaces/:id/credentials/:credId on confirmation
5. THE Settings_View SHALL never display, log, or store raw API key or secret values after the initial submission — only masked values from the backend response are shown
6. THE Settings_View SHALL disable credential management controls for users with member or viewer roles

### Requirement 12: Credit and Billing Management

**User Story:** As a workspace owner, I want to view my credit balance and transaction history, so that I can manage my enrichment spending.

#### Acceptance Criteria

1. THE Settings_View SHALL display the current workspace credit balance, plan type, and auto-recharge configuration fetched from GET /api/v1/workspaces/:id/billing
2. WHEN the workspace owner clicks "Add Credits", THE Settings_View SHALL display a form to enter a credit amount and send POST /api/v1/workspaces/:id/billing/credits
3. THE Settings_View SHALL display a paginated transaction history table showing transaction type, amount, description, and timestamp fetched from GET /api/v1/workspaces/:id/billing/transactions
4. WHEN the user scrolls to the bottom of the transaction history, THE Settings_View SHALL load the next page of transactions (infinite scroll pagination)
5. THE Settings_View SHALL disable the "Add Credits" button for users who are not workspace owners
6. THE Settings_View SHALL display a warning banner when the credit balance falls below 10% of the credit limit

### Requirement 13: Role-Based UI Adaptation

**User Story:** As a user with a specific role, I want the UI to reflect my permissions, so that I only see actions I am authorized to perform.

#### Acceptance Criteria

1. WHILE the current user has the "viewer" role in the active workspace, THE Spreadsheet_View SHALL render all cells as read-only and hide the "Add Row", "Delete Selected", "Enrich", and "Import CSV" buttons
2. WHILE the current user has the "member" role, THE Spreadsheet_View SHALL allow editing and enrichment but THE Settings_View SHALL hide credential management and member role controls
3. WHILE the current user has the "admin" role, THE Settings_View SHALL display credential management and member management controls but hide the "Delete Workspace" and "Add Credits" buttons
4. WHILE the current user has the "owner" role, THE Settings_View SHALL display all management controls including "Delete Workspace" and "Add Credits"
5. WHEN the backend returns a 403 Forbidden response to any action, THE App_Shell SHALL display a Toast_Notification stating the user lacks permission for the attempted action
6. THE Workspace_Store SHALL fetch and cache the current user's role for the active workspace from the workspace membership data and expose the role to all UI components via the store

### Requirement 14: Column Management and Configuration

**User Story:** As a GTM analyst, I want to add, remove, and configure columns in the spreadsheet, so that I can customize the data layout for my workflow.

#### Acceptance Criteria

1. WHEN the user clicks "Add Column", THE Spreadsheet_View SHALL display a dialog to enter the column name, select the data type (text, number, email, URL, date, boolean), and optionally bind the column to an enrichment field
2. WHEN a column is bound to an enrichment field, THE Spreadsheet_View SHALL display the associated provider icon in the column header and include the column in enrichment runs targeting that field
3. WHEN the user right-clicks a column header, THE Spreadsheet_View SHALL display a context menu with options: "Rename Column", "Change Type", "Hide Column", and "Delete Column"
4. WHEN the user selects "Delete Column", THE Spreadsheet_View SHALL display a confirmation dialog warning that column data for all records will be lost
5. WHEN the user selects "Hide Column", THE Spreadsheet_View SHALL remove the column from the visible grid but retain the data in the Grid_Store, and display the hidden column in a "Hidden Columns" list accessible from the toolbar
6. THE Spreadsheet_View SHALL support pinning columns to the left side of the grid so that pinned columns remain visible during horizontal scrolling

### Requirement 15: Performance and Responsiveness

**User Story:** As a user, I want the application to remain responsive even with large datasets, so that my workflow is not interrupted by slow rendering or blocked interactions.

#### Acceptance Criteria

1. THE Spreadsheet_View SHALL render the initial grid with 10,000 records within 2 seconds of data availability, using AG Grid's row virtualization
2. WHEN the user scrolls through the grid, THE Spreadsheet_View SHALL maintain a frame rate of at least 30 frames per second for smooth scrolling
3. THE Spreadsheet_View SHALL perform CSV parsing and CSV generation in a Web Worker to prevent blocking the main thread
4. WHEN the API_Client is waiting for a backend response, THE App_Shell SHALL display a non-blocking loading indicator (skeleton screen or spinner) without disabling user interaction with other parts of the UI
5. THE Grid_Store SHALL use Zustand's shallow equality checks and selector patterns to prevent unnecessary re-renders when unrelated state changes occur
6. WHEN the user types in a filter input, THE Spreadsheet_View SHALL debounce the filter operation by 300 milliseconds to avoid excessive re-filtering during rapid typing

### Requirement 16: Error Handling and User Feedback

**User Story:** As a user, I want clear feedback when actions succeed or fail, so that I understand the state of my operations.

#### Acceptance Criteria

1. WHEN any API request fails, THE App_Shell SHALL display a Toast_Notification with a user-friendly error message derived from the backend error envelope
2. THE Toast_Notification SHALL auto-dismiss after 5 seconds for success messages and remain visible until manually dismissed for error messages
3. WHEN the user's network connection is lost, THE App_Shell SHALL display a persistent banner indicating offline status and disable actions that require backend communication
4. WHEN the network connection is restored, THE App_Shell SHALL remove the offline banner and re-enable actions
5. IF an unhandled JavaScript error occurs, THEN THE App_Shell SHALL catch the error via an error boundary, display a fallback UI with a "Reload" button, and log the error details to the browser console
6. WHEN a form submission fails with field-level validation errors from the backend, THE App_Shell SHALL display the errors inline adjacent to the corresponding form fields
