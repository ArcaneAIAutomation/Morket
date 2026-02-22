import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE search_index_status (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      last_indexed_at TIMESTAMPTZ,
      document_count  INTEGER NOT NULL DEFAULT 0,
      index_version   INTEGER NOT NULL DEFAULT 1,
      status          VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'reindexing', 'error')),
      error_reason    TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_search_index_status_workspace UNIQUE (workspace_id)
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS search_index_status CASCADE;
  `);
}
