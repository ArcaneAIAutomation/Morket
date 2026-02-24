import { getPool } from '../../shared/db';
import { NotFoundError, AuthorizationError, ConflictError } from '../../shared/errors';
import type { WorkspaceRole } from '../../shared/types';
import * as workspaceRepo from './workspace.repository';
import * as membershipRepo from './membership.repository';
import { findByEmail } from '../auth/user.repository';
import type { Workspace } from './workspace.repository';
import type { WorkspaceMembership } from './membership.repository';

export async function create(name: string, ownerId: string): Promise<Workspace> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slug = workspaceRepo.generateSlug(name);
    const wsResult = await client.query(
      `INSERT INTO workspaces (name, slug, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, owner_id, plan_type, created_at, updated_at`,
      [name, slug, ownerId],
    );
    const row = wsResult.rows[0];
    const workspace: Workspace = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      planType: row.plan_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    await client.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role)
       VALUES ($1, $2, 'owner')`,
      [ownerId, workspace.id],
    );

    await client.query(
      `INSERT INTO billing (workspace_id, plan_type, credit_balance, credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge, auto_recharge_threshold, auto_recharge_amount)
       VALUES ($1, 'free', 0, 0, NOW(), NOW() + INTERVAL '30 days', false, 0, 0)`,
      [workspace.id],
    );

    await client.query('COMMIT');
    return workspace;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function list(userId: string): Promise<Workspace[]> {
  return workspaceRepo.findAllForUser(userId);
}

export async function getById(workspaceId: string, _userId: string): Promise<Workspace> {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) {
    throw new NotFoundError('Workspace not found');
  }
  return workspace;
}

export async function update(workspaceId: string, data: { name?: string }): Promise<Workspace> {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) {
    throw new NotFoundError('Workspace not found');
  }
  return workspaceRepo.updateWorkspace(workspaceId, data);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const workspace = await workspaceRepo.findById(workspaceId);
  if (!workspace) {
    throw new NotFoundError('Workspace not found');
  }
  await workspaceRepo.deleteWorkspace(workspaceId);
}

export async function addMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<WorkspaceMembership> {
  const user = await findByEmail(email);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const existing = await membershipRepo.findByUserAndWorkspace(user.id, workspaceId);
  if (existing) {
    throw new ConflictError('User is already a member of this workspace');
  }

  return membershipRepo.create(user.id, workspaceId, role);
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const membership = await membershipRepo.findByUserAndWorkspace(userId, workspaceId);
  if (!membership) {
    throw new NotFoundError('Membership not found');
  }

  if (membership.role === 'owner') {
    const ownerCount = await membershipRepo.countOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new AuthorizationError('Cannot remove the last owner of a workspace');
    }
  }

  await membershipRepo.deleteMembership(userId, workspaceId);
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const membership = await membershipRepo.findByUserAndWorkspace(userId, workspaceId);
  if (!membership) {
    throw new NotFoundError('Membership not found');
  }

  if (membership.role === 'owner' && role !== 'owner') {
    const ownerCount = await membershipRepo.countOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new AuthorizationError('Cannot change role of the last owner');
    }
  }

  await membershipRepo.updateRole(userId, workspaceId, role);
}
