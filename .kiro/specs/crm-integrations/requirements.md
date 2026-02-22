# Module 8.3 — CRM Integrations (Salesforce & HubSpot)

## Requirements

### 1. Integration Registry
- 1.1 Pluggable integration registry pattern — adding a new CRM = registering an adapter module
- 1.2 Each integration defines: slug, name, auth type (OAuth2), supported entities, field mappings
- 1.3 Integration registry stored in-memory as a Map keyed by slug

### 2. OAuth2 Flow
- 2.1 OAuth2 authorization URL generation per integration (redirect to CRM consent screen)
- 2.2 OAuth2 callback handler: exchange code for access/refresh tokens
- 2.3 Encrypted token storage per workspace using existing AES-256-GCM encryption
- 2.4 Automatic token refresh when access token expires
- 2.5 Revoke/disconnect integration (delete stored tokens)

### 3. Salesforce Integration
- 3.1 OAuth2 with Salesforce Connected App (authorization_code grant)
- 3.2 Sync entities: Contact, Lead, Account
- 3.3 Push enriched records to Salesforce (create or update via upsert on email)
- 3.4 Pull contacts/leads from Salesforce into workspace enrichment records
- 3.5 Field mapping: configurable per workspace (which Morket fields map to which Salesforce fields)
- 3.6 Conflict resolution: last-write-wins (configurable)

### 4. HubSpot Integration
- 4.1 OAuth2 with HubSpot App (authorization_code grant)
- 4.2 Sync entities: Contact, Company, Deal
- 4.3 Push enriched records to HubSpot (create or update via email lookup)
- 4.4 Pull contacts/companies from HubSpot into workspace enrichment records
- 4.5 Field mapping: configurable per workspace
- 4.6 Conflict resolution: last-write-wins (configurable)

### 5. Sync Operations
- 5.1 Manual push: user selects records and pushes to connected CRM
- 5.2 Manual pull: user triggers import from CRM into workspace
- 5.3 Batch operations: push/pull up to 200 records per batch
- 5.4 Sync status tracking per record (synced, pending, failed, conflict)
- 5.5 Sync history log with timestamps and record counts

### 6. Database
- 6.1 integrations table: workspace_id, integration_slug, encrypted tokens, status, connected_at
- 6.2 integration_field_mappings table: workspace_id, integration_slug, morket_field, crm_field, direction
- 6.3 sync_history table: workspace_id, integration_slug, direction, record_count, status, started_at, completed_at

### 7. API Endpoints
- 7.1 GET /api/v1/integrations — list available integrations (public)
- 7.2 POST /api/v1/workspaces/:id/integrations/:slug/connect — start OAuth2 flow
- 7.3 GET /api/v1/integrations/callback/:slug — OAuth2 callback
- 7.4 DELETE /api/v1/workspaces/:id/integrations/:slug — disconnect
- 7.5 GET /api/v1/workspaces/:id/integrations — list connected integrations
- 7.6 PUT /api/v1/workspaces/:id/integrations/:slug/field-mappings — update field mappings
- 7.7 POST /api/v1/workspaces/:id/integrations/:slug/push — push records to CRM
- 7.8 POST /api/v1/workspaces/:id/integrations/:slug/pull — pull records from CRM
- 7.9 GET /api/v1/workspaces/:id/integrations/:slug/sync-history — sync history

### 8. Security
- 8.1 OAuth2 tokens encrypted at rest using workspace encryption key
- 8.2 OAuth2 state parameter validated to prevent CSRF
- 8.3 Only workspace admins+ can connect/disconnect integrations
- 8.4 Members+ can push/pull records and view sync history
