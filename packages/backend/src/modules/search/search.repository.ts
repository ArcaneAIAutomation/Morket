import { type PoolClient } from 'pg';

import { getPool, query } from '../../shared/db';

// ---------------------------------------------------------------------------
// Exported domain interfaces (camelCase)
// ---------------------------------------------------------------------------

export interface IndexStatus {
  id: string;
  workspaceId: string;
  lastIndexedAt: Date | null;
  documentCount: number;
  indexVersion: number;
  status: string;
  errorReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReindexJob {
  id: string;
  workspaceId: string;
  status: string;
  totalDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorReason: string | null;
  createdAt: Date;
}

export interface EnrichmentRecordDoc {
  id: string;
  workspaceId: string;
  jobId: string;
  inputData: Record<string, unknown>;
  outputData: Record<string, unknown> | null;
  providerSlug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactCompanyRecordDoc {
  id: string;
  workspaceId: string;
  name: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  location: string | null;
  phone: string | null;
  domain: string | null;
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScrapeResultDoc {
  id: string;
  workspaceId: string;
  jobId: string;
  targetUrl: string | null;
  targetType: string | null;
  targetDomain: string | null;
  resultData: Record<string, unknown> | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchResult<T> {
  records: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Private row interfaces (snake_case — match DB columns)
// ---------------------------------------------------------------------------

interface IndexStatusRow {
  id: string;
  workspace_id: string;
  last_indexed_at: Date | null;
  document_count: number;
  index_version: number;
  status: string;
  error_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ReindexJobRow {
  id: string;
  workspace_id: string;
  status: string;
  total_documents: number;
  indexed_documents: number;
  failed_documents: number;
  started_at: Date | null;
  completed_at: Date | null;
  error_reason: string | null;
  created_at: Date;
}

interface EnrichmentRecordRow {
  id: string;
  workspace_id: string;
  job_id: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown> | null;
  provider_slug: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface ContactCompanyRecordRow {
  id: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  location: string | null;
  phone: string | null;
  domain: string | null;
  tags: string[] | null;
  created_at: Date;
  updated_at: Date;
}

interface ScrapeResultRow {
  id: string;
  workspace_id: string;
  job_id: string;
  target_url: string | null;
  target_type: string | null;
  target_domain: string | null;
  result_data: Record<string, unknown> | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

function toIndexStatus(row: IndexStatusRow): IndexStatus {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    lastIndexedAt: row.last_indexed_at,
    documentCount: row.document_count,
    indexVersion: row.index_version,
    status: row.status,
    errorReason: row.error_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReindexJob(row: ReindexJobRow): ReindexJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    totalDocuments: row.total_documents,
    indexedDocuments: row.indexed_documents,
    failedDocuments: row.failed_documents,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorReason: row.error_reason,
    createdAt: row.created_at,
  };
}

function toEnrichmentRecordDoc(row: EnrichmentRecordRow): EnrichmentRecordDoc {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobId: row.job_id,
    inputData: row.input_data,
    outputData: row.output_data,
    providerSlug: row.provider_slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toContactCompanyRecordDoc(row: ContactCompanyRecordRow): ContactCompanyRecordDoc {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    email: row.email,
    company: row.company,
    jobTitle: row.job_title,
    location: row.location,
    phone: row.phone,
    domain: row.domain,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toScrapeResultDoc(row: ScrapeResultRow): ScrapeResultDoc {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobId: row.job_id,
    targetUrl: row.target_url,
    targetType: row.target_type,
    targetDomain: row.target_domain,
    resultData: row.result_data,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

const INDEX_STATUS_COLUMNS =
  'id, workspace_id, last_indexed_at, document_count, index_version, status, error_reason, created_at, updated_at';

const REINDEX_JOB_COLUMNS =
  'id, workspace_id, status, total_documents, indexed_documents, failed_documents, started_at, completed_at, error_reason, created_at';

const ENRICHMENT_RECORD_COLUMNS =
  'id, workspace_id, job_id, input_data, output_data, provider_slug, status, created_at, updated_at';

const CONTACT_COMPANY_COLUMNS =
  'id, workspace_id, name, email, company, job_title, location, phone, domain, tags, created_at, updated_at';

const SCRAPE_RESULT_COLUMNS =
  'id, workspace_id, job_id, target_url, target_type, target_domain, result_data, status, created_at, updated_at';

// ---------------------------------------------------------------------------
// Helper: execute query against pool or an explicit PoolClient (transaction)
// ---------------------------------------------------------------------------

function exec<T extends Record<string, unknown>>(
  text: string,
  params: unknown[],
  client?: PoolClient,
) {
  if (client) {
    return client.query<T>(text, params);
  }
  return query<T>(text, params);
}

// ---------------------------------------------------------------------------
// Index status queries
// ---------------------------------------------------------------------------

export async function upsertIndexStatus(
  workspaceId: string,
  data: {
    lastIndexedAt?: Date | null;
    documentCount?: number;
    indexVersion?: number;
    status?: string;
    errorReason?: string | null;
  },
  client?: PoolClient,
): Promise<IndexStatus> {
  const result = await exec<IndexStatusRow>(
    `INSERT INTO search_index_status (workspace_id, last_indexed_at, document_count, index_version, status, error_reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id) DO UPDATE SET
       last_indexed_at = COALESCE($2, search_index_status.last_indexed_at),
       document_count  = COALESCE($3, search_index_status.document_count),
       index_version   = COALESCE($4, search_index_status.index_version),
       status          = COALESCE($5, search_index_status.status),
       error_reason    = $6,
       updated_at      = NOW()
     RETURNING ${INDEX_STATUS_COLUMNS}`,
    [
      workspaceId,
      data.lastIndexedAt ?? null,
      data.documentCount ?? 0,
      data.indexVersion ?? 1,
      data.status ?? 'active',
      data.errorReason ?? null,
    ],
    client,
  );
  return toIndexStatus(result.rows[0]);
}

export async function getIndexStatus(
  workspaceId: string,
  client?: PoolClient,
): Promise<IndexStatus | null> {
  const result = await exec<IndexStatusRow>(
    `SELECT ${INDEX_STATUS_COLUMNS} FROM search_index_status WHERE workspace_id = $1`,
    [workspaceId],
    client,
  );
  return result.rows[0] ? toIndexStatus(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Reindex job queries
// ---------------------------------------------------------------------------

export async function createReindexJob(
  workspaceId: string,
  client?: PoolClient,
): Promise<ReindexJob> {
  const result = await exec<ReindexJobRow>(
    `INSERT INTO search_reindex_jobs (workspace_id)
     VALUES ($1)
     RETURNING ${REINDEX_JOB_COLUMNS}`,
    [workspaceId],
    client,
  );
  return toReindexJob(result.rows[0]);
}

export async function updateReindexProgress(
  jobId: string,
  data: {
    status?: string;
    totalDocuments?: number;
    indexedDocuments?: number;
    failedDocuments?: number;
    startedAt?: Date | null;
    completedAt?: Date | null;
    errorReason?: string | null;
  },
  client?: PoolClient,
): Promise<ReindexJob | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [jobId];
  let paramIndex = 2;

  if (data.status !== undefined) {
    setClauses.push(`status = $${paramIndex}`);
    params.push(data.status);
    paramIndex++;
  }

  if (data.totalDocuments !== undefined) {
    setClauses.push(`total_documents = $${paramIndex}`);
    params.push(data.totalDocuments);
    paramIndex++;
  }

  if (data.indexedDocuments !== undefined) {
    setClauses.push(`indexed_documents = $${paramIndex}`);
    params.push(data.indexedDocuments);
    paramIndex++;
  }

  if (data.failedDocuments !== undefined) {
    setClauses.push(`failed_documents = $${paramIndex}`);
    params.push(data.failedDocuments);
    paramIndex++;
  }

  if (data.startedAt !== undefined) {
    setClauses.push(`started_at = $${paramIndex}`);
    params.push(data.startedAt);
    paramIndex++;
  }

  if (data.completedAt !== undefined) {
    setClauses.push(`completed_at = $${paramIndex}`);
    params.push(data.completedAt);
    paramIndex++;
  }

  if (data.errorReason !== undefined) {
    setClauses.push(`error_reason = $${paramIndex}`);
    params.push(data.errorReason);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    return null;
  }

  const result = await exec<ReindexJobRow>(
    `UPDATE search_reindex_jobs SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${REINDEX_JOB_COLUMNS}`,
    params,
    client,
  );
  return result.rows[0] ? toReindexJob(result.rows[0]) : null;
}

export async function getLatestReindexJob(
  workspaceId: string,
  client?: PoolClient,
): Promise<ReindexJob | null> {
  const result = await exec<ReindexJobRow>(
    `SELECT ${REINDEX_JOB_COLUMNS} FROM search_reindex_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [workspaceId],
    client,
  );
  return result.rows[0] ? toReindexJob(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Full document fetch queries (for indexing pipeline — single record)
// ---------------------------------------------------------------------------

export async function fetchEnrichmentRecord(
  recordId: string,
  client?: PoolClient,
): Promise<EnrichmentRecordDoc | null> {
  const result = await exec<EnrichmentRecordRow>(
    `SELECT ${ENRICHMENT_RECORD_COLUMNS} FROM enrichment_records WHERE id = $1`,
    [recordId],
    client,
  );
  return result.rows[0] ? toEnrichmentRecordDoc(result.rows[0]) : null;
}

export async function fetchContactCompanyRecord(
  recordId: string,
  client?: PoolClient,
): Promise<ContactCompanyRecordDoc | null> {
  const result = await exec<ContactCompanyRecordRow>(
    `SELECT ${CONTACT_COMPANY_COLUMNS} FROM records WHERE id = $1`,
    [recordId],
    client,
  );
  return result.rows[0] ? toContactCompanyRecordDoc(result.rows[0]) : null;
}

export async function fetchScrapeResult(
  taskId: string,
  workspaceId: string,
  client?: PoolClient,
): Promise<ScrapeResultDoc | null> {
  const result = await exec<ScrapeResultRow>(
    `SELECT ${SCRAPE_RESULT_COLUMNS} FROM scrape_tasks WHERE id = $1 AND workspace_id = $2`,
    [taskId, workspaceId],
    client,
  );
  return result.rows[0] ? toScrapeResultDoc(result.rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Cursor-based batch queries (for bulk reindex)
// ---------------------------------------------------------------------------

export async function fetchEnrichmentRecordsBatch(
  workspaceId: string,
  cursor: string | null,
  limit: number,
  client?: PoolClient,
): Promise<BatchResult<EnrichmentRecordDoc>> {
  const cursorValue = cursor ?? '00000000-0000-0000-0000-000000000000';
  const result = await exec<EnrichmentRecordRow>(
    `SELECT ${ENRICHMENT_RECORD_COLUMNS}
     FROM enrichment_records
     WHERE workspace_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [workspaceId, cursorValue, limit],
    client,
  );

  const records = result.rows.map(toEnrichmentRecordDoc);
  const nextCursor = records.length === limit ? records[records.length - 1].id : null;

  return { records, nextCursor };
}

export async function fetchContactCompanyRecordsBatch(
  workspaceId: string,
  cursor: string | null,
  limit: number,
  client?: PoolClient,
): Promise<BatchResult<ContactCompanyRecordDoc>> {
  const cursorValue = cursor ?? '00000000-0000-0000-0000-000000000000';
  const result = await exec<ContactCompanyRecordRow>(
    `SELECT ${CONTACT_COMPANY_COLUMNS}
     FROM records
     WHERE workspace_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [workspaceId, cursorValue, limit],
    client,
  );

  const records = result.rows.map(toContactCompanyRecordDoc);
  const nextCursor = records.length === limit ? records[records.length - 1].id : null;

  return { records, nextCursor };
}

export async function fetchScrapeResultsBatch(
  workspaceId: string,
  cursor: string | null,
  limit: number,
  client?: PoolClient,
): Promise<BatchResult<ScrapeResultDoc>> {
  const cursorValue = cursor ?? '00000000-0000-0000-0000-000000000000';
  const result = await exec<ScrapeResultRow>(
    `SELECT ${SCRAPE_RESULT_COLUMNS}
     FROM scrape_tasks
     WHERE workspace_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [workspaceId, cursorValue, limit],
    client,
  );

  const records = result.rows.map(toScrapeResultDoc);
  const nextCursor = records.length === limit ? records[records.length - 1].id : null;

  return { records, nextCursor };
}
