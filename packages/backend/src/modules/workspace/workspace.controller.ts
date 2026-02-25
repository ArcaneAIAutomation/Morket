import { Request, Response, NextFunction } from 'express';
import * as workspaceService from './workspace.service';
import * as optionsService from './options.service';
import { resolveServiceGroup } from './options.service';
import { successResponse } from '../../shared/envelope';
import { env } from '../../config/env';

export interface WorkspaceController {
  create(req: Request, res: Response, next: NextFunction): Promise<void>;
  list(req: Request, res: Response, next: NextFunction): Promise<void>;
  getById(req: Request, res: Response, next: NextFunction): Promise<void>;
  update(req: Request, res: Response, next: NextFunction): Promise<void>;
  delete(req: Request, res: Response, next: NextFunction): Promise<void>;
  listMembers(req: Request, res: Response, next: NextFunction): Promise<void>;
  addMember(req: Request, res: Response, next: NextFunction): Promise<void>;
  removeMember(req: Request, res: Response, next: NextFunction): Promise<void>;
  updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void>;
  listOptions(req: Request, res: Response, next: NextFunction): Promise<void>;
  upsertOption(req: Request, res: Response, next: NextFunction): Promise<void>;
  deleteOption(req: Request, res: Response, next: NextFunction): Promise<void>;
  testOptionConnection(req: Request, res: Response, next: NextFunction): Promise<void>;
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

    async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const members = await workspaceService.listMembers(req.params.id);
        res.status(200).json(successResponse(members));
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

    async listOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const configs = await optionsService.listConfigurations(req.params.id, env.ENCRYPTION_MASTER_KEY);
        res.status(200).json(successResponse(configs));
      } catch (err) {
        next(err);
      }
    },

    async upsertOption(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await optionsService.upsertConfiguration(
          req.params.id,
          req.params.serviceKey,
          resolveServiceGroup(req.params.serviceKey),
          req.body.values,
          req.user!.userId,
          env.ENCRYPTION_MASTER_KEY,
        );
        res.status(200).json(successResponse({ message: 'Configuration saved' }));
      } catch (err) {
        next(err);
      }
    },

    async deleteOption(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await optionsService.deleteConfiguration(req.params.id, req.params.serviceKey);
        res.status(200).json(successResponse({ message: 'Configuration deleted' }));
      } catch (err) {
        next(err);
      }
    },

    async testOptionConnection(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await optionsService.testConnection(req.params.id, req.params.serviceKey, env.ENCRYPTION_MASTER_KEY);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },
  };
}
