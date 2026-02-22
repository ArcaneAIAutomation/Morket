import { type PoolClient } from 'pg';
import { query } from '../../shared/db';
import { NotFoundError } from '../../shared/errors';

export interface BillingRecord {
  workspaceId: string;
  planType: 'free' | 'starter' | 'pro' | 'enterprise';
  creditBalance: number;
  creditLimit: number;
  billingCycleStart: Date;
  billingCycleEnd: Date;
  autoRecharge: boolean;
  autoRechargeThreshold: number;
  autoRechargeAmount: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

interface BillingRow {
  workspace_id: string;
  plan_type: 'free' | 'starter' | 'pro' | 'enterprise';
  credit_balance: number;
  credit_limit: number;
  billing_cycle_start: Date;
  billing_cycle_end: Date;
  auto_recharge: boolean;
  auto_recharge_threshold: number;
  auto_recharge_amount: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
}

function toBillingRecord(row: BillingRow): BillingRecord {
  return {
    workspaceId: row.workspace_id,
    planType: row.plan_type,
    creditBalance: row.credit_balance,
    creditLimit: row.credit_limit,
    billingCycleStart: row.billing_cycle_start,
    billingCycleEnd: row.billing_cycle_end,
    autoRecharge: row.auto_recharge,
    autoRechargeThreshold: row.auto_recharge_threshold,
    autoRechargeAmount: row.auto_recharge_amount,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
  };
}

const BILLING_COLUMNS =
  'workspace_id, plan_type, credit_balance, credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge, auto_recharge_threshold, auto_recharge_amount, stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at, current_period_start, current_period_end';

/**
 * Creates a billing record for a workspace with zero balance and default settings.
 * Billing cycle is set from now to +30 days.
 */
export async function create(
  workspaceId: string,
  planType: 'free' | 'pro' | 'enterprise' = 'free',
): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `INSERT INTO billing (workspace_id, plan_type, credit_balance, credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge, auto_recharge_threshold, auto_recharge_amount)
     VALUES ($1, $2, 0, 1000, NOW(), NOW() + INTERVAL '30 days', false, 0, 0)
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId, planType],
  );
  return toBillingRecord(result.rows[0]);
}

/**
 * Finds a billing record by workspace ID. Returns null if not found.
 */
export async function findByWorkspaceId(workspaceId: string): Promise<BillingRecord | null> {
  const result = await query<BillingRow>(
    `SELECT ${BILLING_COLUMNS} FROM billing WHERE workspace_id = $1`,
    [workspaceId],
  );
  return result.rows[0] ? toBillingRecord(result.rows[0]) : null;
}

/**
 * Updates the credit balance for a workspace within an existing transaction.
 * Accepts a PoolClient so it participates in the caller's transaction.
 * The caller is responsible for SELECT FOR UPDATE before calling this.
 */
export async function updateBalance(
  client: PoolClient,
  workspaceId: string,
  newBalance: number,
): Promise<BillingRecord> {
  const result = await client.query<BillingRow>(
    `UPDATE billing SET credit_balance = $2 WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId, newBalance],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}

/**
 * Updates auto-recharge settings for a workspace.
 */
export async function updateAutoRecharge(
  workspaceId: string,
  autoRecharge: boolean,
  threshold: number,
  amount: number,
): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `UPDATE billing SET auto_recharge = $2, auto_recharge_threshold = $3, auto_recharge_amount = $4
     WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId, autoRecharge, threshold, amount],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}

/**
 * Sets the Stripe customer ID on a billing record.
 */
export async function setStripeCustomerId(
  workspaceId: string,
  stripeCustomerId: string,
): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `UPDATE billing SET stripe_customer_id = $2 WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId, stripeCustomerId],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}

/**
 * Updates Stripe subscription details on a billing record.
 */
export async function updateStripeSubscription(
  workspaceId: string,
  data: {
    stripeSubscriptionId: string;
    subscriptionStatus: string;
    planType: 'free' | 'starter' | 'pro' | 'enterprise';
    creditLimit: number;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    trialEndsAt?: Date | null;
  },
): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `UPDATE billing SET
       stripe_subscription_id = $2,
       subscription_status = $3,
       plan_type = $4,
       credit_limit = $5,
       current_period_start = COALESCE($6, current_period_start),
       current_period_end = COALESCE($7, current_period_end),
       trial_ends_at = $8
     WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [
      workspaceId,
      data.stripeSubscriptionId,
      data.subscriptionStatus,
      data.planType,
      data.creditLimit,
      data.currentPeriodStart ?? null,
      data.currentPeriodEnd ?? null,
      data.trialEndsAt ?? null,
    ],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}

/**
 * Updates subscription status only (for dunning/cancellation).
 */
export async function updateSubscriptionStatus(
  workspaceId: string,
  status: string,
): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `UPDATE billing SET subscription_status = $2 WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId, status],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}

/**
 * Finds a billing record by Stripe subscription ID.
 */
export async function findByStripeSubscriptionId(
  subscriptionId: string,
): Promise<BillingRecord | null> {
  const result = await query<BillingRow>(
    `SELECT ${BILLING_COLUMNS} FROM billing WHERE stripe_subscription_id = $1`,
    [subscriptionId],
  );
  return result.rows[0] ? toBillingRecord(result.rows[0]) : null;
}

/**
 * Finds a billing record by Stripe customer ID.
 */
export async function findByStripeCustomerId(
  customerId: string,
): Promise<BillingRecord | null> {
  const result = await query<BillingRow>(
    `SELECT ${BILLING_COLUMNS} FROM billing WHERE stripe_customer_id = $1`,
    [customerId],
  );
  return result.rows[0] ? toBillingRecord(result.rows[0]) : null;
}

/**
 * Downgrades a workspace to free plan (used on subscription cancellation/dunning).
 */
export async function downgradeToFree(workspaceId: string): Promise<BillingRecord> {
  const result = await query<BillingRow>(
    `UPDATE billing SET
       plan_type = 'free',
       subscription_status = 'canceled',
       stripe_subscription_id = NULL,
       credit_limit = 500,
       trial_ends_at = NULL
     WHERE workspace_id = $1
     RETURNING ${BILLING_COLUMNS}`,
    [workspaceId],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return toBillingRecord(result.rows[0]);
}
