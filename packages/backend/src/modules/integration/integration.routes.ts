import { Router } from 'express';
import { createIntegrationController } from './integration.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  integrationParamsSchema,
  connectBodySchema,
  fieldMappingsBodySchema,
  pushBodySchema,
  pullBodySchema,
  syncHistoryQuerySchema,
  callbackQuerySchema,
} from './integration.schemas';

export function createIntegrationRoutes(): {
  publicRoutes: Router;
  workspaceRoutes: Router;
} {
  const controller = createIntegrationController();

  // Public routes: /api/v1/integrations
  const publicRoutes = Router();

  // GET /api/v1/integrations — list available integrations
  publicRoutes.get('/', controller.listAvailable);

  // GET /api/v1/integrations/callback/:slug — OAuth callback (browser redirect)
  publicRoutes.get(
    '/callback/:slug',
    validate({ query: callbackQuerySchema }),
    controller.oauthCallback,
  );

  // Workspace-scoped routes: /api/v1/workspaces/:id/integrations
  const workspaceRoutes = Router({ mergeParams: true });

  // GET / — list connected integrations
  workspaceRoutes.get(
    '/',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.listConnected,
  );

  // POST /:slug/connect — start OAuth flow
  workspaceRoutes.post(
    '/:slug/connect',
    validate({ params: integrationParamsSchema, body: connectBodySchema }),
    requireRole('owner'),
    controller.connect,
  );

  // DELETE /:slug — disconnect integration
  workspaceRoutes.delete(
    '/:slug',
    validate({ params: integrationParamsSchema }),
    requireRole('owner'),
    controller.disconnect,
  );

  // GET /:slug/field-mappings — get field mappings
  workspaceRoutes.get(
    '/:slug/field-mappings',
    validate({ params: integrationParamsSchema }),
    requireRole('member'),
    controller.getFieldMappings,
  );

  // PUT /:slug/field-mappings — update field mappings
  workspaceRoutes.put(
    '/:slug/field-mappings',
    validate({ params: integrationParamsSchema, body: fieldMappingsBodySchema }),
    requireRole('owner'),
    controller.updateFieldMappings,
  );

  // POST /:slug/push — push records to CRM
  workspaceRoutes.post(
    '/:slug/push',
    validate({ params: integrationParamsSchema, body: pushBodySchema }),
    requireRole('member'),
    controller.push,
  );

  // POST /:slug/pull — pull records from CRM
  workspaceRoutes.post(
    '/:slug/pull',
    validate({ params: integrationParamsSchema, body: pullBodySchema }),
    requireRole('member'),
    controller.pull,
  );

  // GET /:slug/sync-history — get sync history
  workspaceRoutes.get(
    '/:slug/sync-history',
    validate({ params: integrationParamsSchema, query: syncHistoryQuerySchema }),
    requireRole('member'),
    controller.syncHistory,
  );

  return { publicRoutes, workspaceRoutes };
}
