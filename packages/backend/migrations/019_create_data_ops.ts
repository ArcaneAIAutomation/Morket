import { type Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE saved_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by UUID NOT NULL REFERENCES users(id),
      name VARCHAR(100) NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}',
      sort_config JSONB NOT NULL DEFAULT '{}',
      column_visibility JSONB NOT NULL DEFAULT '{}',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    );
  `);

  await client.query(`
    CREATE TABLE record_activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_id UUID NOT NULL,
      action VARCHAR(50) NOT NULL,
      provider_slug VARCHAR(50),
      fields_changed JSONB,
      performed_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_saved_views_workspace ON saved_views(workspace_id);`);
  await client.query(`CREATE INDEX idx_record_activity_log_record ON record_activity_log(record_id);`);
  await client.query(`CREATE INDEX idx_record_activity_log_workspace ON record_activity_log(workspace_id);`);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS record_activity_log;`);
  await client.query(`DROP TABLE IF EXISTS saved_views;`);
}
