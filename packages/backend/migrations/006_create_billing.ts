import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE billing (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      plan_type plan_type NOT NULL DEFAULT 'free',
      credit_balance INTEGER NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
      credit_limit INTEGER NOT NULL DEFAULT 0,
      billing_cycle_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      billing_cycle_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
      auto_recharge BOOLEAN NOT NULL DEFAULT false,
      auto_recharge_threshold INTEGER NOT NULL DEFAULT 0,
      auto_recharge_amount INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS billing CASCADE;`);
}
