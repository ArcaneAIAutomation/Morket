import { query } from '../../shared/db';
import type { WorkspaceRole } from '../../shared/types';

export interface WorkspaceMembership {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  invitedAt: Date;
  acceptedAt: Date | null;
}

export interface MemberWithUser {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  joinedAt: Date | null;
}

interface MembershipRow {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
  invited_at: Date;
  accepted_at: Date | null;
}

interface MemberWithUserRow {
  user_id: string;
  email: string;
  display_name: string;
  role: WorkspaceRole;
  joined_at: Date | null;
}

function toMembership(row: MembershipRow): WorkspaceMembership {
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    role: row.role,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
  };
}

const MEMBERSHIP_COLUMNS = 'user_id, workspace_id, role, invited_at, accepted_at';

export async function create(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMembership> {
  const result = await query<MembershipRow>(
    `INSERT INTO workspace_memberships (user_id, workspace_id, role)
     VALUES ($1, $2, $3)
     RETURNING ${MEMBERSHIP_COLUMNS}`,
    [userId, workspaceId, role],
  );
  return toMembership(result.rows[0]);
}

export async function findByUserAndWorkspace(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembership | null> {
  const result = await query<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM workspace_memberships
     WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId],
  );
  return result.rows[0] ? toMembership(result.rows[0]) : null;
}

export async function findFirstForUser(
  userId: string,
): Promise<WorkspaceMembership | null> {
  const result = await query<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM workspace_memberships
     WHERE user_id = $1
     ORDER BY invited_at ASC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? toMembership(result.rows[0]) : null;
}


export async function findAllForWorkspace(
  workspaceId: string,
): Promise<WorkspaceMembership[]> {
  const result = await query<MembershipRow>(
    `SELECT ${MEMBERSHIP_COLUMNS} FROM workspace_memberships
     WHERE workspace_id = $1`,
    [workspaceId],
  );
  return result.rows.map(toMembership);
}

export async function findAllWithUsers(
  workspaceId: string,
): Promise<MemberWithUser[]> {
  const result = await query<MemberWithUserRow>(
    `SELECT wm.user_id, u.email, u.display_name, wm.role, wm.accepted_at AS joined_at
     FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.invited_at ASC`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at,
  }));
}

export async function updateRole(
  userId: string,
  workspaceId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMembership> {
  const result = await query<MembershipRow>(
    `UPDATE workspace_memberships SET role = $3
     WHERE user_id = $1 AND workspace_id = $2
     RETURNING ${MEMBERSHIP_COLUMNS}`,
    [userId, workspaceId, role],
  );
  return toMembership(result.rows[0]);
}

export async function deleteMembership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  await query(
    'DELETE FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2',
    [userId, workspaceId],
  );
}

export async function countOwners(workspaceId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM workspace_memberships
     WHERE workspace_id = $1 AND role = 'owner'`,
    [workspaceId],
  );
  return parseInt(result.rows[0].count, 10);
}
