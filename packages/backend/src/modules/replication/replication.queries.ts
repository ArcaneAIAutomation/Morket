import { getPool } from '../../shared/db';

/**
 * Denormalized event row types returned from PostgreSQL fetch queries.
 * These map to the ClickHouse table schemas for batch insertion.
 */

export interface EnrichmentEventRow {
  event_id: string;
  workspace_id: string;
  job_id: string;
  record_id: string;
  provider_slug: string;
  enrichment_field: string;
  status: string;
  credits_consumed: number;
  duration_ms: number;
  error_category: string | null;
  created_at: string;
  job_created_at: string;
}

export interface CreditEventRow {
  event_id: string;
  workspace_id: string;
  transaction_type: string;
  amount: number;
  source: string;
  reference_id: string | null;
  provider_slug: string | null;
  created_at: string;
}

export interface ScrapeEventRow {
  event_id: string;
  workspace_id: string;
  job_id: string;
  task_id: string;
  target_domain: string;
  target_type: string;
  status: string;
  duration_ms: number;
  proxy_used: string | null;
  error_category: string | null;
  created_at: string;
  job_created_at: string;
}

/**
 * Fetches denormalized enrichment event data from PostgreSQL by record IDs.
 * JOINs enrichment_records with enrichment_jobs to get job metadata.
 */
export async function fetchEnrichmentEvents(recordIds: string[]): Promise<EnrichmentEventRow[]> {
  if (recordIds.length === 0) return [];

  const result = await getPool().query<EnrichmentEventRow>(
    `SELECT
      er.id AS event_id,
      er.workspace_id,
      er.job_id,
      er.id AS record_id,
      er.provider_slug,
      COALESCE(er.field_name, 'unknown') AS enrichment_field,
      er.status,
      COALESCE(er.credits_consumed, 0) AS credits_consumed,
      COALESCE(EXTRACT(EPOCH FROM (er.updated_at - er.created_at)) * 1000, 0)::integer AS duration_ms,
      er.error_reason AS error_category,
      er.created_at,
      ej.created_at AS job_created_at
    FROM enrichment_records er
    JOIN enrichment_jobs ej ON er.job_id = ej.id
    WHERE er.id = ANY($1)`,
    [recordIds],
  );

  return result.rows;
}

/**
 * Fetches denormalized credit event data from PostgreSQL by transaction IDs.
 */
export async function fetchCreditEvents(transactionIds: string[]): Promise<CreditEventRow[]> {
  if (transactionIds.length === 0) return [];

  const result = await getPool().query<CreditEventRow>(
    `SELECT
      ct.id AS event_id,
      ct.workspace_id,
      ct.transaction_type,
      ct.amount,
      COALESCE(ct.description, 'manual') AS source,
      ct.reference_id,
      NULL AS provider_slug,
      ct.created_at
    FROM credit_transactions ct
    WHERE ct.id = ANY($1)`,
    [transactionIds],
  );

  return result.rows;
}

/**
 * Fetches denormalized scrape event data from PostgreSQL by task IDs.
 * Note: scrape task tables may not exist yet — this query is structured
 * to match the expected ClickHouse scrape_events schema.
 */
export async function fetchScrapeEvents(taskIds: string[]): Promise<ScrapeEventRow[]> {
  if (taskIds.length === 0) return [];

  // Scrape tasks are stored by the scraper service and may be tracked
  // in a local table or fetched via the scraper API. For now, we query
  // a scrape_tasks table that will be created when the scraper integration is wired.
  const result = await getPool().query<ScrapeEventRow>(
    `SELECT
      st.id AS event_id,
      st.workspace_id,
      st.job_id,
      st.id AS task_id,
      COALESCE(st.target_domain, 'unknown') AS target_domain,
      COALESCE(st.target_type, 'unknown') AS target_type,
      st.status,
      COALESCE(EXTRACT(EPOCH FROM (st.updated_at - st.created_at)) * 1000, 0)::integer AS duration_ms,
      st.proxy_used,
      st.error_reason AS error_category,
      st.created_at,
      sj.created_at AS job_created_at
    FROM scrape_tasks st
    JOIN scrape_jobs sj ON st.job_id = sj.id
    WHERE st.id = ANY($1)`,
    [taskIds],
  );

  return result.rows;
}
