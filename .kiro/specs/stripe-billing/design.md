# Design Document — Module 8.4: Stripe Billing & Subscription

## Overview

Integrates Stripe for subscription management and credit pack purchases. Extends the existing credit/billing module with Stripe customer/subscription tracking, webhook processing, and checkout flows. The existing credit system (balance, transactions, auto-recharge) remains intact — Stripe becomes the payment layer on top.

### Key Design Decisions

1. **Extend existing billing table**: Add Stripe columns (customer_id, subscription_id, status, period dates) to the existing `billing` table rather than creating a separate subscriptions table. The billing table is already 1:1 with workspaces.

2. **Lazy Stripe customer creation**: Don't create Stripe customers on workspace creation. Create them on first billing action (checkout, credit purchase). This avoids Stripe API calls for free-tier users who never upgrade.

3. **Plan registry in code**: Plan definitions (pricing, credits, limits) are a TypeScript constant, not a DB table. Plans change infrequently and need to match Stripe Price IDs configured in env vars.

4. **Idempotent webhook processing**: Store processed Stripe event IDs in a `stripe_events` table. Check before processing to prevent duplicate credit additions or plan changes.

5. **Stripe Checkout for payments**: Use Stripe Checkout Sessions (hosted page) rather than building custom payment forms. Reduces PCI scope and implementation complexity.

6. **Stripe Customer Portal for management**: Use Stripe's hosted portal for invoice history, payment method updates, and subscription cancellation. Minimal frontend work needed.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend                          │
│  Checkout button → redirect to Stripe Checkout      │
│  Portal button → redirect to Stripe Customer Portal │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Backend API (Express)                    │
│                                                      │
│  POST /billing/checkout    → Stripe Checkout Session │
│  POST /billing/portal      → Stripe Portal Session  │
│  POST /billing/credits/purchase → Stripe Payment     │
│  GET  /billing/invoices    → Stripe Invoice List     │
│  GET  /billing/plans       → Plan Registry (static)  │
│  POST /billing/webhooks/stripe → Webhook Handler     │
└──────────┬───────────────────────┬──────────────────┘
           │                       │
           ▼                       ▼
┌──────────────────┐   ┌──────────────────────────┐
│   PostgreSQL     │   │      Stripe API          │
│  billing table   │   │  Customers, Subscriptions│
│  stripe_events   │   │  Checkout, Portal, etc.  │
│  credit_txns     │   └──────────────────────────┘
└──────────────────┘
```

## File Structure

```
src/modules/billing/
├── billing.routes.ts        # Route factory (workspace-scoped + public routes)
├── billing.controller.ts    # HTTP handlers
├── billing.service.ts       # Business logic (checkout, portal, credit purchase, webhook)
├── billing.schemas.ts       # Zod validation schemas
├── stripe.client.ts         # Stripe SDK wrapper (initialized from env)
├── plan-registry.ts         # Plan definitions (tiers, pricing, Stripe price IDs)
├── stripe-event.repository.ts  # Idempotent event tracking
└── billing.service.test.ts  # Unit tests
```

## Database Changes (Migration 017)

```sql
-- Add 'starter' to plan_type enum
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'starter';

-- Add Stripe columns to billing table
ALTER TABLE billing
  ADD COLUMN stripe_customer_id VARCHAR(255),
  ADD COLUMN stripe_subscription_id VARCHAR(255),
  ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'none',
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN current_period_start TIMESTAMPTZ,
  ADD COLUMN current_period_end TIMESTAMPTZ;

CREATE INDEX idx_billing_stripe_customer ON billing(stripe_customer_id);
CREATE INDEX idx_billing_stripe_subscription ON billing(stripe_subscription_id);

-- Add 'adjustment' to transaction_type enum
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'adjustment';

-- Stripe event idempotency table
CREATE TABLE stripe_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Plan Registry

```typescript
export const PLANS = {
  free:       { price: 0,   credits: 100,    creditLimit: 500,    maxMembers: 1,   stripePriceId: null },
  starter:    { price: 4900, credits: 2000,   creditLimit: 10000,  maxMembers: 5,   stripePriceId: env.STRIPE_STARTER_PRICE_ID },
  pro:        { price: 19900, credits: 10000, creditLimit: 50000,  maxMembers: 25,  stripePriceId: env.STRIPE_PRO_PRICE_ID },
  enterprise: { price: 49900, credits: 50000, creditLimit: 200000, maxMembers: -1,  stripePriceId: env.STRIPE_ENTERPRISE_PRICE_ID },
} as const;
```

## Webhook Flow

```
Stripe → POST /api/v1/billing/webhooks/stripe
  1. Verify signature (stripe.webhooks.constructEvent)
  2. Check stripe_events table for duplicate
  3. Process event:
     - checkout.session.completed → link subscription, set plan, add credits
     - invoice.payment_succeeded → renew billing cycle, add monthly credits
     - invoice.payment_failed → mark past_due, log adjustment
     - customer.subscription.updated → sync plan/status
     - customer.subscription.deleted → downgrade to free
  4. Insert event_id into stripe_events
  5. Return 200
```

## Environment Variables (New)

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...
```
