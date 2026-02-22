import { Request, Response, NextFunction } from 'express';
import type { SearchService } from './search.service';
import { successResponse } from '../../shared/envelope';

export function createSearchController(service: SearchService) {
  /**
   * POST /api/v1/workspaces/:id/search
   * Full-text search within a workspace.
   */
  async function search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.params.id;
      const startTime = Date.now();
      const result = await service.search(workspaceId, req.body);
      const executionTimeMs = Date.now() - startTime;

      res.status(200).json({
        success: true,
        data: result.data,
        error: null,
        meta: {
          ...result.meta,
          executionTimeMs,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/workspaces/:id/search/suggest?q=prefix
   * Autocomplete suggestions within a workspace.
   */
  async function suggest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.params.id;
      const prefix = req.query.q as string;
      const suggestions = await service.suggest(workspaceId, prefix);

      res.status(200).json(successResponse(suggestions));
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/workspaces/:id/search/reindex
   * Triggers a full reindex for a workspace. Returns 202 Accepted.
   */
  async function reindex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.params.id;
      const job = await service.reindexWorkspace(workspaceId);

      res.status(202).json({
        success: true,
        data: job,
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/workspaces/:id/search/reindex/status
   * Returns the latest reindex job status for a workspace.
   */
  async function getReindexStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.params.id;
      const status = await service.getReindexStatus(workspaceId);

      res.status(200).json(successResponse(status));
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/admin/search/health
   * Returns OpenSearch cluster health.
   */
  async function getClusterHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await service.getClusterHealth();
      res.status(200).json(successResponse(health));
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/admin/search/indices
   * Returns list of workspace search indices.
   */
  async function getIndexList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const indices = await service.getIndexList();
      res.status(200).json(successResponse(indices));
    } catch (err) {
      next(err);
    }
  }

  return {
    search,
    suggest,
    reindex,
    getReindexStatus,
    getClusterHealth,
    getIndexList,
  };
}
