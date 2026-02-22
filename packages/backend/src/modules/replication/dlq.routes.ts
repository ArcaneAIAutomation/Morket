import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { AuthorizationError } from '../../shared/errors';
import { successResponse } from '../../shared/envelope';
import { query } from '../../shared/db';
import * as dlqRepo from './dlq.repository';

/**
 * Admin-only middleware for non-workspace-scoped routes.
 * Checks that the authenticated user is an admin or owner in at least one workspace.
 */
function requireSystemAdmin() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthorizationError('Authentication required');
      }

      const result = await query<{ role: string }>(
        `SELECT role FROM workspace_memberships
         WHERE user_id = $1 AND role IN ('admin', 'owner')
         LIMIT 1`,
        [req.user.userId],
      );

      if (result.rows.length === 0) {
        throw new AuthorizationError('Admin access required');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

const listDLQQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'replayed', 'exhausted']).optional(),
});

export function createDLQRoutes(): Router {
  const router = Router();

  // GET /dead-letter-queue — paginated list of DLQ events
  router.get(
    '/dead-letter-queue',
    requireSystemAdmin(),
    validate({ query: listDLQQuerySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { page, limit, status } = req.query as z.infer<typeof listDLQQuerySchema>;

        const result = await dlqRepo.listEvents({ page, limit, status });

        res.json(successResponse(result.items, {
          page: result.page,
          limit: result.limit,
          total: result.total,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /dead-letter-queue/replay — reset all exhausted events to pending
  router.post(
    '/dead-letter-queue/replay',
    requireSystemAdmin(),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const resetCount = await dlqRepo.resetExhausted();

        res.json(successResponse({ resetCount }));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
