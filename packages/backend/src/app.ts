import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { generalRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { createAuthMiddleware } from './middleware/auth';
import { successResponse, errorResponse } from './shared/envelope';
import { createAuthRoutes } from './modules/auth/auth.routes';
import { createWorkspaceRoutes } from './modules/workspace/workspace.routes';
import { createCredentialRoutes } from './modules/credential/credential.routes';
import { createCreditRoutes } from './modules/credit/credit.routes';
import { createEnrichmentRoutes } from './modules/enrichment/enrichment.routes';

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
  // 2. requestLogger
  app.use(requestLoggerMiddleware);
  // 3. helmet
  app.use(helmet());
  // 4. cors
  app.use(cors({ origin: config.corsOrigin }));
  // 5. rateLimiter (general 100/min)
  app.use(generalRateLimiter);
  // 6. json body parser
  app.use(express.json());

  // 7. routes
  // Health check (public)
  app.get('/api/v1/health', (_req, res) => {
    res.json(successResponse({ status: 'ok' }));
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

  // 404 catch-all for unknown routes
  app.use((_req, res) => {
    res.status(404).json(errorResponse('NOT_FOUND', 'The requested resource was not found'));
  });

  // 8. errorHandler (must be last)
  app.use(errorHandler);

  return app;
}
