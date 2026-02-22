# Tasks: Module 4 — Frontend Spreadsheet UI

## Task 1: Project Scaffolding and Configuration

- [x] 1.1 Initialize `packages/frontend` with Vite + React 18 + TypeScript (strict mode)
- [x] 1.2 Install and configure core dependencies: `react-router-dom`, `zustand`, `axios`, `ag-grid-react`, `ag-grid-community`, `tailwindcss`, `zod`
- [x] 1.3 Install and configure dev/test dependencies: `vitest`, `fast-check`, `@testing-library/react`, `@testing-library/jest-dom`, `msw`, `jsdom`
- [x] 1.4 Configure `vite.config.ts` with API proxy to backend (`/api/v1` → `http://localhost:3000`), Web Worker support, and path aliases
- [x] 1.5 Configure `tailwind.config.js`, `postcss.config.js`, and `src/index.css` with Tailwind directives and AG Grid theme overrides
- [x] 1.6 Configure `tsconfig.json` with strict mode, path aliases (`@/`), and JSX settings
- [x] 1.7 Configure `vitest` in `vite.config.ts` with jsdom environment, setup file (`tests/setup.ts`), and coverage settings
- [x] 1.8 Create `tests/setup.ts` with jsdom setup, MSW server initialization, and Testing Library matchers

## Task 2: API Client and Type Definitions

- [x] 2.1 Create `src/types/api.types.ts` with `ApiEnvelope`, `ApiError`, `User`, `AuthTokens`, `LoginRequest`, `RegisterRequest`, `Workspace`, `WorkspaceMember`, `WorkspaceRole`, `Credential`, `BillingInfo`, `CreditTransaction` interfaces
- [x] 2.2 Create `src/types/grid.types.ts` with `ColumnDataType`, `CellEnrichmentStatus`, `ColumnDefinition`, `RecordRow`, `PendingChange`, `UndoEntry` interfaces
- [x] 2.3 Create `src/types/enrichment.types.ts` with `EnrichmentFieldType`, `JobStatus`, `Provider`, `WaterfallConfig`, `EnrichmentJob`, `EnrichmentRecord` interfaces
- [x] 2.4 Create `src/api/client.ts` with Axios instance, request interceptor (Bearer token attachment), response interceptor (envelope unwrapping, 401 refresh+retry, 429/500 toast, error parsing), and enrichment client with 120s timeout
- [x] 2.5 Create API module files: `src/api/auth.api.ts`, `workspace.api.ts`, `records.api.ts`, `enrichment.api.ts`, `credentials.api.ts`, `billing.api.ts`, `members.api.ts` — each exporting typed functions calling the API client
- [x] 2.6 Create Zod request schemas in each API module for client-side pre-validation of request payloads

## Task 3: Zustand Stores

- [x] 3.1 Create `src/stores/auth.store.ts` with `AuthState` interface: in-memory token storage, login/register/logout actions, setTokens/clearAuth helpers
- [x] 3.2 Create `src/stores/workspace.store.ts` with `WorkspaceState` interface: workspace list, active workspace ID (synced to localStorage), current role, member management actions
- [x] 3.3 Create `src/stores/grid.store.ts` with `GridState` interface: row data, column definitions, selection, pending changes, undo stack (max 50), sort/filter model, column operations (add/update/delete/hide/show/reorder/resize), cell edit with dirty tracking
- [x] 3.4 Create `src/stores/job.store.ts` with `JobState` interface: job list, active polling set, summary aggregation, fetchJobs/cancelJob/startPolling/stopPolling actions
- [x] 3.5 Create `src/stores/ui.store.ts` with `UIState` interface: toast queue (max 5, auto-dismiss for success, persist for error), offline status, sidebar collapsed/open state

## Task 4: Shared Components and Utilities

