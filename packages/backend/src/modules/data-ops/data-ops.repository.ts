import { query } from '../../shared/db';
import { NotFoundError } from '../../shared/errors';

// --- Saved Views ---

export interface SavedView {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  filters: Record<string, unknown>;
  sortConfig: Record<string, unknown>;
  columnVisibility: Record<string, boolean>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface SavedViewRow {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  filters: Record<string, unknown>;
  sort_config: Record<string, unknown>;
  column_visibility: Record<string, boolean>;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    name: row.name,
    filters: row.filters,
    sortConfig: row.sort_config,
    columnVisibility: row.column_visibility,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listViews(workspaceId: string): Promise<SavedView[]> {
  const result = await query<SavedViewRow>(
    `SELECT * FROM saved_views WHERE workspace_id = $1 ORDER BY is_default DESC, name ASC`,
    [workspaceId],
  );
  return result.rows.map(toSavedView);
}

export async function createView(
  workspaceId: string,
  createdBy: string,
  data: {
    name: string;
    filters: Record<string, unknown>;
    sortConfig: Record<string, unknown>;
    columnVisibility: Record<string, boolean>;
    isDefault: boolean;
  },
): Promise<SavedView> {
  // If setting as default, unset any existing default
  if (data.isDefault) {
    await query(
      `UPDATE saved_views SET is_default = false WHERE workspace_id = $1 AND is_default = true`,
      [workspaceId],
    );
  }
  const result = await query<SavedViewRow>(
    `INSERT INTO saved_views (workspace_id, created_by, name, filters, sort_config, column_visibility, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [workspaceId, createdBy, data.name, JSON.stringify(data.filters), JSON.stringify(data.sortConfig), JSON.stringify(data.columnVisibility), data.isDefault],
  );
  return toSavedView(result.rows[0]);
}

export async function updateView(
  workspaceId: string,
  viewId: string,
  data: {
    name?: string;
    filters?: Record<string, unknown>;
    sortConfig?: Record<string, unknown>;
    columnVisibility?: Record<string, boolean>;
    isDefault?: boolean;
  },
): Promise<SavedView> {
  // If setting as default, unset any existing default
  if (data.isDefault) {
    await query(
      `UPDATE saved_views SET is_default = false WHERE workspace_id = $1 AND is_default = true AND id != $2`,
      [workspaceId, viewId],
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [workspaceId, viewId];
  let idx = 3;

  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
  if (data.filters !== undefined) { sets.push(`filters = $${idx++}`); values.push(JSON.stringify(data.filters)); }
  if (data.sortConfig !== undefined) { sets.push(`sort_config = $${idx++}`); values.push(JSON.stringify(data.sortConfig)); }
  if (data.columnVisibility !== undefined) { sets.push(`column_visibility = $${idx++}`); values.push(JSON.stringify(data.columnVisibility)); }
  if (data.isDefault !== undefined) { sets.push(`is_default = $${idx++}`); values.push(data.isDefault); }

  if (sets.length === 0) {
    const existing = await getView(workspaceId, viewId);
    if (!existing) throw new NotFoundError('Saved view not found');
    return existing;
  }

  sets.push('updated_at = NOW()');

  const result = await query<SavedViewRow>(
    `UPDATE saved_views SET ${sets.join(', ')} WHERE workspace_id = $1 AND id = $2 RETURNING *`,
    values,
  );
  if (result.rows.length === 0) throw new NotFoundError('Saved view not found');
  return toSavedView(result.rows[0]);
}

export async function getView(workspaceId: string, viewId: string): Promise<SavedView | null> {
  const result = await query<SavedViewRow>(
    `SELECT * FROM saved_views WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, viewId],
  );
  return result.rows[0] ? toSavedView(result.rows[0]) : null;
}

export async function deleteView(workspaceId: string, viewId: string): Promise<void> {
  const result = await query(
    `DELETE FROM saved_views WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, viewId],
  );
  if (result.rowCount === 0) throw new NotFoundError('Saved view not found');
}

// --- Record Activity Log ---

export interface ActivityLogEntry {
  id: string;
  workspaceId: string;
  recordId: string;
  action: string;
  providerSlug: string | null;
  fieldsChanged: Record<string, unknown> | null;
  performedBy: string | null;
  createdAt: Date;
}

interface ActivityLogRow {
  id: string;
  workspace_id: string;
  record_id: string;
  action: string;
  provider_slug: string | null;
  fields_changed: Record<string, unknown> | null;
  performed_by: string | null;
  created_at: Date;
}

function toActivityLogEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recordId: row.record_id,
    action: row.action,
    providerSlug: row.provider_slug,
    fieldsChanged: row.fields_changed,
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

export async function createActivityEntry(data: {
  workspaceId: string;
  recordId: string;
  action: string;
  providerSlug?: string;
  fieldsChanged?: Record<string, unknown>;
  performedBy?: string;
}): Promise<ActivityLogEntry> {
  const result = await query<ActivityLogRow>(
    `INSERT INTO record_activity_log (workspace_id, record_id, action, provider_slug, fields_changed, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.workspaceId, data.recordId, data.action, data.providerSlug ?? null, data.fieldsChanged ? JSON.stringify(data.fieldsChanged) : null, data.performedBy ?? null],
  );
  return toActivityLogEntry(result.rows[0]);
}

export async function getActivityLog(
  recordId: string,
  page: number,
  limit: number,
): Promise<{ entries: ActivityLogEntry[]; total: number }> {
  const offset = (page - 1) * limit;
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM record_activity_log WHERE record_id = $1`,
    [recordId],
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await query<ActivityLogRow>(
    `SELECT * FROM record_activity_log WHERE record_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [recordId, limit, offset],
  );
  return { entries: result.rows.map(toActivityLogEntry), total };
}

