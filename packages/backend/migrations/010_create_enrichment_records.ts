import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE enrichment_record_status AS ENUM (
      'success', 'failed', 'skipped'
    );

    CREATE TABLE enrichment_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      input_data JSONB NOT NULL,
      output_data JSONB,
      provider_slug VARCHAR(100) NOT NULL,
      credits_consumed INTEGER NOT NULL DEFAULT 0,
      status enrichment_record_status NOT NULL,
      error_reason TEXT,
      idempotency_key VARCHAR(500) NOT NULL UNIQUE,
      credit_transaction_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_enrichment_records_job_created
      ON enrichment_records(job_id, created_at);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS enrichment_records CASCADE;
    DROP TYPE IF EXISTS enrichment_record_status;
  `);
}
