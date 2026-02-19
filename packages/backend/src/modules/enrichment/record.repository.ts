import { query } from '../../shared/db';

export interface EnrichmentRecord {
  id: string;
  jobId: string;
  workspaceId: string;
  inputData: Record<string, unknown>;
  outputData: Record<string, unknown> | null;
  providerSlug: string;
  creditsConsumed: number;
  status: string;
  errorReason: string | null;
  idempotencyKey: string;
  creditTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EnrichmentRecordRow {
  id: string;
  job_id: string;
  workspace_id: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown> | null;
  provider_slug: string;
  credits_consumed: number;
  status: string;
  error_reason: string | null;
  idempotency_key: string;
  credit_transaction_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toEnrichmentRecord(row: EnrichmentRecordRow): EnrichmentRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    workspaceId: row.workspace_id,
    inputData: row.input_data,
    outputData: row.output_data,
    providerSlug: row.provider_slug,
    creditsConsumed: row.credits_consumed,
    status: row.status,
    errorReason: row.error_reason,
    idempotencyKey: row.idempotency_key,
    creditTransactionId: row.credit_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RECORD_COLUMNS =
  'id, job_id, workspace_id, input_data, output_data, provider_slug, credits_consumed, status, error_reason, idempotency_key, credit_transaction_id, created_at, updated_at';

export async function createRecord(data: {
  jobId: string;
  workspaceId: string;
  inputData: Record<string, unknown>;
  outputData?: Record<string, unknown> | null;
  providerSlug: string;
  creditsConsumed?: number;
  status: string;
  errorReason?: string | null;
  idempotencyKey: string;
  creditTransactionId?: string | null;
}): Promise<EnrichmentRecord> {
  const outputData = data.outputData ?? null;
  const creditsConsumed = data.creditsConsumed ?? 0;
  const errorReason = data.errorReason ?? null;
  const creditTransactionId = data.creditTransactionId ?? null;

  const result = await query<EnrichmentRecordRow>(
    `INSERT INTO enrichment_records (job_id, workspace_id, input_data, output_data, provider_slug, credits_consumed, status, error_reason, idempotency_key, credit_transaction_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${RECORD_COLUMNS}`,
    [
      data.jobId,
      data.workspaceId,
      JSON.stringify(data.inputData),
      outputData ? JSON.stringify(outputData) : null,
      data.providerSlug,
      creditsConsumed,
      data.status,
      errorReason,
      data.idempotencyKey,
      creditTransactionId,
    ],
  );

  // If RETURNING gave no rows, the idempotency_key already exists — fetch the existing record
  if (result.rows.length === 0) {
    const existing = await getRecordByIdempotencyKey(data.idempotencyKey);
    return existing!;
  }

  return toEnrichmentRecord(result.rows[0]);
}

export async function getRecordById(recordId: string, workspaceId: string): Promise<EnrichmentRecord | null> {
  const result = await query<EnrichmentRecordRow>(
    `SELECT ${RECORD_COLUMNS} FROM enrichment_records WHERE id = $1 AND workspace_id = $2`,
    [recordId, workspaceId],
  );
  return result.rows[0] ? toEnrichmentRecord(result.rows[0]) : null;
}

export async function listRecordsByJob(
  jobId: string,
  workspaceId: string,
  pagination: { page: number; limit: number },
): Promise<{ records: EnrichmentRecord[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM enrichment_records WHERE job_id = $1 AND workspace_id = $2',
    [jobId, workspaceId],
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<EnrichmentRecordRow>(
    `SELECT ${RECORD_COLUMNS} FROM enrichment_records WHERE job_id = $1 AND workspace_id = $2 ORDER BY created_at ASC LIMIT $3 OFFSET $4`,
    [jobId, workspaceId, pagination.limit, offset],
  );

  return {
    records: result.rows.map(toEnrichmentRecord),
    total,
  };
}

export async function getRecordByIdempotencyKey(key: string): Promise<EnrichmentRecord | null> {
  const result = await query<EnrichmentRecordRow>(
    `SELECT ${RECORD_COLUMNS} FROM enrichment_records WHERE idempotency_key = $1`,
    [key],
  );
  return result.rows[0] ? toEnrichmentRecord(result.rows[0]) : null;
}
