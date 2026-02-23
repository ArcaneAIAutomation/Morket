import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { tracingMiddleware } from './middleware/tracing';
import { generalRateLimiter } from './middleware/rateLimiter';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
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

/**
 * Middleware to restrict monitoring endpoints in production.
 * Requires a valid X-Monitoring-Key header when MONITORING_API_KEY is set
 * and NODE_ENV is 'production'. In non-production or when no key is configured,
 * access is unrestricted.
 */
export function requireMonitoringKey(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') return next();

  const monitoringKey = process.env.MONITORING_API_KEY;
  if (!monitoringKey) return next(); // No key configured = no restriction

  const provided = req.headers['x-monitoring-key'];
  if (provided === monitoringKey) return next();

  res.status(403).json(errorResponse('FORBIDDEN', 'Access denied'));
}

export interface AppConfig {
  corsOrigins: string[];
  jwtSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;
  encryptionMasterKey: string;
}

export function createApp(config: AppConfig): express.Express {
  const app = express();

  // Disable X-Powered-By header (Express sets it by default)
  app.disable('x-powered-by');

  // Middleware pipeline (order matters)
  // 1. requestId
  app.use(requestIdMiddleware);
  // 1.5 security headers
  app.use(securityHeadersMiddleware);
  // 2. tracing (metrics recording)
  app.use(tracingMiddleware);
  // 3. requestLogger
  app.use(requestLoggerMiddleware);
  // 3. helmet
  app.use(helmet());
  // 4. cors — explicit allowlist of origins
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., server-to-server, curl, health checks)
      if (!origin) {
        return callback(null, true);
      }
      if (config.corsOrigins.includes(origin)) {
        return callback(null, origin);
      }
      return callback(null, false);
    },
  }));
  // 5. rateLimiter (general 100/min)
  app.use(generalRateLimiter);

  // 5.5 Stripe webhook route (must receive raw body before JSON parser)
  const { planRoutes, workspaceBillingRoutes, webhookRoutes } = createBillingRoutes();
  app.use('/api/v1/billing', webhookRoutes);

  // 6. json body parser (1MB limit for JSON payloads)
  app.use(express.json({ limit: '1mb' }));

  // 6.5 raw body parser (10MB limit for file uploads)
  app.use(express.raw({ limit: '10mb', type: 'application/octet-stream' }));

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

  // Readiness check (restricted in production via X-Monitoring-Key)
  app.get('/api/v1/readiness', requireMonitoringKey, async (_req, res) => {
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

  // Metrics endpoint (restricted in production via X-Monitoring-Key)
  app.get('/api/v1/metrics', requireMonitoringKey, (_req, res) => {
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
  const { providerRoutes, jobRoutes, webhookRoutes: enrichmentWebhookRoutes, recordRoutes } = createEnrichmentRoutes();

  // Provider routes (authenticated)
  app.use('/api/v1/providers', authenticate, providerRoutes);

  // Enrichment job routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/enrichment-jobs', authenticate, jobRoutes);

  // Webhook routes (authenticated, workspace-scoped)
  app.use('/api/v1/workspaces/:id/webhooks', authenticate, enrichmentWebhookRoutes);

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
