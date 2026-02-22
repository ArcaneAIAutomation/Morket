import { Router } from 'express';
import { createTeamController } from './team.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  paginationQuerySchema,
  auditFilterQuerySchema,
  inviteBodySchema,
  invitationTokenParamsSchema,
} from './team.schemas';

export function createTeamRoutes(): {
  workspaceRoutes: Router;
  publicRoutes: Router;
} {
  const controller = createTeamController();

  // Workspace-scoped routes: /api/v1/workspaces/:id/team/
  const workspaceRoutes = Router({ mergeParams: true });

  // Activity feed
  workspaceRoutes.get(
    '/activity',
    validate({ params: workspaceParamsSchema, query: paginationQuerySchema }),
    requireRole('member'),
    controller.listActivity,
  );

  // Audit log
  workspaceRoutes.get(
    '/audit',
    validate({ params: workspaceParamsSchema, query: auditFilterQuerySchema }),
    requireRole('member'),
    controller.listAuditLog,
  );

  workspaceRoutes.get(
    '/audit/export',
    validate({ params: workspaceParamsSchema, query: auditFilterQuerySchema }),
    requireRole('owner'),
    controller.exportAuditLog,
  );

  // Invitations
  workspaceRoutes.post(
    '/invitations',
    validate({ params: workspaceParamsSchema, body: inviteBodySchema }),
    requireRole('owner'),
    controller.invite,
  );

  workspaceRoutes.get(
    '/invitations',
    validate({ params: workspaceParamsSchema }),
    requireRole('owner'),
    controller.listInvitations,
  );

  // Public routes: invitation accept/decline (no auth required — token-based)
  const publicRoutes = Router();

  publicRoutes.post(
    '/:token/accept',
    validate({ params: invitationTokenParamsSchema }),
    controller.acceptInvitation,
  );

  publicRoutes.post(
    '/:token/decline',
    validate({ params: invitationTokenParamsSchema }),
    controller.declineInvitation,
  );

  return { workspaceRoutes, publicRoutes };
}
