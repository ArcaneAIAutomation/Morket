import { env } from '../../config/env';

export type PlanSlug = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlanDefinition {
  slug: PlanSlug;
  name: string;
  /** Monthly price in cents (USD) */
  price: number;
  /** Credits included per billing cycle */
  includedCredits: number;
  /** Maximum credit balance allowed */
  creditLimit: number;
  /** Maximum workspace members (-1 = unlimited) */
  maxMembers: number;
  /** Stripe Price ID (null for free tier) */
  stripePriceId: string | null;
  features: string[];
}

export const PLANS: Record<PlanSlug, PlanDefinition> = {
  free: {
    slug: 'free',
    name: 'Free',
    price: 0,
    includedCredits: 100,
    creditLimit: 500,
    maxMembers: 1,
    stripePriceId: null,
    features: ['Basic enrichment', 'Single provider', '100 credits/month'],
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    price: 4900,
    includedCredits: 2000,
    creditLimit: 10000,
    maxMembers: 5,
    stripePriceId: env.STRIPE_STARTER_PRICE_ID ?? null,
    features: ['All providers', 'Basic analytics', '2,000 credits/month', 'Up to 5 members'],
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    price: 19900,
    includedCredits: 10000,
    creditLimit: 50000,
    maxMembers: 25,
    stripePriceId: env.STRIPE_PRO_PRICE_ID ?? null,
    features: ['All features', 'Advanced analytics', '10,000 credits/month', 'Up to 25 members', 'Priority support'],
  },
  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    price: 49900,
    includedCredits: 50000,
    creditLimit: 200000,
    maxMembers: -1,
    stripePriceId: env.STRIPE_ENTERPRISE_PRICE_ID ?? null,
    features: ['Everything in Pro', '50,000 credits/month', 'Unlimited members', 'SSO/SAML', 'Dedicated support'],
  },
};

export const CREDIT_PACKS = [
  { credits: 1000, price: 1000, label: '1,000 credits' },
  { credits: 5000, price: 4000, label: '5,000 credits' },
  { credits: 25000, price: 15000, label: '25,000 credits' },
] as const;

export function getPlan(slug: string): PlanDefinition | undefined {
  return PLANS[slug as PlanSlug];
}

export function getPlanByStripePriceId(priceId: string): PlanDefinition | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId);
}
