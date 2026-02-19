import { query } from '../../shared/db';

export interface ApiCredential {
  id: string;
  workspaceId: string;
  providerName: string;
  encryptedKey: string;
  encryptedSecret: string;
  iv: string;
  authTag: string;
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface ApiCredentialRow {
  id: string;
  workspace_id: string;
  provider_name: string;
  encrypted_key: string;
  encrypted_secret: string;
  iv: string;
  auth_tag: string;
  created_by: string;
  created_at: Date;
  last_used_at: Date | null;
}

function toApiCredential(row: ApiCredentialRow): ApiCredential {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    providerName: row.provider_name,
    encryptedKey: row.encrypted_key,
    encryptedSecret: row.encrypted_secret,
    iv: row.iv,
    authTag: row.auth_tag,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

const CREDENTIAL_COLUMNS =
  'id, workspace_id, provider_name, encrypted_key, encrypted_secret, iv, auth_tag, created_by, created_at, last_used_at';

export async function create(data: {
  workspaceId: string;
  providerName: string;
  encryptedKey: string;
  encryptedSecret: string;
  iv: string;
  authTag: string;
  createdBy: string;
}): Promise<ApiCredential> {
  const result = await query<ApiCredentialRow>(
    `INSERT INTO api_credentials (workspace_id, provider_name, encrypted_key, encrypted_secret, iv, auth_tag, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CREDENTIAL_COLUMNS}`,
    [data.workspaceId, data.providerName, data.encryptedKey, data.encryptedSecret, data.iv, data.authTag, data.createdBy],
  );
  return toApiCredential(result.rows[0]);
}

export async function findById(id: string): Promise<ApiCredential | null> {
  const result = await query<ApiCredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM api_credentials WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toApiCredential(result.rows[0]) : null;
}

export async function findAllByWorkspace(workspaceId: string): Promise<ApiCredential[]> {
  const result = await query<ApiCredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM api_credentials WHERE workspace_id = $1`,
    [workspaceId],
  );
  return result.rows.map(toApiCredential);
}

export async function deleteCredential(id: string): Promise<void> {
  await query('DELETE FROM api_credentials WHERE id = $1', [id]);
}

export async function updateLastUsed(id: string): Promise<void> {
  await query(
    'UPDATE api_credentials SET last_used_at = NOW() WHERE id = $1',
    [id],
  );
}
