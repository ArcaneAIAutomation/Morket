import { type Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE service_configurations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      service_key VARCHAR(50) NOT NULL,
      service_group VARCHAR(50) NOT NULL,
      encrypted_values TEXT NOT NULL,
      iv VARCHAR(24) NOT NULL,
      auth_tag VARCHAR(24) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'configured',
      last_tested_at TIMESTAMPTZ,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, service_key)
    );
  `);

  await client.query(`CREATE INDEX idx_service_configurations_workspace ON service_configurations(workspace_id);`);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS service_configurations;`);
}
