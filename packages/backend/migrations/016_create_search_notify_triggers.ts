import { Client } from 'pg';

export async function up(client: Client): Promise<void> {
  // Enrichment records → search_index_enrichment channel
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_search_index_enrichment() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('search_index_enrichment', json_build_object(
          'record_id', OLD.id,
          'workspace_id', OLD.workspace_id,
          'op', 'DELETE'
        )::text);
        RETURN OLD;
      ELSE
        PERFORM pg_notify('search_index_enrichment', json_build_object(
          'record_id', NEW.id,
          'workspace_id', NEW.workspace_id,
          'op', TG_OP
        )::text);
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS trg_search_index_enrichment ON enrichment_records;
  `);

  await client.query(`
    CREATE TRIGGER trg_search_index_enrichment
      AFTER INSERT OR UPDATE OR DELETE ON enrichment_records
      FOR EACH ROW EXECUTE FUNCTION notify_search_index_enrichment();
  `);

  // Contact/company records → search_index_records channel
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_search_index_records() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('search_index_records', json_build_object(
          'record_id', OLD.id,
          'workspace_id', OLD.workspace_id,
          'op', 'DELETE'
        )::text);
        RETURN OLD;
      ELSE
        PERFORM pg_notify('search_index_records', json_build_object(
          'record_id', NEW.id,
          'workspace_id', NEW.workspace_id,
          'op', TG_OP
        )::text);
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS trg_search_index_records ON records;
  `);

  await client.query(`
    CREATE TRIGGER trg_search_index_records
      AFTER INSERT OR UPDATE OR DELETE ON records
      FOR EACH ROW EXECUTE FUNCTION notify_search_index_records();
  `);

  // Scrape results → search_index_scrape channel (callable function)
  await client.query(`
    CREATE OR REPLACE FUNCTION notify_search_index_scrape(
      p_task_id UUID, p_workspace_id UUID, p_job_id UUID
    ) RETURNS void AS $$
    BEGIN
      PERFORM pg_notify('search_index_scrape', json_build_object(
        'task_id', p_task_id,
        'workspace_id', p_workspace_id,
        'job_id', p_job_id,
        'op', 'INSERT'
      )::text);
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(client: Client): Promise<void> {
  // Drop triggers first, then functions (reverse order)
  await client.query(`
    DROP TRIGGER IF EXISTS trg_search_index_enrichment ON enrichment_records;
  `);

  await client.query(`
    DROP TRIGGER IF EXISTS trg_search_index_records ON records;
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_search_index_enrichment();
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_search_index_records();
  `);

  await client.query(`
    DROP FUNCTION IF EXISTS notify_search_index_scrape(UUID, UUID, UUID);
  `);
}
