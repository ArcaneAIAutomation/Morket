---
inclusion: fileMatch
fileMatchPattern: "packages/frontend/**"
---

# Frontend Conventions

These conventions apply when working on any file under `packages/frontend/`.

## Tech Stack
- React 18+ with TypeScript (strict mode)
- Vite 6 for build tooling with `@vitejs/plugin-react`
- Zustand 5 for state management (lightweight, no boilerplate)
- AG Grid (ag-grid-react v32) for spreadsheet/data grid
- Recharts 3 for analytics charts
- React Router DOM v6 for routing
- Axios for HTTP client with interceptors
- Zod for client-side form validation
- Tailwind CSS 3 for styling
- Vitest + Testing Library + MSW for testing
- fast-check for property-based tests

## Architecture

### Directory Structure
```
src/
├── api/           # HTTP client + per-domain API modules
├── components/    # UI components organized by feature
│   ├── analytics/ # Dashboard with enrichment/scraping/credits tabs
│   ├── auth/      # Login + Register forms
│   ├── enrichment/# Enrichment panel + waterfall config
│   ├── jobs/      # Job monitor, row detail, record expansion
│   ├── layout/    # AppShell, AuthGuard, Header, Sidebar
│   ├── search/    # Search bar, results, facets, pagination
│   ├── settings/  # Workspace, billing, credentials, members settings
│   ├── shared/    # ErrorBoundary, Toast, ConfirmDialog, LoadingSpinner, OfflineBanner
│   └── spreadsheet/ # SpreadsheetView, GridToolbar, ContextMenu, CellRenderer, ColumnDialog, CSVImportDialog, StatusBar
├── hooks/         # Custom React hooks
├── stores/        # Zustand stores (one per domain)
├── types/         # TypeScript interfaces (api, grid, enrichment, search, analytics)
├── utils/         # Formatters, permissions, sanitize, validateParams
└── workers/       # Web Workers (CSV parse/generate)
```

### Key Patterns

#### API Client (`src/api/client.ts`)
- Two Axios instances: `apiClient` (30s timeout) and `enrichmentClient` (120s timeout for long-running jobs)
- Request interceptor: attaches `Authorization: Bearer <token>` header
- Response interceptor: unwraps `{ success, data, error, meta }` envelope, returns `data` directly
- 401 handling: automatic token refresh via `/api/v1/auth/refresh`, retry original request once, redirect to `/login` on failure
- 429/403/500: fires toast notifications via UI store
- Store connection: `connectAuthStore()` and `connectUIStore()` avoid circular dependency between api/client and stores
- Vite dev server proxies `/api/v1` to `http://localhost:3000`

#### Zustand Stores (`src/stores/`)
- `auth.store.ts` — user, tokens, login/register/logout, connects to API client for token management
- `grid.store.ts` — rows, columns, selection, pending changes, undo stack (max 50), sort/filter model, enrichment status per cell
- `workspace.store.ts` — workspace list, active workspace (persisted to localStorage), members CRUD
- `job.store.ts` — enrichment jobs, polling (5s interval), summary stats, terminal status detection
- `analytics.store.ts` — enrichment/scraping/credits data with time range filters, parallel data fetching
- `search.store.ts` — query, filters, sort, pagination, facets, suggestions, search execution
- `ui.store.ts` — toasts (max 5, auto-dismiss 5s for non-errors), offline status, sidebar collapse (persisted to localStorage)

#### Routing (`src/App.tsx`)
- Public routes: `/login`, `/register`
- Protected routes wrapped in `<AuthGuard>`: `/workspaces/:workspaceId/*`
- Workspace sub-routes: `spreadsheet` (default), `jobs`, `analytics`, `search`, `settings/*`
- Settings nested routes: `workspace` (default), `members`, `credentials`, `billing`, `options`
- Lazy-loaded: AnalyticsDashboard, SearchResultsView, JobMonitorView, all settings pages (via `React.lazy` + `Suspense`)
- Shared `LoadingFallback` component for all Suspense boundaries
- Last active workspace persisted to localStorage for redirect
- Sidebar includes nav items: spreadsheet, jobs, analytics, search, settings

#### Spreadsheet (`src/components/spreadsheet/`)
- AG Grid with `ag-theme-alpine` custom overrides
- Column definitions mapped from `ColumnDefinition[]` → AG Grid `ColDef[]`
- Cell editing triggers `updateCell()` → pending changes + undo stack
- Column resize, reorder, sort, filter all synced to grid store
- Context menu: right-click for row actions (enrich, delete, export) or column actions (rename, type, hide, delete)
- Keyboard shortcuts: Ctrl/Cmd+Z for undo
- Filter changes debounced at 300ms
- Multi-row selection with checkbox column
- EnrichmentPanel slide-over integrated into SpreadsheetView, triggered by "Enrich Selected" button in GridToolbar
- useAutoSave hook wired into SpreadsheetView for 30s auto-save of dirty changes

