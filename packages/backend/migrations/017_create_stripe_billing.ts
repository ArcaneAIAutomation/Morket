import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  // Add 'starter' to plan_type enum
  await client.query(`ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'starter'`);

  // Add Stripe columns to billing table
  await client.query(`
    ALTER TABLE billing
      ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_billing_stripe_customer ON billing(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_billing_stripe_subscription ON billing(stripe_subscription_id);
  `);

  // Add 'adjustment' to transaction_type enum
  await client.query(`ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'adjustment'`);

  // Stripe event idempotency table
  await client.query(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id VARCHAR(255) PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS stripe_events`);

  await client.query(`
    ALTER TABLE billing
      DROP COLUMN IF EXISTS stripe_customer_id,
      DROP COLUMN IF EXISTS stripe_subscription_id,
      DROP COLUMN IF EXISTS subscription_status,
      DROP COLUMN IF EXISTS trial_ends_at,
      DROP COLUMN IF EXISTS current_period_start,
      DROP COLUMN IF EXISTS current_period_end;
  `);

  // Note: PostgreSQL does not support removing enum values.
  // 'starter' and 'adjustment' values remain in their enums after rollback.
}