- [x] 4.1 Create `src/utils/permissions.ts` with `ROLE_PERMISSIONS` map and `hasPermission(role, action)` function
- [x] 4.2 Create `src/utils/formatters.ts` with date, number, and credit formatting utilities
- [x] 4.3 Create `src/components/shared/Toast.tsx` — fixed-position toast container, auto-dismiss after 5s for success, manual dismiss for errors, max 5 visible
- [x] 4.4 Create `src/components/shared/ConfirmDialog.tsx` — reusable modal dialog with title, message, confirm/cancel buttons, optional text input confirmation (for workspace delete)
- [x] 4.5 Create `src/components/shared/LoadingSpinner.tsx` — non-blocking loading indicator (spinner/skeleton)
- [x] 4.6 Create `src/components/shared/OfflineBanner.tsx` — persistent banner when `uiStore.isOffline` is true
- [x] 4.7 Create `src/components/shared/ErrorBoundary.tsx` — React error boundary with fallback UI ("Something went wrong" + Reload button), console.error logging

## Task 5: Authentication UI

- [x] 5.1 Create `src/components/auth/LoginForm.tsx` — email/password form, field-level validation errors, loading state on submit, calls `authStore.login()`
- [x] 5.2 Create `src/components/auth/RegisterForm.tsx` — email/password (min 8 chars)/displayName form, field-level validation errors, loading state, calls `authStore.register()`
- [x] 5.3 Create `src/hooks/useAuth.ts` — convenience hook exposing `isAuthenticated`, `user`, `login`, `register`, `logout` from Auth_Store

## Task 6: App Shell and Routing

- [x] 6.1 Create `src/App.tsx` with React Router v6 setup: `/login`, `/register`, protected workspace routes (`/workspaces/:workspaceId/*`)
- [x] 6.2 Create `src/components/layout/AuthGuard.tsx` — redirects to `/login` if not authenticated, shows workspace creation prompt if no workspaces, otherwise renders `<Outlet />`
- [x] 6.3 Create `src/components/layout/AppShell.tsx` — sidebar + header + `<Outlet />` content area, responsive sidebar collapse at <768px via hamburger menu
- [x] 6.4 Create `src/components/layout/Sidebar.tsx` — navigation links to Spreadsheet, Jobs, Settings; collapsible; highlights active route
- [x] 6.5 Create `src/components/layout/Header.tsx` — Workspace_Switcher dropdown, user avatar, logout button
- [x] 6.6 Create `src/hooks/useOnlineStatus.ts` — listens to online/offline events, updates `uiStore.setOffline()`

## Task 7: Spreadsheet Grid View

- [x] 7.1 Create `src/components/spreadsheet/SpreadsheetView.tsx` — AG Grid wrapper with `rowModelType: 'clientSide'`, `rowSelection: 'multiple'`, column definitions from Grid_Store, event handlers for sort/filter/resize/reorder/cell edit
- [x] 7.2 Create `src/components/spreadsheet/CellRenderer.tsx` — custom AG Grid cell renderer with enrichment status color indicators (green/yellow/red/gray)
- [x] 7.3 Create `src/components/spreadsheet/GridToolbar.tsx` — buttons: Add Row, Delete Selected, Import CSV, Export CSV, Add Column, Hidden Columns dropdown; role-based visibility via `useRole` hook
- [x] 7.4 Create `src/components/spreadsheet/StatusBar.tsx` — displays total row count, selected row count, active filter indicator
- [x] 7.5 Create `src/components/spreadsheet/ContextMenu.tsx` — right-click context menu: Enrich Selected, Delete Selected, Export Selected; column header context menu: Rename, Change Type, Hide, Delete
- [x] 7.6 Create `src/components/spreadsheet/ColumnDialog.tsx` — add/edit column dialog: name, data type dropdown, optional enrichment field binding
- [x] 7.7 Create `src/hooks/useRole.ts` — reads `workspaceStore.currentRole`, exposes `hasPermission(action)` using permissions utility
- [x] 7.8 Implement keyboard shortcut: Ctrl/Cmd+Z triggers `gridStore.undo()` via `useEffect` keydown listener
- [x] 7.9 Implement filter debouncing: 300ms debounce on `onFilterChanged` AG Grid event before updating Grid_Store

