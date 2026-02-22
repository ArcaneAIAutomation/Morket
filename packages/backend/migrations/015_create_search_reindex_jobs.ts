import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE search_reindex_jobs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      total_documents   INTEGER NOT NULL DEFAULT 0,
      indexed_documents INTEGER NOT NULL DEFAULT 0,
      failed_documents  INTEGER NOT NULL DEFAULT 0,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      error_reason      TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_search_reindex_jobs_workspace_created
      ON search_reindex_jobs (workspace_id, created_at DESC);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS search_reindex_jobs CASCADE;
  `);
}
