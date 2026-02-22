import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
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

    CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);

    CREATE TABLE integration_field_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      integration_slug VARCHAR(50) NOT NULL,
      morket_field VARCHAR(100) NOT NULL,
      crm_field VARCHAR(100) NOT NULL,
      direction VARCHAR(10) NOT NULL DEFAULT 'both' CHECK (direction IN ('push', 'pull', 'both')),
      UNIQUE(workspace_id, integration_slug, morket_field)
    );

    CREATE INDEX idx_field_mappings_workspace ON integration_field_mappings(workspace_id, integration_slug);

    CREATE TABLE sync_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      integration_slug VARCHAR(50) NOT NULL,
      direction VARCHAR(10) NOT NULL CHECK (direction IN ('push', 'pull')),
      record_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX idx_sync_history_workspace ON sync_history(workspace_id, integration_slug);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS sync_history CASCADE;
    DROP TABLE IF EXISTS integration_field_mappings CASCADE;
    DROP TABLE IF EXISTS integrations CASCADE;
  `);
}
