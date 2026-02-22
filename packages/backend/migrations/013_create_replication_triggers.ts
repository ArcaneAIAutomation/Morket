import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  // Enrichment records trigger function
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_enrichment_event() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('enrichment_events', json_build_object(
        'record_id', NEW.id,
        'op', TG_OP
      )::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Enrichment records trigger (drop first for idempotency, then create)
  await client.query(`
    DROP TRIGGER IF EXISTS trg_enrichment_record_notify ON enrichment_records;
  `);

  await client.query(`
    CREATE TRIGGER trg_enrichment_record_notify
      AFTER INSERT OR UPDATE ON enrichment_records
      FOR EACH ROW EXECUTE FUNCTION notify_enrichment_event();
  `);

  // Credit transactions trigger function
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_credit_event() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('credit_events', json_build_object(
        'transaction_id', NEW.id,
        'op', TG_OP
      )::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Credit transactions trigger (drop first for idempotency, then create)
  await client.query(`
    DROP TRIGGER IF EXISTS trg_credit_transaction_notify ON credit_transactions;
  `);

  await client.query(`
    CREATE TRIGGER trg_credit_transaction_notify
      AFTER INSERT ON credit_transactions
      FOR EACH ROW EXECUTE FUNCTION notify_credit_event();
  `);

  // Scrape events callable function (invoked by webhook handler)
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_scrape_event(p_task_id UUID, p_job_id UUID) RETURNS void AS $$
    BEGIN
      PERFORM pg_notify('scrape_events', json_build_object(
        'task_id', p_task_id,
        'job_id', p_job_id
      )::text);
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(client: Client): Promise<void> {
  // Drop triggers first, then functions (reverse order)
  await client.query(`
    DROP TRIGGER IF EXISTS trg_enrichment_record_notify ON enrichment_records;
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS trg_credit_transaction_notify ON credit_transactions;
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_enrichment_event();
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_credit_event();
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_scrape_event(UUID, UUID);
  `);
}
