import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE plan_type AS ENUM ('free', 'pro', 'enterprise');

    CREATE TABLE workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_type plan_type NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS workspaces CASCADE;
    DROP TYPE IF EXISTS plan_type;
  `);
}