## Task 8: Record Management (CRUD) and Auto-Save

- [x] 8.1 Implement `gridStore.addRow()` — appends new RecordRow with `_isNew: true`, empty fields, pushes to undo stack
- [x] 8.2 Implement `gridStore.deleteRows(rowIds)` — removes rows, stores deleted rows in undo stack, calls backend batch delete
- [x] 8.3 Implement `gridStore.updateCell()` — updates field value, marks record dirty, adds PendingChange, pushes to undo stack
- [x] 8.4 Implement `gridStore.undo()` — pops last UndoEntry, reverses the operation (restore deleted rows, revert cell edit, remove added row), max 50 entries
- [x] 8.5 Implement `gridStore.saveChanges()` — batches pending changes into backend API calls (POST for new rows, PUT batch for edits, DELETE batch for deletions), clears pending changes on success, shows toast on failure
- [x] 8.6 Create `src/hooks/useAutoSave.ts` — 30s interval, checks `gridStore.isDirty`, calls `saveChanges()`, pauses when offline, shows toast on failure

## Task 9: CSV Import/Export with Web Worker

- [x] 9.1 Create `src/workers/csv.worker.ts` — Web Worker handling `parse` and `generate` message types, with progress reporting
- [x] 9.2 Implement CSV import flow: file picker (accept .csv, max 10MB) → Web Worker parse → column mapping preview dialog → confirm → insert into Grid_Store → toast with count
- [x] 9.3 Implement CSV import validation: skip rows with missing required fields or invalid types, report skipped rows with reasons in summary toast
- [x] 9.4 Implement CSV export flow: generate CSV from grid data (all, filtered, or selected) → Web Worker for 10k+ records → trigger browser download
- [x] 9.5 Implement column mapping preview UI: shows source CSV columns mapped to target ColumnDefinitions, allows user to adjust mappings before import

## Task 10: Enrichment Configuration Panel

- [x] 10.1 Create `src/components/enrichment/EnrichmentPanel.tsx` — slide-in side panel showing selected record count, available fields grouped by type, provider options per field, credit estimation, Run Enrichment button
- [x] 10.2 Create `src/components/enrichment/WaterfallConfig.tsx` — drag-and-drop provider ordering per enrichment field using HTML5 drag API or a lightweight DnD library
- [x] 10.3 Implement credit cost estimation: `selectedRows × Σ(creditCostPerCall)` with live display of current workspace credit balance
- [x] 10.4 Implement Run Enrichment submission: POST enrichment job → close panel → toast with job ID → mark affected cells as "pending" in Grid_Store → add job to Job_Store polling
- [x] 10.5 Implement budget guard: disable Run button and show warning with link to billing settings when estimated cost > credit balance

## Task 11: Job Monitoring

- [x] 11.1 Create `src/components/jobs/JobMonitor.tsx` — summary card (total jobs, records enriched, credits consumed, success rate) + job list sorted by createdAt desc
- [x] 11.2 Create `src/components/jobs/JobRow.tsx` — expandable row: status badge, progress bar (completedRecords/totalRecords), estimated credits, timestamp; click to expand per-record details
- [x] 11.3 Create `src/components/jobs/JobRecordDetail.tsx` — per-record enrichment breakdown: status, provider used, credits consumed, error reason
- [x] 11.4 Create `src/hooks/useJobPolling.ts` — polls running jobs every 5s, stops polling on terminal state, triggers toast on state transition, updates Grid_Store cells with enrichment results
- [x] 11.5 Implement job cancellation: Cancel button on running jobs → POST cancel → update job status → stop polling

## Task 12: Settings Views

