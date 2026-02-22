import { Request, Response, NextFunction } from 'express';
import * as integrationService from './integration.service';
import { successResponse } from '../../shared/envelope';

export function createIntegrationController() {
  return {
    async listAvailable(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const integrations = integrationService.listAvailableIntegrations();
        res.status(200).json(successResponse(integrations));
      } catch (err) {
        next(err);
      }
    },

    async listConnected(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await integrationService.listConnected(req.params.id);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async connect(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { successRedirectUrl } = req.body;
        const result = integrationService.startOAuthFlow(req.params.id, req.params.slug, successRedirectUrl);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async oauthCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { code, state } = req.query as { code: string; state: string };
        const result = await integrationService.handleOAuthCallback(req.params.slug, code, state);
        res.redirect(result.redirectUrl);
      } catch (err) {
        next(err);
      }
    },

    async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await integrationService.disconnect(req.params.id, req.params.slug);
        res.status(200).json(successResponse({ disconnected: true }));
      } catch (err) {
        next(err);
      }
    },

    async getFieldMappings(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const mappings = await integrationService.getFieldMappings(req.params.id, req.params.slug);
        res.status(200).json(successResponse(mappings));
      } catch (err) {
        next(err);
      }
    },

    async updateFieldMappings(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const mappings = await integrationService.updateFieldMappings(
          req.params.id,
          req.params.slug,
          req.body.mappings,
        );
        res.status(200).json(successResponse(mappings));
      } catch (err) {
        next(err);
      }
    },

    async push(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { entity, records } = req.body;
        const result = await integrationService.pushRecords(req.params.id, req.params.slug, entity, records);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async pull(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { entity, limit } = req.body;
        const records = await integrationService.pullRecords(req.params.id, req.params.slug, entity, limit);
        res.status(200).json(successResponse(records));
      } catch (err) {
        next(err);
      }
    },

    async syncHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const limit = Number(req.query.limit) || 20;
        const history = await integrationService.getSyncHistory(req.params.id, req.params.slug, limit);
        res.status(200).json(successResponse(history));
      } catch (err) {
        next(err);
      }
    },
  };
}
