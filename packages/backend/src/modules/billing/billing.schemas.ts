import { z } from 'zod';

export const workspaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const checkoutBodySchema = z.object({
  plan: z.enum(['starter', 'pro', 'enterprise']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const portalBodySchema = z.object({
  returnUrl: z.string().url(),
});

export const creditPurchaseBodySchema = z.object({
  credits: z.number().int().refine(
    (v) => [1000, 5000, 25000].includes(v),
    { message: 'Credits must be one of: 1000, 5000, 25000' },
  ),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const invoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type CheckoutInput = z.infer<typeof checkoutBodySchema>;
export type PortalInput = z.infer<typeof portalBodySchema>;
export type CreditPurchaseInput = z.infer<typeof creditPurchaseBodySchema>;
export type InvoicesQuery = z.infer<typeof invoicesQuerySchema>;
