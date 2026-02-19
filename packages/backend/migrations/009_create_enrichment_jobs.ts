import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE enrichment_job_status AS ENUM (
      'pending', 'running', 'completed', 'failed', 'partially_completed', 'cancelled'
    );

    CREATE TABLE enrichment_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status enrichment_job_status NOT NULL DEFAULT 'pending',
      requested_fields JSONB NOT NULL,
      waterfall_config JSONB,
      total_records INTEGER NOT NULL,
      completed_records INTEGER NOT NULL DEFAULT 0,
      failed_records INTEGER NOT NULL DEFAULT 0,
      estimated_credits INTEGER NOT NULL,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX idx_enrichment_jobs_workspace_created
      ON enrichment_jobs(workspace_id, created_at DESC);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS enrichment_jobs CASCADE;
    DROP TYPE IF EXISTS enrichment_job_status;
  `);
}
