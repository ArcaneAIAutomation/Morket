import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE transaction_type AS ENUM ('purchase', 'usage', 'refund', 'bonus');

    CREATE TABLE credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      transaction_type transaction_type NOT NULL,
      description TEXT NOT NULL,
      reference_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS credit_transactions CASCADE;
    DROP TYPE IF EXISTS transaction_type;
  `);
}
