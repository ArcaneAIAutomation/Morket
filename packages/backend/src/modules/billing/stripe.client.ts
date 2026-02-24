import Stripe from 'stripe';
import { env } from '../../config/env';

let stripeInstance: Stripe | null = null;

/**
 * Returns a lazily-initialized Stripe client.
 * Returns null if STRIPE_SECRET_KEY is not configured (e.g. in test/dev without Stripe).
 */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) {
    return null;
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

/**
 * Returns the Stripe client or throws if not configured.
 */
export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
  }
  return stripe;
}
