import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { tracingMiddleware } from './middleware/tracing';
import { generalRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { createAuthMiddleware } from './middleware/auth';
import { successResponse, errorResponse } from './shared/envelope';
import { healthCheck as clickHouseHealthCheck } from './clickhouse/client';
import { healthCheck as openSearchHealthCheck } from './modules/search/opensearch/client';
import { redisHealthCheck } from './cache/redis';
import { getMetrics } from './observability/metrics';
import { createAuthRoutes } from './modules/auth/auth.routes';
import { createWorkspaceRoutes } from './modules/workspace/workspace.routes';
import { createCredentialRoutes } from './modules/credential/credential.routes';
import { createCreditRoutes } from './modules/credit/credit.routes';
import { createEnrichmentRoutes } from './modules/enrichment/enrichment.routes';
import { createDLQRoutes } from './modules/replication/dlq.routes';
import { createAnalyticsRoutes } from './modules/analytics/analytics.routes';
import { createSearchRoutes } from './modules/search/search.routes';
import { createBillingRoutes } from './modules/billing/billing.routes';
import { createIntegrationRoutes } from './modules/integration/integration.routes';
import { createDataOpsRoutes } from './modules/data-ops/data-ops.routes';
import { createWorkflowRoutes } from './modules/workflow/workflow.routes';
import { createAiRoutes } from './modules/ai/ai.routes';
import { createTeamRoutes } from './modules/team/team.routes';

export interface AppConfig {
  corsOrigin: string;
  jwtSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;
  encryptionMasterKey: string;
}

export function createApp(config: AppConfig): express.Express {
  const app = express();

  // Middleware pipeline (order matters)
  // 1. requestId
  app.use(requestIdMiddleware);
  // 2. tracing (metrics recording)
  app.use(tracingMiddleware);
  // 3. requestLogger
  app.use(requestLoggerMiddleware);
  // 3. helmet
  app.use(helmet());
  // 4. cors
  app.use(cors({ origin: config.corsOrigin }));
  // 5. rateLimiter (general 100/min)
  app.use(generalRateLimiter);

  // 5.5 Stripe webhook route (must receive raw body before JSON parser)
  const { planRoutes, workspaceBillingRoutes, webhookRoutes } = createBillingRoutes();
  app.use('/api/v1/billing', webhookRoutes);

  // 6. json body parser
  app.use(express.json());

  // 7. routes
  // Health check (public)
  app.get('/api/v1/health', async (_req, res) => {
    const chHealthy = await clickHouseHealthCheck();

    let osStatus: string = 'unavailable';
    try {
      const osHealth = await openSearchHealthCheck();
      osStatus = osHealth.status;
    } catch {
      // Non-blocking — report as unavailable
    }

    const redisHealthy = await redisHealthCheck();

    res.json(successResponse({
      status: 'ok',
      clickhouse: chHealthy ? 'ok' : 'unavailable',
      opensearch: osStatus,
      redis: redisHealthy ? 'ok' : 'unavailable',
    }));
  });

  // Readiness check (public — for container orchestrators)
  app.get('/api/v1/readiness', async (_req, res) => {
    const chHealthy = await clickHouseHealthCheck();
    const redisHealthy = await redisHealthCheck();

    let osStatus: string = 'unavailable';
    try {
      const osHealth = await openSearchHealthCheck();
      osStatus = osHealth.status;
    } catch {
      // Non-blocking
    }

    const allHealthy = chHealthy && redisHealthy && osStatus !== 'unavailable';
    res.status(allHealthy ? 200 : 503).json(successResponse({
      ready: allHealthy,
      postgres: 'ok', // If we got here, Express is running = DB pool is initialized
      clickhouse: chHealthy ? 'ok' : 'unavailable',
      opensearch: osStatus,
      redis: redisHealthy ? 'ok' : 'unavailable',
    }));
  });

  // Metrics endpoint (public — for monitoring systems)
  app.get('/api/v1/metrics', (_req, res) => {
    res.json(successResponse(getMetrics()));
  });

  // Auth routes (public — rate limiting handled within auth router at 5/min)
  app.use('/api/v1/auth', createAuthRoutes({
    jwtSecret: config.jwtSecret,
    jwtAccessExpiry: config.jwtAccessExpiry,
    jwtRefreshExpiry: config.jwtRefreshExpiry,
  }));

  // JWT authentication scoped to protected route prefixes only
  const authenticate = createAuthMiddleware(config.jwtSecret);

  // Workspace routes (authenticated)
  app.use('/api/v1/workspaces', authenticate, createWorkspaceRoutes());

  // Nested credential routes: /api/v1/workspaces/:id/credentials
  app.use('/api/v1/workspaces/:id/credentials', authenticate, createCredentialRoutes(config.encryptionMasterKey));

  // Nested billing/credit routes: /api/v1/workspaces/:id/billing
  app.use('/api/v1/workspaces/:id/billing', authenticate, createCreditRoutes());

  // Stripe billing routes: checkout, portal, credit purchase, invoices (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/billing', authenticate, workspaceBillingRoutes);

  // Public billing routes: plan listing
  app.use('/api/v1/billing', planRoutes);

  // Enrichment routes
  const { providerRoutes, jobRoutes, webhookRoutes, recordRoutes } = createEnrichmentRoutes();

  // Provider routes (authenticated)
  app.use('/api/v1/providers', authenticate, providerRoutes);

  // Enrichment job routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/enrichment-jobs', authenticate, jobRoutes);

  // Webhook routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/webhooks', authenticate, webhookRoutes);

  // Enrichment record routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/enrichment-records', authenticate, recordRoutes);

  // Analytics routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/analytics', authenticate, createAnalyticsRoutes());

  // Search routes
  const { searchRoutes, adminSearchRoutes } = createSearchRoutes();

  // Workspace-scoped search routes (authenticated)
  app.use('/api/v1/workspaces/:id/search', authenticate, searchRoutes);

  // Admin search routes (authenticated, admin check inside router)
  app.use('/api/v1/admin/search', authenticate, adminSearchRoutes);

  // Admin DLQ routes (authenticated, admin only — admin check is inside DLQ router)
  app.use('/api/v1/admin/analytics', authenticate, createDLQRoutes());

  // Integration routes
  const { publicRoutes: integrationPublicRoutes, workspaceRoutes: integrationWorkspaceRoutes } = createIntegrationRoutes();

  // Public integration routes: list available, OAuth callback
  app.use('/api/v1/integrations', integrationPublicRoutes);

  // Workspace-scoped integration routes (authenticated)
  app.use('/api/v1/workspaces/:id/integrations', authenticate, integrationWorkspaceRoutes);

  // Data operations routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/data-ops', authenticate, createDataOpsRoutes());

  // Workflow builder routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/workflows', authenticate, createWorkflowRoutes());

  // AI/ML intelligence routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/ai', authenticate, createAiRoutes());

  // Team & collaboration routes
  const { workspaceRoutes: teamWorkspaceRoutes, publicRoutes: teamPublicRoutes } = createTeamRoutes();
  app.use('/api/v1/workspaces/:id/team', authenticate, teamWorkspaceRoutes);
  app.use('/api/v1/invitations', teamPublicRoutes);

  // 404 catch-all for unknown routes
  app.use((_req, res) => {
    res.status(404).json(errorResponse('NOT_FOUND', 'The requested resource was not found'));
  });

  // 8. errorHandler (must be last)
  app.use(errorHandler);

  return app;
}
