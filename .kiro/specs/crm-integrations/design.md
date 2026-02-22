# Design Document — Module 8.3: CRM Integrations

## Overview

Adds a pluggable CRM integration layer with Salesforce and HubSpot as the first two adapters. Uses OAuth2 for authentication, encrypted token storage, configurable field mappings, and batch push/pull sync operations. Follows the same adapter registry pattern used by enrichment providers.

### Key Design Decisions

1. **Adapter registry pattern**: Same approach as enrichment providers — each CRM is a module implementing `CrmAdapter` interface, registered in an in-memory Map. Adding a new CRM requires only creating an adapter file and registering it.

2. **Encrypted token storage**: OAuth2 tokens stored encrypted using the existing AES-256-GCM per-workspace encryption (same as API credentials). Tokens are never exposed in API responses.

3. **Batch sync, not real-time**: Push/pull operations are manual, batch-based (up to 200 records). Real-time webhook-based sync is a future enhancement. This keeps the initial implementation simple and predictable.

4. **Field mappings per workspace**: Each workspace can customize which Morket fields map to which CRM fields. Default mappings provided per integration.

## Architecture

```
src/modules/integration/
├── integration.routes.ts         # Route factory
├── integration.controller.ts     # HTTP handlers
├── integration.service.ts        # Business logic (OAuth, sync orchestration)
├── integration.schemas.ts        # Zod validation
├── integration.repository.ts     # DB: integrations, field_mappings, sync_history
├── integration-registry.ts       # In-memory adapter registry
├── adapters/
│   ├── types.ts                  # CrmAdapter interface
│   ├── salesforce.adapter.ts     # Salesforce OAuth2 + CRUD
│   └── hubspot.adapter.ts        # HubSpot OAuth2 + CRUD
```

## CrmAdapter Interface

```typescript
interface CrmAdapter {
  slug: string;
  name: string;
  getAuthUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refreshToken(refreshToken: string): Promise<OAuthTokens>;
  pushRecords(tokens: OAuthTokens, records: CrmRecord[], fieldMappings: FieldMapping[]): Promise<SyncResult>;
  pullRecords(tokens: OAuthTokens, entity: string, fieldMappings: FieldMapping[], limit: number): Promise<CrmRecord[]>;
}
```

## Database (Migration 018)

```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_slug VARCHAR(50) NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  token_iv VARCHAR(32) NOT NULL,
  token_tag VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, integration_slug)
);

CREATE TABLE integration_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_slug VARCHAR(50) NOT NULL,
  morket_field VARCHAR(100) NOT NULL,
  crm_field VARCHAR(100) NOT NULL,
  direction VARCHAR(10) NOT NULL DEFAULT 'both',
  UNIQUE(workspace_id, integration_slug, morket_field)
);

CREATE TABLE sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_slug VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

## Environment Variables (New)

```
SALESFORCE_CLIENT_ID=...
SALESFORCE_CLIENT_SECRET=...
HUBSPOT_CLIENT_ID=...
HUBSPOT_CLIENT_SECRET=...
INTEGRATION_OAUTH_REDIRECT_BASE=https://app.morket.io/api/v1/integrations/callback
```
