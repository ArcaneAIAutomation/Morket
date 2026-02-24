import { query } from '../../shared/db';

// --- Integration Records ---

export interface IntegrationRecord {
  id: string;
  workspaceId: string;
  integrationSlug: string;
  encryptedTokens: string;
  tokenIv: string;
  tokenTag: string;
  status: string;
  connectedAt: Date;
}

interface IntegrationRow {
  id: string;
  workspace_id: string;
  integration_slug: string;
  encrypted_tokens: string;
  token_iv: string;
  token_tag: string;
  status: string;
  connected_at: Date;
}

function toIntegrationRecord(row: IntegrationRow): IntegrationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    integrationSlug: row.integration_slug,
    encryptedTokens: row.encrypted_tokens,
    tokenIv: row.token_iv,
    tokenTag: row.token_tag,
    status: row.status,
    connectedAt: row.connected_at,
  };
}

export async function upsertIntegration(
  workspaceId: string,
  slug: string,
  encryptedTokens: string,
  tokenIv: string,
  tokenTag: string,
): Promise<IntegrationRecord> {
  const result = await query<IntegrationRow>(
    `INSERT INTO integrations (workspace_id, integration_slug, encrypted_tokens, token_iv, token_tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, integration_slug)
     DO UPDATE SET encrypted_tokens = $3, token_iv = $4, token_tag = $5, status = 'connected', connected_at = NOW()
     RETURNING *`,
    [workspaceId, slug, encryptedTokens, tokenIv, tokenTag],
  );
  return toIntegrationRecord(result.rows[0]);
}

export async function findIntegration(
  workspaceId: string,
  slug: string,
): Promise<IntegrationRecord | null> {
  const result = await query<IntegrationRow>(
    `SELECT * FROM integrations WHERE workspace_id = $1 AND integration_slug = $2`,
    [workspaceId, slug],
  );
  return result.rows[0] ? toIntegrationRecord(result.rows[0]) : null;
}

export async function listIntegrations(workspaceId: string): Promise<IntegrationRecord[]> {
  const result = await query<IntegrationRow>(
    `SELECT * FROM integrations WHERE workspace_id = $1 ORDER BY connected_at DESC`,
    [workspaceId],
  );
  return result.rows.map(toIntegrationRecord);
}

export async function deleteIntegration(workspaceId: string, slug: string): Promise<void> {
  await query(
    `DELETE FROM integrations WHERE workspace_id = $1 AND integration_slug = $2`,
    [workspaceId, slug],
  );
}

// --- Field Mappings ---

export interface FieldMappingRecord {
  id: string;
  workspaceId: string;
  integrationSlug: string;
  morketField: string;
  crmField: string;
  direction: 'push' | 'pull' | 'both';
}

interface FieldMappingRow {
  id: string;
  workspace_id: string;
  integration_slug: string;
  morket_field: string;
  crm_field: string;
  direction: 'push' | 'pull' | 'both';
}

function toFieldMappingRecord(row: FieldMappingRow): FieldMappingRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    integrationSlug: row.integration_slug,
    morketField: row.morket_field,
    crmField: row.crm_field,
    direction: row.direction,
  };
}

export async function getFieldMappings(
  workspaceId: string,
  slug: string,
): Promise<FieldMappingRecord[]> {
  const result = await query<FieldMappingRow>(
    `SELECT * FROM integration_field_mappings WHERE workspace_id = $1 AND integration_slug = $2`,
    [workspaceId, slug],
  );
  return result.rows.map(toFieldMappingRecord);
}

export async function replaceFieldMappings(
  workspaceId: string,
  slug: string,
  mappings: Array<{ morketField: string; crmField: string; direction: string }>,
): Promise<FieldMappingRecord[]> {
  await query(
    `DELETE FROM integration_field_mappings WHERE workspace_id = $1 AND integration_slug = $2`,
    [workspaceId, slug],
  );

  if (mappings.length === 0) return [];

  const insertValues: unknown[] = [workspaceId, slug];
  const insertPlaceholders: string[] = [];
  mappings.forEach((m) => {
    const base = insertValues.length + 1;
    insertPlaceholders.push(`(gen_random_uuid(), $1, $2, $${base}, $${base + 1}, $${base + 2})`);
    insertValues.push(m.morketField, m.crmField, m.direction);
  });

  const result = await query<FieldMappingRow>(
    `INSERT INTO integration_field_mappings (id, workspace_id, integration_slug, morket_field, crm_field, direction)
     VALUES ${insertPlaceholders.join(', ')}
     RETURNING *`,
    insertValues,
  );
  return result.rows.map(toFieldMappingRecord);
}


// --- Sync History ---

export interface SyncHistoryRecord {
  id: string;
  workspaceId: string;
  integrationSlug: string;
  direction: 'push' | 'pull';
  recordCount: number;
  successCount: number;
  failureCount: number;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

interface SyncHistoryRow {
  id: string;
  workspace_id: string;
  integration_slug: string;
  direction: 'push' | 'pull';
  record_count: number;
  success_count: number;
  failure_count: number;
  status: string;
  started_at: Date;
  completed_at: Date | null;
}

function toSyncHistoryRecord(row: SyncHistoryRow): SyncHistoryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    integrationSlug: row.integration_slug,
    direction: row.direction,
    recordCount: row.record_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function createSyncEntry(
  workspaceId: string,
  slug: string,
  direction: 'push' | 'pull',
): Promise<SyncHistoryRecord> {
  const result = await query<SyncHistoryRow>(
    `INSERT INTO sync_history (workspace_id, integration_slug, direction)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [workspaceId, slug, direction],
  );
  return toSyncHistoryRecord(result.rows[0]);
}

export async function completeSyncEntry(
  id: string,
  status: string,
  recordCount: number,
  successCount: number,
  failureCount: number,
): Promise<void> {
  await query(
    `UPDATE sync_history SET status = $2, record_count = $3, success_count = $4, failure_count = $5, completed_at = NOW()
     WHERE id = $1`,
    [id, status, recordCount, successCount, failureCount],
  );
}

export async function getSyncHistory(
  workspaceId: string,
  slug: string,
  limit: number = 20,
): Promise<SyncHistoryRecord[]> {
  const result = await query<SyncHistoryRow>(
    `SELECT * FROM sync_history WHERE workspace_id = $1 AND integration_slug = $2
     ORDER BY started_at DESC LIMIT $3`,
    [workspaceId, slug, limit],
  );
  return result.rows.map(toSyncHistoryRecord);
}
