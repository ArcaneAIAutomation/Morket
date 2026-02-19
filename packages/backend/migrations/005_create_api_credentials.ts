import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE api_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider_name VARCHAR(255) NOT NULL,
      encrypted_key TEXT NOT NULL,
      encrypted_secret TEXT NOT NULL,
      iv VARCHAR(255) NOT NULL,
      auth_tag VARCHAR(255) NOT NULL,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS api_credentials CASCADE;`);
}