// --- Hygiene Stats (aggregate queries on enrichment_records) ---

export interface HygieneStats {
  totalRecords: number;
  fieldCompleteness: Record<string, number>;
  enrichedLast30d: number;
  enrichedLast60d: number;
  enrichedLast90d: number;
  staleRecords: number;
}

export async function getHygieneStats(workspaceId: string): Promise<HygieneStats> {
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM enrichment_records WHERE workspace_id = $1`,
    [workspaceId],
  );
  const totalRecords = parseInt(countResult.rows[0].count, 10);

  if (totalRecords === 0) {
    return { totalRecords: 0, fieldCompleteness: {}, enrichedLast30d: 0, enrichedLast60d: 0, enrichedLast90d: 0, staleRecords: 0 };
  }

  // Freshness counts
  const freshnessResult = await query<{ d30: string; d60: string; d90: string; stale: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '30 days') AS d30,
       COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '60 days') AS d60,
       COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '90 days') AS d90,
       COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '90 days') AS stale
     FROM enrichment_records WHERE workspace_id = $1`,
    [workspaceId],
  );
  const f = freshnessResult.rows[0];

  // Field completeness: count non-null keys in output_data across all records
  // We check common enrichment output fields
  const completenessResult = await query<{ field_name: string; filled: string }>(
    `SELECT key AS field_name, COUNT(*) AS filled
     FROM enrichment_records, jsonb_object_keys(COALESCE(output_data, '{}'::jsonb)) AS key
     WHERE workspace_id = $1 AND output_data IS NOT NULL
     GROUP BY key`,
    [workspaceId],
  );
  const fieldCompleteness: Record<string, number> = {};
  for (const row of completenessResult.rows) {
    fieldCompleteness[row.field_name] = Math.round((parseInt(row.filled, 10) / totalRecords) * 100);
  }

  return {
    totalRecords,
    fieldCompleteness,
    enrichedLast30d: parseInt(f.d30, 10),
    enrichedLast60d: parseInt(f.d60, 10),
    enrichedLast90d: parseInt(f.d90, 10),
    staleRecords: parseInt(f.stale, 10),
  };
}

// --- Dedup Scan ---

export interface DuplicateGroup {
  keyValue: string;
  recordIds: string[];
  count: number;
}

export async function scanDuplicates(
  workspaceId: string,
  keyFields: string[],
): Promise<DuplicateGroup[]> {
  // Validate field names to prevent SQL injection — only allow alphanumeric, underscore, hyphen
  const SAFE_FIELD_NAME = /^[a-zA-Z0-9_-]+$/;
  for (const f of keyFields) {
    if (!SAFE_FIELD_NAME.test(f)) {
      throw new Error(`Invalid field name: ${f}`);
    }
  }

  // Build a composite key from input_data fields
  const keyExpr = keyFields
    .map((f) => `COALESCE(input_data->>'${f}', '')`)
    .join(` || '|' || `);

  const result = await query<{ key_value: string; record_ids: string[]; cnt: string }>(
    `SELECT ${keyExpr} AS key_value, array_agg(id) AS record_ids, COUNT(*) AS cnt
     FROM enrichment_records
     WHERE workspace_id = $1
     GROUP BY key_value
     HAVING COUNT(*) > 1
     ORDER BY cnt DESC
     LIMIT 500`,
    [workspaceId],
  );

  return result.rows.map((r) => ({
    keyValue: r.key_value,
    recordIds: r.record_ids,
    count: parseInt(r.cnt, 10),
  }));
}

// --- Bulk Delete ---

export async function bulkDeleteRecords(workspaceId: string, recordIds: string[]): Promise<number> {
  const result = await query(
    `DELETE FROM enrichment_records WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, recordIds],
  );
  return result.rowCount ?? 0;
}

// --- Export query ---

export async function queryRecordsForExport(
  workspaceId: string,
  filters: { status?: string; providerSlug?: string; dateFrom?: string; dateTo?: string },
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = ['workspace_id = $1'];
  const values: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.status) { conditions.push(`status = $${idx++}`); values.push(filters.status); }
  if (filters.providerSlug) { conditions.push(`provider_slug = $${idx++}`); values.push(filters.providerSlug); }
  if (filters.dateFrom) { conditions.push(`created_at >= $${idx++}`); values.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push(`created_at <= $${idx++}`); values.push(filters.dateTo); }

  values.push(limit);

  const result = await query<Record<string, unknown>>(
    `SELECT id, job_id, input_data, output_data, provider_slug, status, credits_consumed, created_at, updated_at
     FROM enrichment_records
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    values,
  );
  return result.rows;
}