- [x] 12.1 Create `src/components/settings/SettingsLayout.tsx` — settings sub-navigation (Workspace, Members, Credentials, Billing) with nested `<Outlet />`
- [x] 12.2 Create `src/components/settings/WorkspaceSettings.tsx` — display workspace name, edit name (admin/owner), delete workspace with name-confirmation dialog (owner only)
- [x] 12.3 Create `src/components/settings/MemberSettings.tsx` — member list (name, email, role, join date), invite form (email + role), role change dropdown, remove button with confirmation; controls disabled for viewer/member roles
- [x] 12.4 Create `src/components/settings/CredentialSettings.tsx` — credential list (provider, masked key, date), add credential form (provider dropdown, key, secret), delete with confirmation; controls disabled for member/viewer roles; never display raw keys
- [x] 12.5 Create `src/components/settings/BillingSettings.tsx` — credit balance, plan type, auto-recharge config, add credits form (owner only), low balance warning banner (<10% of limit), paginated transaction history with infinite scroll

## Task 13: Property-Based Tests

- [x] 13.1 Create `tests/property/api-envelope.property.test.ts` — Property 9 (envelope parsing): generate random envelope objects, verify data extraction on success and error throwing on failure; Property 4 (token storage): verify tokens stored in memory, not localStorage
- [x] 13.2 Create `tests/property/csv-roundtrip.property.test.ts` — Property 23 (CSV round-trip): generate random record arrays, CSV generate → parse should produce equivalent records; Property 24 (validation partitioning): mix valid/invalid rows, verify counts
- [x] 13.3 Create `tests/property/grid-operations.property.test.ts` — Property 2 (workspace ID round-trip), Property 15 (cell edit updates store), Property 17 (column layout persistence), Property 19 (add row count), Property 20 (delete rows), Property 22 (undo LIFO with max 50)
- [x] 13.4 Create `tests/property/enrichment-cost.property.test.ts` — Property 26 (credit estimation arithmetic), Property 27 (run button disabled when over budget), Property 28 (enrichment results update cells)
- [x] 13.5 Create `tests/property/permissions.property.test.ts` — Property 35 (role-based UI permissions): for each role, verify correct set of allowed/denied actions against ROLE_PERMISSIONS map; Property 36 (credential masking)
- [x] 13.6 Create `tests/property/toast-behavior.property.test.ts` — Property 38 (auto-dismiss behavior): success → autoDismiss true, error → autoDismiss false; Property 10 (HTTP error toasts): 429/403/500 produce correct toast messages
- [x] 13.7 Create `tests/property/sort-filter.property.test.ts` — Property 13 (sort correctness): random arrays sorted by column should be in order; Property 14 (filter correctness): filtered rows should all match filter text

## Task 14: Unit and Integration Tests

- [x] 14.1 Write unit tests for `auth.store.ts`: login stores tokens, logout clears state, clearAuth resets all fields
- [x] 14.2 Write unit tests for `api/client.ts`: Bearer token attachment, 401 refresh+retry flow, refresh failure → logout, timeout configuration
- [x] 14.3 Write unit tests for `grid.store.ts`: addRow, deleteRows, updateCell, undo, saveChanges success/failure, column operations
- [x] 14.4 Write unit tests for `workspace.store.ts`: fetchWorkspaces, setActiveWorkspace persists to localStorage, workspace CRUD
- [x] 14.5 Write unit tests for `useAutoSave` hook: triggers at 30s when dirty, skips when clean, pauses when offline, shows toast on failure
- [x] 14.6 Write unit tests for `useJobPolling` hook: starts polling for running jobs, stops on terminal state, updates grid store with results
- [x] 14.7 Write component tests for `AuthGuard`: redirects when unauthenticated, shows workspace prompt when no workspaces, renders children when authenticated
- [x] 14.8 Write component tests for `ErrorBoundary`: catches child errors, renders fallback UI, logs to console
- [x] 14.9 Write component tests for `AppShell`: sidebar collapse at <768px, header renders workspace switcher and logout
