# Implementation Plan: Module 8.4 — Stripe Billing & Subscription

## Tasks

- [x] 1. Database migration (017)
  - [x] 1.1 Add 'starter' to plan_type enum, Stripe columns to billing table, 'adjustment' to transaction_type enum, stripe_events table
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 2. Environment config
  - [x] 2.1 Add Stripe env vars to env.ts schema and .env.example
  - _Requirements: 9.2_

- [x] 3. Plan registry and Stripe client
  - [x] 3.1 Create plan-registry.ts with plan definitions
  - [x] 3.2 Create stripe.client.ts — Stripe SDK initialization
  - _Requirements: 1.1–1.7, 2.6_

- [x] 4. Repository layer
  - [x] 4.1 Create stripe-event.repository.ts — idempotent event tracking
  - [x] 4.2 Update billing.repository.ts — add Stripe column read/write methods
  - _Requirements: 5.4, 7.1_

- [x] 5. Schemas
  - [x] 5.1 Create billing.schemas.ts — Zod schemas for checkout, portal, credit purchase, invoices
  - _Requirements: 8.1–8.6_

- [x] 6. Service layer
  - [x] 6.1 Create billing.service.ts — checkout, portal, credit purchase, invoice list, webhook processing
  - _Requirements: 2.1–2.5, 3.1–3.5, 4.1–4.4, 5.1–5.8, 6.1–6.4_

- [x] 7. Controller and routes
  - [x] 7.1 Create billing.controller.ts — HTTP handlers
  - [x] 7.2 Create billing.routes.ts — route factory returning workspace-scoped + public routers
  - _Requirements: 8.1–8.6, 9.1, 9.3, 9.4_

- [x] 8. App integration
  - [x] 8.1 Mount billing routes in app.ts (webhook before JSON parser, others authenticated)
  - _Requirements: 8.1–8.6_

- [x] 9. Final review
  - [x] 9.1 All files pass TypeScript diagnostics with zero errors
