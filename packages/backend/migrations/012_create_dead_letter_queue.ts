import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel VARCHAR(50) NOT NULL,
      event_payload JSONB NOT NULL,
      error_reason TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 5,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_dlq_status_next_retry
      ON dead_letter_queue(status, next_retry_at)
      WHERE status = 'pending';
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS dead_letter_queue CASCADE;
  `);
}
