import { Request, Response, NextFunction } from 'express';
import * as enrichmentService from './enrichment.service';
import * as webhookService from './webhook.service';
import { createProviderRegistry } from './provider-registry';
import { successResponse } from '../../shared/envelope';
import { NotFoundError } from '../../shared/errors';

export function createEnrichmentController() {
  const registry = createProviderRegistry();

  return {
    async listProviders(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const providers = registry.getAllProviders();
        res.status(200).json(successResponse(providers));
      } catch (err) {
        next(err);
      }
    },

    async getProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const provider = registry.getProvider(req.params.providerSlug);
        if (!provider) {
          throw new NotFoundError(`Provider "${req.params.providerSlug}" not found`);
        }
        res.status(200).json(successResponse(provider));
      } catch (err) {
        next(err);
      }
    },

    async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const job = await enrichmentService.createJob(
          req.params.id,
          req.user!.userId,
          req.body,
        );
        res.status(201).json(successResponse(job));
      } catch (err) {
        next(err);
      }
    },

    async listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 50);
        const { jobs, total } = await enrichmentService.listJobs(req.params.id, { page, limit });
        res.status(200).json(successResponse(jobs, { page, limit, total }));
      } catch (err) {
        next(err);
      }
    },

    async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const job = await enrichmentService.getJob(req.params.id, req.params.jobId);
        res.status(200).json(successResponse(job));
      } catch (err) {
        next(err);
      }
    },

    async cancelJob(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const job = await enrichmentService.cancelJob(req.params.id, req.params.jobId);
        res.status(200).json(successResponse(job));
      } catch (err) {
        next(err);
      }
    },

    async listRecords(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 50);
        const { records, total } = await enrichmentService.listRecords(
          req.params.id,
          req.params.jobId,
          { page, limit },
        );
        res.status(200).json(successResponse(records, { page, limit, total }));
      } catch (err) {
        next(err);
      }
    },

    async getRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const record = await enrichmentService.getRecord(req.params.id, req.params.recordId);
        res.status(200).json(successResponse(record));
      } catch (err) {
        next(err);
      }
    },

    async createWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { callbackUrl, eventTypes } = req.body;
        const subscription = await webhookService.createSubscription(
          req.params.id,
          req.user!.userId,
          callbackUrl,
          eventTypes,
        );
        res.status(201).json(successResponse(subscription));
      } catch (err) {
        next(err);
      }
    },

    async listWebhooks(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const subscriptions = await webhookService.listSubscriptions(req.params.id);
        res.status(200).json(successResponse(subscriptions));
      } catch (err) {
        next(err);
      }
    },

    async deleteWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        await webhookService.deleteSubscription(req.params.id, req.params.webhookId);
        res.status(200).json(successResponse({ message: 'Webhook subscription deleted' }));
      } catch (err) {
        next(err);
      }
    },
  };
}
