import { query } from '../../shared/db';

// --- Row interfaces (snake_case, private) ---

interface ServiceConfigurationRow {
  id: string;
  workspace_id: string;
  service_key: string;
  service_group: string;
  encrypted_values: string;
  iv: string;
  auth_tag: string;
  status: string;
  last_tested_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

// --- Domain interfaces (camelCase, exported) ---

export interface ServiceConfiguration {
  id: string;
  workspaceId: string;
  serviceKey: string;
  serviceGroup: string;
  encryptedValues: string;
  iv: string;
  authTag: string;
  status: string;
  lastTestedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertData {
  serviceGroup: string;
  encryptedValues: string;
  iv: string;
  authTag: string;
  createdBy: string;
}

// --- Mapper ---

function toServiceConfiguration(row: ServiceConfigurationRow): ServiceConfiguration {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    serviceKey: row.service_key,
    serviceGroup: row.service_group,
    encryptedValues: row.encrypted_values,
    iv: row.iv,
    authTag: row.auth_tag,
    status: row.status,
    lastTestedAt: row.last_tested_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ALL_COLUMNS = `id, workspace_id, service_key, service_group, encrypted_values, iv, auth_tag, status, last_tested_at, created_by, created_at, updated_at`;

export async function findAllByWorkspace(
  workspaceId: string,
): Promise<ServiceConfiguration[]> {
  const result = await query<ServiceConfigurationRow>(
    `SELECT ${ALL_COLUMNS} FROM service_configurations
     WHERE workspace_id = $1
     ORDER BY service_group ASC, service_key ASC`,
    [workspaceId],
  );
  return result.rows.map(toServiceConfiguration);
}

export async function findByServiceKey(
  workspaceId: string,
  serviceKey: string,
): Promise<ServiceConfiguration | null> {
  const result = await query<ServiceConfigurationRow>(
    `SELECT ${ALL_COLUMNS} FROM service_configurations
     WHERE workspace_id = $1 AND service_key = $2`,
    [workspaceId, serviceKey],
  );
  return result.rows[0] ? toServiceConfiguration(result.rows[0]) : null;
}

export async function upsert(
  workspaceId: string,
  serviceKey: string,
  data: UpsertData,
): Promise<ServiceConfiguration> {
  const result = await query<ServiceConfigurationRow>(
    `INSERT INTO service_configurations (workspace_id, service_key, service_group, encrypted_values, iv, auth_tag, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id, service_key) DO UPDATE SET
       service_group = EXCLUDED.service_group,
       encrypted_values = EXCLUDED.encrypted_values,
       iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag,
       updated_at = NOW()
     RETURNING ${ALL_COLUMNS}`,
    [workspaceId, serviceKey, data.serviceGroup, data.encryptedValues, data.iv, data.authTag, data.createdBy],
  );
  return toServiceConfiguration(result.rows[0]);
}

export async function deleteByServiceKey(
  workspaceId: string,
  serviceKey: string,
): Promise<void> {
  await query(
    `DELETE FROM service_configurations WHERE workspace_id = $1 AND service_key = $2`,
    [workspaceId, serviceKey],
  );
}

export async function updateStatus(
  workspaceId: string,
  serviceKey: string,
  status: string,
  lastTestedAt: Date,
): Promise<ServiceConfiguration | null> {
  const result = await query<ServiceConfigurationRow>(
    `UPDATE service_configurations
     SET status = $3, last_tested_at = $4, updated_at = NOW()
     WHERE workspace_id = $1 AND service_key = $2
     RETURNING ${ALL_COLUMNS}`,
    [workspaceId, serviceKey, status, lastTestedAt],
  );
  return result.rows[0] ? toServiceConfiguration(result.rows[0]) : null;
}
