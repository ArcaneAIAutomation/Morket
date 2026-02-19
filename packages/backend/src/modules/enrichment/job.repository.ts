import { query } from '../../shared/db';

export interface EnrichmentJob {
  id: string;
  workspaceId: string;
  status: string;
  requestedFields: unknown[];
  waterfallConfig: Record<string, unknown> | null;
  totalRecords: number;
  completedRecords: number;
  failedRecords: number;
  estimatedCredits: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface EnrichmentJobRow {
  id: string;
  workspace_id: string;
  status: string;
  requested_fields: unknown[];
  waterfall_config: Record<string, unknown> | null;
  total_records: number;
  completed_records: number;
  failed_records: number;
  estimated_credits: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

function toEnrichmentJob(row: EnrichmentJobRow): EnrichmentJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    requestedFields: row.requested_fields,
    waterfallConfig: row.waterfall_config,
    totalRecords: row.total_records,
    completedRecords: row.completed_records,
    failedRecords: row.failed_records,
    estimatedCredits: row.estimated_credits,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const JOB_COLUMNS =
  'id, workspace_id, status, requested_fields, waterfall_config, total_records, completed_records, failed_records, estimated_credits, created_by, created_at, updated_at, completed_at';

export async function createJob(data: {
  workspaceId: string;
  status?: string;
  requestedFields: unknown[];
  waterfallConfig?: Record<string, unknown> | null;
  totalRecords: number;
  estimatedCredits: number;
  createdBy: string;
}): Promise<EnrichmentJob> {
  const status = data.status ?? 'pending';
  const waterfallConfig = data.waterfallConfig ?? null;

  const result = await query<EnrichmentJobRow>(
    `INSERT INTO enrichment_jobs (workspace_id, status, requested_fields, waterfall_config, total_records, estimated_credits, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${JOB_COLUMNS}`,
    [data.workspaceId, status, JSON.stringify(data.requestedFields), waterfallConfig ? JSON.stringify(waterfallConfig) : null, data.totalRecords, data.estimatedCredits, data.createdBy],
  );
  return toEnrichmentJob(result.rows[0]);
}

export async function getJobById(jobId: string, workspaceId: string): Promise<EnrichmentJob | null> {
  const result = await query<EnrichmentJobRow>(
    `SELECT ${JOB_COLUMNS} FROM enrichment_jobs WHERE id = $1 AND workspace_id = $2`,
    [jobId, workspaceId],
  );
  return result.rows[0] ? toEnrichmentJob(result.rows[0]) : null;
}

export async function listJobs(
  workspaceId: string,
  pagination: { page: number; limit: number },
): Promise<{ jobs: EnrichmentJob[]; total: number }> {
  const offset = (pagination.page - 1) * pagination.limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM enrichment_jobs WHERE workspace_id = $1',
    [workspaceId],
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<EnrichmentJobRow>(
    `SELECT ${JOB_COLUMNS} FROM enrichment_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [workspaceId, pagination.limit, offset],
  );

  return {
    jobs: result.rows.map(toEnrichmentJob),
    total,
  };
}

export async function updateJobStatus(
  jobId: string,
  updates: {
    status: string;
    completedRecords?: number;
    failedRecords?: number;
    completedAt?: Date | null;
  },
): Promise<EnrichmentJob | null> {
  const setClauses: string[] = ['status = $2', 'updated_at = NOW()'];
  const params: unknown[] = [jobId, updates.status];
  let paramIndex = 3;

  if (updates.completedRecords !== undefined) {
    setClauses.push(`completed_records = $${paramIndex}`);
    params.push(updates.completedRecords);
    paramIndex++;
  }

  if (updates.failedRecords !== undefined) {
    setClauses.push(`failed_records = $${paramIndex}`);
    params.push(updates.failedRecords);
    paramIndex++;
  }

  if (updates.completedAt !== undefined) {
    setClauses.push(`completed_at = $${paramIndex}`);
    params.push(updates.completedAt);
    paramIndex++;
  }

  const result = await query<EnrichmentJobRow>(
    `UPDATE enrichment_jobs SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
    params,
  );

  return result.rows[0] ? toEnrichmentJob(result.rows[0]) : null;
}
