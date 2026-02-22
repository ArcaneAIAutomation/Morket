import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import { createSearchController } from './search.controller';
import { createSearchService } from './search.service';
import { createSearchCache } from './search.cache';
import {
  searchQuerySchema,
  suggestQuerySchema,
  workspaceParamsSchema,
} from './search.schemas';

/**
 * Creates search route factories.
 *
 * Returns two routers:
 * - searchRoutes: workspace-scoped search endpoints (mergeParams for :id)
 * - adminSearchRoutes: admin-only health/index monitoring endpoints
 */
export function createSearchRoutes(): { searchRoutes: Router; adminSearchRoutes: Router } {
  const cache = createSearchCache();
  const service = createSearchService(cache);
  const controller = createSearchController(service);

  // --- Workspace-scoped search routes ---
  const searchRoutes = Router({ mergeParams: true });

  // POST /search — full-text search (member+)
  searchRoutes.post(
    '/',
    validate({ params: workspaceParamsSchema, body: searchQuerySchema }),
    requireRole('member'),
    controller.search,
  );

  // GET /search/suggest?q=prefix — autocomplete (member+)
  searchRoutes.get(
    '/suggest',
    validate({ params: workspaceParamsSchema, query: suggestQuerySchema }),
    requireRole('member'),
    controller.suggest,
  );

  // POST /search/reindex — trigger full reindex (admin)
  searchRoutes.post(
    '/reindex',
    validate({ params: workspaceParamsSchema }),
    requireRole('admin'),
    controller.reindex,
  );

  // GET /search/reindex/status — reindex job status (admin)
  searchRoutes.get(
    '/reindex/status',
    validate({ params: workspaceParamsSchema }),
    requireRole('admin'),
    controller.getReindexStatus,
  );

  // --- Admin search routes ---
  const adminSearchRoutes = Router();

  // GET /admin/search/health — cluster health (admin)
  adminSearchRoutes.get(
    '/health',
    requireRole('admin'),
    controller.getClusterHealth,
  );

  // GET /admin/search/indices — index list (admin)
  adminSearchRoutes.get(
    '/indices',
    requireRole('admin'),
    controller.getIndexList,
  );

  return { searchRoutes, adminSearchRoutes };
}
