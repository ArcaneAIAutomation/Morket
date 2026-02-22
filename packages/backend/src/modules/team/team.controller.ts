import { Request, Response, NextFunction } from 'express';
import * as teamService from './team.service';
import { successResponse } from '../../shared/envelope';

export function createTeamController() {
  return {
    async listActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const result = await teamService.listActivity(req.params.id, page, limit);
        res.status(200).json(successResponse(result.entries, { page, limit, total: result.total }));
      } catch (err) { next(err); }
    },

    async listAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const filters = {
          action: req.query.action as string | undefined,
          actorId: req.query.actorId as string | undefined,
          dateFrom: req.query.dateFrom as string | undefined,
          dateTo: req.query.dateTo as string | undefined,
        };
        const result = await teamService.listAuditLog(req.params.id, filters, page, limit);
        res.status(200).json(successResponse(result.entries, { page, limit, total: result.total }));
      } catch (err) { next(err); }
    },

    async exportAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const filters = {
          action: req.query.action as string | undefined,
          actorId: req.query.actorId as string | undefined,
          dateFrom: req.query.dateFrom as string | undefined,
          dateTo: req.query.dateTo as string | undefined,
        };
        const csv = await teamService.exportAuditLog(req.params.id, filters);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
        res.status(200).send(csv);
      } catch (err) { next(err); }
    },

    async invite(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const userId = (req as unknown as { user?: { id: string } }).user?.id ?? '';
        const invitation = await teamService.inviteUser(req.params.id, req.body.email, req.body.role, userId);
        res.status(201).json(successResponse({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt }));
      } catch (err) { next(err); }
    },

    async acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await teamService.acceptInvitation(req.params.token);
        res.status(200).json(successResponse(result));
      } catch (err) { next(err); }
    },

    async declineInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await teamService.declineInvitation(req.params.token);
        res.status(200).json(successResponse({ declined: true }));
      } catch (err) { next(err); }
    },

    async listInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const invitations = await teamService.listPendingInvitations(req.params.id);
        res.status(200).json(successResponse(invitations.map((i) => ({
          id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy, expiresAt: i.expiresAt, createdAt: i.createdAt,
        }))));
      } catch (err) { next(err); }
    },
  };
}
