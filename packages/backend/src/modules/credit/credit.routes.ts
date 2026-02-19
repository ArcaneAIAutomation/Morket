import { Router } from 'express';
import { createCreditController } from './credit.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  addCreditsSchema,
  getTransactionsQuerySchema,
  workspaceParamsSchema,
} from './credit.schemas';

export function createCreditRoutes(): Router {
  const router = Router({ mergeParams: true });
  const controller = createCreditController();

  // GET /api/v1/workspaces/:id/billing  (member+)
  router.get(
    '/',
    validate({ params: workspaceParamsSchema }),
    requireRole('member'),
    controller.getBilling,
  );

  // POST /api/v1/workspaces/:id/billing/credits  (owner only)
  router.post(
    '/credits',
    validate({ params: workspaceParamsSchema, body: addCreditsSchema }),
    requireRole('owner'),
    controller.addCredits,
  );

  // GET /api/v1/workspaces/:id/billing/transactions  (member+)
  router.get(
    '/transactions',
    validate({ params: workspaceParamsSchema, query: getTransactionsQuerySchema }),
    requireRole('member'),
    controller.getTransactions,
  );

  return router;
}
