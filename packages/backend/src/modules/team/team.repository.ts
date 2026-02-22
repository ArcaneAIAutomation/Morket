import { query } from '../../shared/db';
import { NotFoundError } from '../../shared/errors';

// --- Activity Feed ---

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

interface ActivityRow {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function toActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id,
    action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
    metadata: row.metadata, createdAt: row.created_at,
  };
}

export async function createActivity(data: {
  workspaceId: string; actorId?: string; action: string;
  resourceType?: string; resourceId?: string; metadata?: Record<string, unknown>;
}): Promise<ActivityEntry> {
  const result = await query<ActivityRow>(
    `INSERT INTO activity_feed (workspace_id, actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.workspaceId, data.actorId ?? null, data.action, data.resourceType ?? null, data.resourceId ?? null, JSON.stringify(data.metadata ?? {})],
  );
  return toActivity(result.rows[0]);
}

export async function listActivity(workspaceId: string, page: number, limit: number): Promise<{ entries: ActivityEntry[]; total: number }> {
  const offset = (page - 1) * limit;
  const countResult = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM activity_feed WHERE workspace_id = $1`, [workspaceId]);
  const result = await query<ActivityRow>(`SELECT * FROM activity_feed WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [workspaceId, limit, offset]);
  return { entries: result.rows.map(toActivity), total: parseInt(countResult.rows[0].count, 10) };
}

// --- Audit Log ---

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
}

interface AuditRow {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: Date;
}

function toAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id,
    action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
    metadata: row.metadata, ipAddress: row.ip_address, createdAt: row.created_at,
  };
}

export async function createAuditEntry(data: {
  workspaceId: string; actorId?: string; action: string; resourceType: string;
  resourceId?: string; metadata?: Record<string, unknown>; ipAddress?: string;
}): Promise<AuditEntry> {
  const result = await query<AuditRow>(
    `INSERT INTO audit_log (workspace_id, actor_id, action, resource_type, resource_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.workspaceId, data.actorId ?? null, data.action, data.resourceType, data.resourceId ?? null, JSON.stringify(data.metadata ?? {}), data.ipAddress ?? null],
  );
  return toAudit(result.rows[0]);
}

export async function listAuditLog(
  workspaceId: string,
  filters: { action?: string; actorId?: string; dateFrom?: string; dateTo?: string },
  page: number,
  limit: number,
): Promise<{ entries: AuditEntry[]; total: number }> {
  const conditions: string[] = ['workspace_id = $1'];
  const values: unknown[] = [workspaceId];
  let idx = 2;

  if (filters.action) { conditions.push(`action = $${idx++}`); values.push(filters.action); }
  if (filters.actorId) { conditions.push(`actor_id = $${idx++}`); values.push(filters.actorId); }
  if (filters.dateFrom) { conditions.push(`created_at >= $${idx++}`); values.push(filters.dateFrom); }
  if (filters.dateTo) { conditions.push(`created_at <= $${idx++}`); values.push(filters.dateTo); }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`, values);
  const result = await query<AuditRow>(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`, [...values, limit, offset]);
  return { entries: result.rows.map(toAudit), total: parseInt(countResult.rows[0].count, 10) };
}

// --- Workspace Invitations ---

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  token: string;
  invitedBy: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string;
  status: string;
  expires_at: Date;
  created_at: Date;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id, workspaceId: row.workspace_id, email: row.email, role: row.role,
    token: row.token, invitedBy: row.invited_by, status: row.status,
    expiresAt: row.expires_at, createdAt: row.created_at,
  };
}

export async function createInvitation(
  workspaceId: string, email: string, role: string, token: string, invitedBy: string,
): Promise<Invitation> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const result = await query<InvitationRow>(
    `INSERT INTO workspace_invitations (workspace_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [workspaceId, email, role, token, invitedBy, expiresAt],
  );
  return toInvitation(result.rows[0]);
}

export async function findInvitationByToken(token: string): Promise<Invitation | null> {
  const result = await query<InvitationRow>(`SELECT * FROM workspace_invitations WHERE token = $1`, [token]);
  return result.rows[0] ? toInvitation(result.rows[0]) : null;
}

export async function updateInvitationStatus(token: string, status: string): Promise<void> {
  const result = await query(`UPDATE workspace_invitations SET status = $2 WHERE token = $1`, [token, status]);
  if (result.rowCount === 0) throw new NotFoundError('Invitation not found');
}

export async function listPendingInvitations(workspaceId: string): Promise<Invitation[]> {
  const result = await query<InvitationRow>(
    `SELECT * FROM workspace_invitations WHERE workspace_id = $1 AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(toInvitation);
}
