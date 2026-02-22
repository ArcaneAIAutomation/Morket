import { Request, Response, NextFunction } from 'express';
import * as billingService from './billing.service';
import { successResponse } from '../../shared/envelope';

export function createBillingController() {
  return {
    async listPlans(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const plans = billingService.listPlans();
        res.status(200).json(successResponse(plans));
      } catch (err) {
        next(err);
      }
    },

    async createCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { plan, successUrl, cancelUrl } = req.body;
        const result = await billingService.createCheckoutSession(
          req.params.id,
          plan,
          successUrl,
          cancelUrl,
        );
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async createPortal(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { returnUrl } = req.body;
        const result = await billingService.createPortalSession(req.params.id, returnUrl);
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async purchaseCredits(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const { credits, successUrl, cancelUrl } = req.body;
        const result = await billingService.purchaseCreditPack(
          req.params.id,
          credits,
          successUrl,
          cancelUrl,
        );
        res.status(200).json(successResponse(result));
      } catch (err) {
        next(err);
      }
    },

    async listInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const limit = req.query.limit as unknown as number;
        const invoices = await billingService.listInvoices(req.params.id, limit || 10);
        res.status(200).json(successResponse(invoices));
      } catch (err) {
        next(err);
      }
    },

    async stripeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const signature = req.headers['stripe-signature'] as string;
        if (!signature) {
          res.status(400).json({ success: false, error: { code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' } });
          return;
        }
        await billingService.handleStripeWebhook(req.body, signature);
        res.status(200).json({ received: true });
      } catch (err) {
        next(err);
      }
    },
  };
}
