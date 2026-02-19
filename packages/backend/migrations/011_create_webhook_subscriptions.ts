import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE webhook_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      callback_url VARCHAR(2048) NOT NULL,
      event_types JSONB NOT NULL,
      secret_key VARCHAR(256) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_webhook_subscriptions_workspace
      ON webhook_subscriptions(workspace_id);
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS webhook_subscriptions CASCADE;
  `);
}
