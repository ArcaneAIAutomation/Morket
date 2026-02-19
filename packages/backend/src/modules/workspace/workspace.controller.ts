import { Request, Response, NextFunction } from 'express';
import * as workspaceService from './workspace.service';
import { successResponse } from '../../shared/envelope';

export interface WorkspaceController {
  create(req: Request, res: Response, next: NextFunction): Promise<void>;
  list(req: Request, res: Response, next: NextFunction): Promise<void>;
  getById(req: Request, res: Response, next: NextFunction): Promise<void>;
  update(req: Request, res: Response, next: NextFunction): Promise<void>;
  delete(req: Request, res: Response, next: NextFunction): Promise<void>;
  addMember(req: Request, res: Response, next: NextFunction): Promise<void>;
  removeMember(req: Request, res: Response, next: NextFunction): Promise<void>;
  updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void>;
}

export function createWorkspaceController(): WorkspaceController {
  return {
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { name } = req.body;
        const workspace = await workspaceService.create(name, req.user!.userId);
        res.status(201).json(successResponse(workspace));
      } catch (err) {
        next(err);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workspaces = await workspaceService.list(req.user!.userId);
        res.status(200).json(successResponse(workspaces));
      } catch (err) {
        next(err);
      }
    },

    async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workspace = await workspaceService.getById(req.params.id, req.user!.userId);
        res.status(200).json(successResponse(workspace));
      } catch (err) {
        next(err);
      }
    },

    async update(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workspace = await workspaceService.update(req.params.id, req.body);
        res.status(200).json(successResponse(workspace));
      } catch (err) {
        next(err);
      }
    },

    async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await workspaceService.deleteWorkspace(req.params.id);
        res.status(200).json(successResponse({ message: 'Workspace deleted' }));
      } catch (err) {
        next(err);
      }
    },

    async addMember(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { email, role } = req.body;
        const membership = await workspaceService.addMember(req.params.id, email, role);
        res.status(201).json(successResponse(membership));
      } catch (err) {
        next(err);
      }
    },

    async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await workspaceService.removeMember(req.params.id, req.params.userId);
        res.status(200).json(successResponse({ message: 'Member removed' }));
      } catch (err) {
        next(err);
      }
    },

    async updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { role } = req.body;
        await workspaceService.updateMemberRole(req.params.id, req.params.userId, role);
        res.status(200).json(successResponse({ message: 'Role updated' }));
      } catch (err) {
        next(err);
      }
    },
  };
}
