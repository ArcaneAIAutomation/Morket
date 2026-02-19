import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE INDEX IF NOT EXISTS workspaces_owner_id_idx ON workspaces (owner_id);
    CREATE INDEX IF NOT EXISTS wm_user_id_idx ON workspace_memberships (user_id);
    CREATE INDEX IF NOT EXISTS wm_workspace_id_idx ON workspace_memberships (workspace_id);
    CREATE INDEX IF NOT EXISTS rt_token_hash_idx ON refresh_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS rt_user_id_idx ON refresh_tokens (user_id);
    CREATE INDEX IF NOT EXISTS ac_workspace_id_idx ON api_credentials (workspace_id);
    CREATE INDEX IF NOT EXISTS ct_workspace_created_idx ON credit_transactions (workspace_id, created_at DESC);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP INDEX IF EXISTS workspaces_owner_id_idx;
    DROP INDEX IF EXISTS wm_user_id_idx;
    DROP INDEX IF EXISTS wm_workspace_id_idx;
    DROP INDEX IF EXISTS rt_token_hash_idx;
    DROP INDEX IF EXISTS rt_user_id_idx;
    DROP INDEX IF EXISTS ac_workspace_id_idx;
    DROP INDEX IF EXISTS ct_workspace_created_idx;
  `);
}