#### CSV Import/Export
- Web Worker (`src/workers/csv.worker.ts`) for off-main-thread CSV parse and generate
- Worker used for datasets ≥10,000 rows; inline generation for smaller datasets
- CSV parser handles quoted fields, escaped quotes, newlines within fields
- Progress reporting from worker to UI
- Export: all rows or selected rows, visible columns only

#### Auto-Save (`src/hooks/useAutoSave.ts`)
- 30-second interval auto-save of dirty grid changes
- Skips if offline or already saving
- Silent failure with toast notification

#### Job Polling (`src/hooks/useJobPolling.ts`)
- Polls running/pending enrichment jobs every 5 seconds
- Detects terminal status transitions → fires toast + fetches job records → updates grid cells with enrichment results
- Stops polling on unmount

#### Permissions (`src/utils/permissions.ts`)
- Role-based permission map: viewer < member < admin < owner
- `useRole()` hook returns `{ role, can(action) }`
- Actions: view_records, export_csv, edit_records, add_records, delete_records, import_csv, run_enrichment, manage_columns, manage_credentials, manage_members, edit_workspace, delete_workspace, manage_billing
- Toolbar buttons conditionally rendered based on `can()` checks

#### Search (`src/components/search/`)
- SearchBar with debounced typeahead suggestions (200ms, min 2 chars)
- Faceted sidebar with toggleable filter buckets
- Sort by relevance, created_at, updated_at, name
- Pagination with page size control
- Result cards with highlighted matches

#### Analytics (`src/components/analytics/`)
- Three tabs: Enrichment, Scraping, Credits
- Time range filter: 24h, 7d, 30d, 90d presets + custom range
- Recharts bar/line/pie charts
- Summary cards with key metrics
- Parallel data fetching per tab

#### Offline Support
- `useOnlineStatus()` hook listens to browser online/offline events
- `OfflineBanner` component shows warning when offline
- Auto-save skips when offline

#### Security
- `sanitize.ts` — `sanitizeHtml()` escapes HTML entities in rendered content (cell values, search results, workspace names, enrichment data)
- `validateParams.ts` — `isValidUUID()`, `isValidSlug()`, `validateRouteParams()` for deep link parameter validation
- `ValidatedWorkspaceRoute` component wraps workspace routes with parameter validation, redirects to 404 on invalid params
- `Referrer-Policy: strict-origin-when-cross-origin` header set on all Axios requests
- Auth tokens stored in Zustand memory only (not localStorage/sessionStorage/cookies)
- Token refresh failure clears all auth state and redirects to `/login`
- Unauthorized role UI elements removed from DOM (not just CSS hidden)

## Testing

### Unit Tests
- Co-located as `<file>.test.ts` or `<file>.test.tsx`
- Use `@testing-library/react` for component tests
- Use `msw` (Mock Service Worker) for API mocking
- Test setup in `tests/setup.ts`

### Property-Based Tests
- Located in `tests/property/`
- Use `fast-check` for property generation
- 12 property test suites:
  - `api-envelope.property.test.ts` — envelope unwrapping invariants
  - `csv-roundtrip.property.test.ts` — CSV parse → generate roundtrip
  - `enrichment-cost.property.test.ts` — credit cost calculation
  - `grid-operations.property.test.ts` — grid state invariants (add/delete/undo)
  - `permissions.property.test.ts` — role hierarchy and permission checks
  - `sort-filter.property.test.ts` — sort/filter model consistency
  - `toast-behavior.property.test.ts` — toast queue max size and auto-dismiss
  - `security.property.test.ts` — HTML sanitization encoding, deep link parameter validation (2 property suites)
  - `error-extraction.property.test.ts` — error message extraction from various response shapes
  - `billing-resilience.property.test.ts` — billing section resilience to malformed/missing data
  - `billing-independence.property.test.ts` — billing section independence (one section failure doesn't affect others)
  - `options-validation.property.test.ts` — options form Zod validation correctness

## Shared Components (`src/components/shared/`)
- `ErrorBoundary` — catches React render errors, shows fallback UI
- `Toast` / `ToastContainer` — notification system (success/error/warning/info)
- `ConfirmDialog` — modal confirmation for destructive actions
- `LoadingSpinner` — consistent loading indicator
- `OfflineBanner` — offline status warning bar

## Settings Pages (`src/components/settings/`)
- `SettingsLayout` — tabbed settings container
- `WorkspaceSettings` — name, slug, danger zone (delete)
- `BillingSettings` — credit balance, plan info, transaction history (independent per-section loading/error states)
- `CredentialSettings` — API credential management (masked keys)
- `MemberSettings` — member list with loading/error/empty states, invite, role management
- `OptionsSettings` — service configuration page with 5 collapsible groups, status indicators, Zod validation, test connection UI
