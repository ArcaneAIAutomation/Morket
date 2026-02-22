# Module 8.4 — Stripe Billing & Subscription

## Requirements

### 1. Subscription Plans
- 1.1 Support four plan tiers: free, starter, pro, enterprise
- 1.2 Each plan defines: monthly price, included credits, credit limit, max workspace members, features list
- 1.3 Free tier: $0/mo, 100 credits, 1 member, basic enrichment only
- 1.4 Starter tier: $49/mo, 2,000 credits, 5 members, all providers + basic analytics
- 1.5 Pro tier: $199/mo, 10,000 credits, 25 members, all features + priority support
- 1.6 Enterprise tier: $499/mo, 50,000 credits, unlimited members, SSO + dedicated support
- 1.7 Plan definitions stored in code as a registry (not DB) for simplicity

### 2. Stripe Integration
- 2.1 Create Stripe customers when workspace is created (lazy — on first billing action)
- 2.2 Create Stripe subscriptions mapped to workspace plan
- 2.3 Support Stripe Checkout Sessions for initial subscription and plan changes
- 2.4 Support Stripe Customer Portal for self-service billing management
- 2.5 Store Stripe customer ID and subscription ID on billing record
- 2.6 All Stripe API calls wrapped in try/catch with structured error handling

### 3. Subscription Lifecycle
- 3.1 Trial: 14-day free trial on starter plan with 500 credits, no payment method required
- 3.2 Upgrade: immediate plan change with prorated billing via Stripe
- 3.3 Downgrade: takes effect at end of current billing period
- 3.4 Cancellation: workspace retains access until period end, then downgrades to free
- 3.5 Reactivation: cancelled subscription can be reactivated before period end

### 4. Credit Packs (One-Time Purchases)
- 4.1 Credit packs purchasable as Stripe one-time payments: 1,000 ($10), 5,000 ($40), 25,000 ($150)
- 4.2 Credits added to workspace balance upon successful payment confirmation
- 4.3 Auto-recharge: when balance drops below threshold, automatically purchase configured credit pack via Stripe
- 4.4 Auto-recharge uses stored payment method from Stripe subscription

### 5. Webhook Handling
- 5.1 Stripe webhook endpoint at POST /api/v1/billing/webhooks/stripe
- 5.2 Verify webhook signatures using Stripe webhook secret
- 5.3 Handle events: checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
- 5.4 Idempotent processing: store processed event IDs to prevent duplicate handling
- 5.5 On payment_succeeded: update billing cycle dates, add included credits
- 5.6 On payment_failed: record failure, send notification (future), begin dunning flow
- 5.7 On subscription_updated: sync plan type and status to billing record
- 5.8 On subscription_deleted: downgrade workspace to free plan

### 6. Dunning Flow
- 6.1 On first payment failure: mark subscription as past_due
- 6.2 Stripe handles retry schedule (3 attempts over ~7 days)
- 6.3 After all retries exhausted (subscription_deleted event): downgrade to free, zero out credit balance above free tier limit
- 6.4 Log all dunning events as credit transactions with type 'adjustment'

### 7. Database Changes
- 7.1 Add columns to billing table: stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at, current_period_start, current_period_end
- 7.2 Add plan_type value 'starter' to existing enum
- 7.3 Create stripe_events table for idempotent webhook processing
- 7.4 Add 'adjustment' to transaction_type enum

### 8. API Endpoints
- 8.1 POST /api/v1/workspaces/:id/billing/checkout — create Stripe Checkout Session for subscription
- 8.2 POST /api/v1/workspaces/:id/billing/portal — create Stripe Customer Portal session
- 8.3 POST /api/v1/workspaces/:id/billing/credits/purchase — purchase credit pack via Stripe
- 8.4 GET /api/v1/workspaces/:id/billing/invoices — list Stripe invoices for workspace
- 8.5 POST /api/v1/billing/webhooks/stripe — Stripe webhook receiver (public, signature-verified)
- 8.6 GET /api/v1/billing/plans — list available plans and pricing (public)

### 9. Security
- 9.1 Stripe webhook endpoint must verify signatures before processing
- 9.2 Stripe secret key stored as environment variable, never logged
- 9.3 Only workspace owners can initiate billing changes (checkout, portal, credit purchase)
- 9.4 Billing read endpoints (invoices, plan info) accessible to member+
