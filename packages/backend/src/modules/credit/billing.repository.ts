import { type PoolClient } from 'pg';
import { query } from '../../shared/db';
import { NotFoundError } from '../../shared/errors';

export interface BillingRecord {
  workspaceId: string;
  planType: 'free' | 'pro' | 'enterprise';
  creditBalance: number;
  creditLimit: number;
  billingCycleStart: Date;
  billingCycleEnd: Date;
  autoRecharge: boolean;
  autoRechargeThreshold: number;
  autoRechargeAmount: number;
}

interface BillingRow {
  workspace_id: string;
  plan_type: 'free' | 'pro' | 'enterprise';
  credit_balance: number;
  credit_limit: number;
  billing_cycle_start: Date;
  billing_cycle_end: Date;
  auto_recharge: boolean;
  auto_recharge_threshold: number;
  auto_recharge_amount: number;
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
  };
}

const BILLING_COLUMNS =
  'workspace_id, plan_type, credit_balance, credit_limit, billing_cycle_start, billing_cycle_end, auto_recharge, auto_recharge_threshold, auto_recharge_amount';

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
