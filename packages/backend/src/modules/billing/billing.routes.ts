import { Router } from 'express';
import express from 'express';
import { createBillingController } from './billing.controller';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import {
  workspaceParamsSchema,
  checkoutBodySchema,
  portalBodySchema,
  creditPurchaseBodySchema,
  invoicesQuerySchema,
} from './billing.schemas';

export function createBillingRoutes(): {
  planRoutes: Router;
  workspaceBillingRoutes: Router;
  webhookRoutes: Router;
} {
  const controller = createBillingController();

  // Public: GET /api/v1/billing/plans
  const planRoutes = Router();
  planRoutes.get('/plans', controller.listPlans);

  // Workspace-scoped: /api/v1/workspaces/:id/billing/...
  const workspaceBillingRoutes = Router({ mergeParams: true });

  // POST /checkout — create Stripe Checkout Session (owner only)
  workspaceBillingRoutes.post(
    '/checkout',
    validate({ params: workspaceParamsSchema, body: checkoutBodySchema }),
    requireRole('owner'),
    controller.createCheckout,
  );

  // POST /portal — create Stripe Customer Portal session (owner only)
  workspaceBillingRoutes.post(
    '/portal',
    validate({ params: workspaceParamsSchema, body: portalBodySchema }),
    requireRole('owner'),
    controller.createPortal,
  );

  // POST /credits/purchase — purchase credit pack (owner only)
  workspaceBillingRoutes.post(
    '/credits/purchase',
    validate({ params: workspaceParamsSchema, body: creditPurchaseBodySchema }),
    requireRole('owner'),
    controller.purchaseCredits,
  );

  // GET /invoices — list invoices (member+)
  workspaceBillingRoutes.get(
    '/invoices',
    validate({ params: workspaceParamsSchema, query: invoicesQuerySchema }),
    requireRole('member'),
    controller.listInvoices,
  );

  // Stripe webhook: POST /api/v1/billing/webhooks/stripe
  // Uses raw body parser (not JSON) for signature verification
  const webhookRoutes = Router();
  webhookRoutes.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    controller.stripeWebhook,
  );

  return { planRoutes, workspaceBillingRoutes, webhookRoutes };
}
