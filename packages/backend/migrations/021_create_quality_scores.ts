import { type Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE quality_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      record_id UUID NOT NULL,
      confidence_score INTEGER NOT NULL DEFAULT 0,
      freshness_days INTEGER NOT NULL DEFAULT 0,
      field_scores JSONB NOT NULL DEFAULT '{}',
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, record_id)
    );
  `);

  await client.query(`CREATE INDEX idx_quality_scores_workspace ON quality_scores(workspace_id);`);
  await client.query(`CREATE INDEX idx_quality_scores_record ON quality_scores(record_id);`);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS quality_scores;`);
}
