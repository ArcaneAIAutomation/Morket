# Tasks — Module 8.3: CRM Integrations (Salesforce & HubSpot)

## 1. Database & Config
- [x] Migration 018: integrations, integration_field_mappings, sync_history tables
- [x] Add CRM OAuth env vars to env.ts and .env.example

## 2. Adapter Layer
- [x] CrmAdapter interface + shared types (adapters/types.ts)
- [x] Salesforce adapter: OAuth2 flow, push/pull via REST API
- [x] HubSpot adapter: OAuth2 flow, push/pull via CRM v3 API
- [x] Integration registry (in-memory Map with both adapters)

## 3. Repository
- [x] Integration CRUD (upsert, find, list, delete)
- [x] Field mapping CRUD (get, replace)
- [x] Sync history (create entry, complete entry, get history)

## 4. Service
- [x] listAvailableIntegrations, listConnected
- [x] startOAuthFlow — generate state, build auth URL
- [x] handleOAuthCallback — exchange code, encrypt tokens, store, seed default mappings
- [x] disconnect — delete integration record
- [x] getFieldMappings, updateFieldMappings
- [x] pushRecords — decrypt tokens, refresh if expired, call adapter, log sync history
- [x] pullRecords — decrypt tokens, refresh if expired, call adapter, log sync history
- [x] getSyncHistory
- [x] Token refresh logic (check expiry, refresh before push/pull)
- [x] In-memory OAuth state store with TTL cleanup

## 5. Controller & Routes
- [x] Controller factory with all HTTP handlers
- [x] Route factory returning publicRoutes + workspaceRoutes
- [x] Zod validation on all endpoints
- [x] RBAC: owner for connect/disconnect/field-mappings write, member for read/push/pull

## 6. App Wiring
- [x] Mount public integration routes (list available, OAuth callback)
- [x] Mount workspace-scoped integration routes (authenticated)

## 7. Validation
- [x] Zero TypeScript diagnostics across all integration files
