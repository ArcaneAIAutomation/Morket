import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');

    CREATE TABLE workspace_memberships (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      role workspace_role NOT NULL DEFAULT 'member',
      invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      UNIQUE (user_id, workspace_id)
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS workspace_memberships CASCADE;
    DROP TYPE IF EXISTS workspace_role;
  `);
}
