import Stripe from 'stripe';
import { requireStripe } from './stripe.client';
import { PLANS, CREDIT_PACKS, getPlan, getPlanByStripePriceId, type PlanSlug } from './plan-registry';
import * as billingRepo from '../credit/billing.repository';
import * as stripeEventRepo from './stripe-event.repository';
import * as creditService from '../credit/credit.service';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { env } from '../../config/env';

/**
 * Returns all available plans.
 */
export function listPlans() {
  return Object.values(PLANS).map((p) => ({
    slug: p.slug,
    name: p.name,
    price: p.price,
    includedCredits: p.includedCredits,
    creditLimit: p.creditLimit,
    maxMembers: p.maxMembers,
    features: p.features,
  }));
}

/**
 * Ensures a Stripe customer exists for the workspace. Creates one lazily if needed.
 */
async function ensureStripeCustomer(workspaceId: string): Promise<string> {
  const billing = await billingRepo.findByWorkspaceId(workspaceId);
  if (!billing) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }

  if (billing.stripeCustomerId) {
    return billing.stripeCustomerId;
  }

  const stripe = requireStripe();
  const customer = await stripe.customers.create({
    metadata: { workspaceId },
  });

  await billingRepo.setStripeCustomerId(workspaceId, customer.id);
  return customer.id;
}

/**
 * Creates a Stripe Checkout Session for subscribing to a plan.
 */
export async function createCheckoutSession(
  workspaceId: string,
  plan: 'starter' | 'pro' | 'enterprise',
  successUrl: string,
  cancelUrl: string,
): Promise<{ url: string }> {
  const stripe = requireStripe();
  const planDef = getPlan(plan);
  if (!planDef || !planDef.stripePriceId) {
    throw new ValidationError(`Plan "${plan}" is not available for checkout`);
  }

  const customerId = await ensureStripeCustomer(workspaceId);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: planDef.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: 14,
      metadata: { workspaceId, plan },
    },
    metadata: { workspaceId, plan },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return { url: session.url };
}

/**
 * Creates a Stripe Customer Portal session for self-service billing management.
 */
export async function createPortalSession(
  workspaceId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = requireStripe();
  const customerId = await ensureStripeCustomer(workspaceId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Creates a Stripe Checkout Session for a one-time credit pack purchase.
 */
export async function purchaseCreditPack(
  workspaceId: string,
  credits: number,
  successUrl: string,
  cancelUrl: string,
): Promise<{ url: string }> {
  const stripe = requireStripe();
  const pack = CREDIT_PACKS.find((p) => p.credits === credits);
  if (!pack) {
    throw new ValidationError(`Invalid credit pack: ${credits}`);
  }

  const customerId = await ensureStripeCustomer(workspaceId);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Morket Credit Pack — ${pack.label}` },
        unit_amount: pack.price,
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { workspaceId, credits: String(credits), type: 'credit_pack' },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return { url: session.url };
}

/**
 * Lists Stripe invoices for a workspace.
 */
export async function listInvoices(
  workspaceId: string,
  limit: number,
): Promise<Array<{
  id: string;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  invoicePdf: string | null;
  hostedInvoiceUrl: string | null;
}>> {
  const stripe = requireStripe();
  const billing = await billingRepo.findByWorkspaceId(workspaceId);
  if (!billing?.stripeCustomerId) {
    return [];
  }

  const invoices = await stripe.invoices.list({
    customer: billing.stripeCustomerId,
    limit,
  });

  return invoices.data.map((inv) => ({
    id: inv.id,
    status: inv.status,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    created: inv.created,
    invoicePdf: inv.invoice_pdf ?? null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
  }));
}

/**
 * Processes a Stripe webhook event. Idempotent — skips already-processed events.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  const stripe = requireStripe();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  // Verify signature
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  // Idempotency check
  const alreadyProcessed = await stripeEventRepo.exists(event.id);
  if (alreadyProcessed) {
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      // Unhandled event type — ignore
      break;
  }

  // Mark as processed
  await stripeEventRepo.markProcessed(event.id, event.type);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const workspaceId = session.metadata?.workspaceId;
  if (!workspaceId) return;

  // Credit pack purchase
  if (session.metadata?.type === 'credit_pack') {
    const credits = parseInt(session.metadata.credits, 10);
    if (credits > 0) {
      await creditService.addCredits(workspaceId, credits, `Credit pack purchase (${credits} credits)`);
    }
    return;
  }

  // Subscription checkout
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!subscriptionId) return;

  const planSlug = (session.metadata?.plan ?? 'starter') as PlanSlug;
  const planDef = getPlan(planSlug);
  if (!planDef) return;

  // Fetch full subscription to get period dates
  const stripe = requireStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await billingRepo.updateStripeSubscription(workspaceId, {
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: subscription.status,
    planType: planSlug,
    creditLimit: planDef.creditLimit,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  });

  // Add included credits for the first billing cycle
  await creditService.addCredits(
    workspaceId,
    planDef.includedCredits,
    `${planDef.name} plan — included credits`,
  );
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (!subscriptionId) return;

  // Skip the first invoice (handled by checkout.session.completed)
  if (invoice.billing_reason === 'subscription_create') return;

  const billing = await billingRepo.findByStripeSubscriptionId(subscriptionId);
  if (!billing) return;

  const planDef = getPlan(billing.planType);
  if (!planDef) return;

  // Renew billing cycle dates
  const stripe = requireStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await billingRepo.updateStripeSubscription(billing.workspaceId, {
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: subscription.status,
    planType: billing.planType as PlanSlug,
    creditLimit: planDef.creditLimit,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  });

  // Add monthly included credits
  await creditService.addCredits(
    billing.workspaceId,
    planDef.includedCredits,
    `${planDef.name} plan — monthly credits renewal`,
  );
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;

  if (!subscriptionId) return;

  const billing = await billingRepo.findByStripeSubscriptionId(subscriptionId);
  if (!billing) return;

  await billingRepo.updateSubscriptionStatus(billing.workspaceId, 'past_due');
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const billing = await billingRepo.findByStripeSubscriptionId(subscription.id);
  if (!billing) return;

  // Determine plan from price ID
  const priceId = subscription.items.data[0]?.price?.id;
  const planDef = priceId ? getPlanByStripePriceId(priceId) : null;

  if (planDef) {
    await billingRepo.updateStripeSubscription(billing.workspaceId, {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planType: planDef.slug,
      creditLimit: planDef.creditLimit,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    });
  } else {
    // Just sync status if we can't determine the plan
    await billingRepo.updateSubscriptionStatus(billing.workspaceId, subscription.status);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const billing = await billingRepo.findByStripeSubscriptionId(subscription.id);
  if (!billing) return;

  // Downgrade to free
  await billingRepo.downgradeToFree(billing.workspaceId);

  // Cap credit balance at free tier limit
  const freePlan = PLANS.free;
  if (billing.creditBalance > freePlan.creditLimit) {
    const excess = billing.creditBalance - freePlan.creditLimit;
    await creditService.debit(
      billing.workspaceId,
      excess,
      'Credit adjustment — downgraded to free plan',
    );
  }
}
