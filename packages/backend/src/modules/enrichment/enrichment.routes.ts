import { Router } from 'express';
import { createEnrichmentController } from './enrichment.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  createJobBodySchema,
  jobParamsSchema,
  recordParamsSchema,
  paginationQuerySchema,
  createWebhookBodySchema,
  webhookParamsSchema,
  workspaceParamsSchema,
  providerParamsSchema,
} from './enrichment.schemas';

export function createEnrichmentRoutes(): {
  providerRoutes: Router;
  jobRoutes: Router;
  webhookRoutes: Router;
  recordRoutes: Router;
} {
  const controller = createEnrichmentController();

  // --- Provider routes: /api/v1/providers ---
  const providerRoutes = Router({ mergeParams: true });

  // GET /api/v1/providers
  providerRoutes.get('/', controller.listProviders);

  // GET /api/v1/providers/:providerSlug
  providerRoutes.get(
    '/:providerSlug',
    validate({ params: providerParamsSchema }),
    controller.getProvider,
  );

  // --- Job routes: /api/v1/workspaces/:id/enrichment-jobs ---
  const jobRoutes = Router({ mergeParams: true });

  // POST /api/v1/workspaces/:id/enrichment-jobs
  jobRoutes.post(
    '/',
    validate({ params: workspaceParamsSchema, body: createJobBodySchema }),
    requireRole('member'),
    controller.createJob,
  );

  // GET /api/v1/workspaces/:id/enrichment-jobs
  jobRoutes.get(
    '/',
    validate({ params: workspaceParamsSchema, query: paginationQuerySchema }),
    requireRole('member'),
    controller.listJobs,
  );

  // GET /api/v1/workspaces/:id/enrichment-jobs/:jobId
  jobRoutes.get(
    '/:jobId',
    validate({ params: jobParamsSchema }),
    requireRole('member'),
    controller.getJob,
  );

  // POST /api/v1/workspaces/:id/enrichment-jobs/:jobId/cancel
  jobRoutes.post(
    '/:jobId/cancel',
    validate({ params: jobParamsSchema }),
    requireRole('member'),
    controller.cancelJob,
  );

  // GET /api/v1/workspaces/:id/enrichment-jobs/:jobId/records
  jobRoutes.get(
    '/:jobId/records',
    validate({ params: jobParamsSchema, query: paginationQuerySchema }),
    requireRole('member'),
    controller.listRecords,
  );

  // --- Record routes: /api/v1/workspaces/:id/enrichment-records ---
  const recordRoutes = Router({ mergeParams: true });

  // GET /api/v1/workspaces/:id/enrichment-records/:recordId
  recordRoutes.get(
    '/:recordId',
    validate({ params: recordParamsSchema }),
    requireRole('member'),
    controller.getRecord,
  );

  // --- Webhook routes: /api/v1/workspaces/:id/webhooks ---
  const webhookRoutes = Router({ mergeParams: true });

  // POST /api/v1/workspaces/:id/webhooks
  webhookRoutes.post(
    '/',
    validate({ params: workspaceParamsSchema, body: createWebhookBodySchema }),
    requireRole('admin'),
    controller.createWebhook,
  );

  // GET /api/v1/workspaces/:id/webhooks
  webhookRoutes.get(
    '/',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.listWebhooks,
  );

  // DELETE /api/v1/workspaces/:id/webhooks/:webhookId
  webhookRoutes.delete(
    '/:webhookId',
    validate({ params: webhookParamsSchema }),
    requireRole('admin'),
    controller.deleteWebhook,
  );

  return { providerRoutes, jobRoutes, webhookRoutes, recordRoutes };
}
