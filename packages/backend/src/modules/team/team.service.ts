import crypto from 'crypto';
import * as teamRepo from './team.repository';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors';

// --- Activity Feed ---

export async function logActivity(data: {
  workspaceId: string; actorId?: string; action: string;
  resourceType?: string; resourceId?: string; metadata?: Record<string, unknown>;
}) {
  return teamRepo.createActivity(data);
}

export async function listActivity(workspaceId: string, page: number, limit: number) {
  return teamRepo.listActivity(workspaceId, page, limit);
}

// --- Audit Log ---

export async function logAudit(data: {
  workspaceId: string; actorId?: string; action: string; resourceType: string;
  resourceId?: string; metadata?: Record<string, unknown>; ipAddress?: string;
}) {
  return teamRepo.createAuditEntry(data);
}

export async function listAuditLog(
  workspaceId: string,
  filters: { action?: string; actorId?: string; dateFrom?: string; dateTo?: string },
  page: number,
  limit: number,
) {
  return teamRepo.listAuditLog(workspaceId, filters, page, limit);
}

export async function exportAuditLog(
  workspaceId: string,
  filters: { action?: string; actorId?: string; dateFrom?: string; dateTo?: string },
) {
  const { entries } = await teamRepo.listAuditLog(workspaceId, filters, 1, 10000);
  if (entries.length === 0) return '';

  const headers = ['id', 'action', 'resource_type', 'resource_id', 'actor_id', 'ip_address', 'created_at'];
  const lines = [headers.join(',')];
  for (const e of entries) {
    lines.push([e.id, e.action, e.resourceType, e.resourceId ?? '', e.actorId ?? '', e.ipAddress ?? '', e.createdAt.toISOString()].join(','));
  }
  return lines.join('\n');
}

// --- Invitations ---

export async function inviteUser(workspaceId: string, email: string, role: string, invitedBy: string) {
  // Check for existing pending invitation
  const pending = await teamRepo.listPendingInvitations(workspaceId);
  const existing = pending.find((i) => i.email === email);
  if (existing) throw new ConflictError(`An invitation for ${email} is already pending`);

  const token = crypto.randomBytes(32).toString('hex');
  return teamRepo.createInvitation(workspaceId, email, role, token, invitedBy);
}

export async function acceptInvitation(token: string) {
  const invitation = await teamRepo.findInvitationByToken(token);
  if (!invitation) throw new NotFoundError('Invitation not found');
  if (invitation.status !== 'pending') throw new ValidationError('Invitation is no longer pending');
  if (new Date(invitation.expiresAt) < new Date()) throw new ValidationError('Invitation has expired');

  await teamRepo.updateInvitationStatus(token, 'accepted');
  return { workspaceId: invitation.workspaceId, role: invitation.role, email: invitation.email };
}

export async function declineInvitation(token: string) {
  const invitation = await teamRepo.findInvitationByToken(token);
  if (!invitation) throw new NotFoundError('Invitation not found');
  if (invitation.status !== 'pending') throw new ValidationError('Invitation is no longer pending');

  await teamRepo.updateInvitationStatus(token, 'declined');
}

export async function listPendingInvitations(workspaceId: string) {
  return teamRepo.listPendingInvitations(workspaceId);
}
