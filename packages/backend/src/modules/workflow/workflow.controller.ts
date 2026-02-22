import { Request, Response, NextFunction } from 'express';
import * as workflowService from './workflow.service';
import { successResponse } from '../../shared/envelope';

export function createWorkflowController() {
  return {
    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workflows = await workflowService.listWorkflows(req.params.id);
        res.status(200).json(successResponse(workflows));
      } catch (err) { next(err); }
    },

    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const userId = (req as unknown as { user?: { id: string } }).user?.id ?? '';
        const workflow = await workflowService.createWorkflow(req.params.id, userId, req.body);
        res.status(201).json(successResponse(workflow));
      } catch (err) { next(err); }
    },

    async get(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workflow = await workflowService.getWorkflow(req.params.id, req.params.workflowId);
        res.status(200).json(successResponse(workflow));
      } catch (err) { next(err); }
    },

    async update(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const workflow = await workflowService.updateWorkflow(req.params.id, req.params.workflowId, req.body);
        res.status(200).json(successResponse(workflow));
      } catch (err) { next(err); }
    },

    async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await workflowService.deleteWorkflow(req.params.id, req.params.workflowId);
        res.status(200).json(successResponse({ deleted: true }));
      } catch (err) { next(err); }
    },

    async listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const versions = await workflowService.listVersions(req.params.id, req.params.workflowId);
        res.status(200).json(successResponse(versions));
      } catch (err) { next(err); }
    },

    async rollback(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await workflowService.rollback(req.params.id, req.params.workflowId, req.body.version);
        res.status(200).json(successResponse(result));
      } catch (err) { next(err); }
    },

    async execute(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await workflowService.executeWorkflow(req.params.id, req.params.workflowId);
        res.status(202).json(successResponse(result));
      } catch (err) { next(err); }
    },

    async listRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const result = await workflowService.listRuns(req.params.id, req.params.workflowId, page, limit);
        res.status(200).json(successResponse(result.runs, { page, limit, total: result.total }));
      } catch (err) { next(err); }
    },

    async getRun(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const run = await workflowService.getRun(req.params.id, req.params.workflowId, req.params.runId);
        res.status(200).json(successResponse(run));
      } catch (err) { next(err); }
    },

    async listTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const templates = await workflowService.listTemplates();
        res.status(200).json(successResponse(templates));
      } catch (err) { next(err); }
    },

    async cloneTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const userId = (req as unknown as { user?: { id: string } }).user?.id ?? '';
        const workflow = await workflowService.cloneTemplate(req.params.id, req.params.templateId, userId);
        res.status(201).json(successResponse(workflow));
      } catch (err) { next(err); }
    },

    async updateSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await workflowService.updateSchedule(
          req.params.id, req.params.workflowId, req.body.cron, req.body.enabled,
        );
        res.status(200).json(successResponse(result));
      } catch (err) { next(err); }
    },
  };
}
