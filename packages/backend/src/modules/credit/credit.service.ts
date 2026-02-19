import { getPool } from '../../shared/db';
import { NotFoundError, InsufficientCreditsError } from '../../shared/errors';
import * as billingRepo from './billing.repository';
import * as txnRepo from './transaction.repository';
import type { BillingRecord } from './billing.repository';
import type {
  CreditTransaction,
  PaginationOptions,
  PaginatedResult,
} from './transaction.repository';

/**
 * Returns the billing record for a workspace.
 * Throws NotFoundError if no billing record exists.
 */
export async function getBilling(workspaceId: string): Promise<BillingRecord> {
  const billing = await billingRepo.findByWorkspaceId(workspaceId);
  if (!billing) {
    throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
  }
  return billing;
}

/**
 * Adds credits to a workspace balance within a single PostgreSQL transaction.
 * Records a "purchase" transaction entry.
 */
export async function addCredits(
  workspaceId: string,
  amount: number,
  description: string,
): Promise<CreditTransaction> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the billing row
    const lockResult = await client.query<{ credit_balance: number }>(
      'SELECT credit_balance FROM billing WHERE workspace_id = $1 FOR UPDATE',
      [workspaceId],
    );

    if (lockResult.rows.length === 0) {
      throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
    }

    const currentBalance = Number(lockResult.rows[0].credit_balance);
    const newBalance = currentBalance + amount;

    await billingRepo.updateBalance(client, workspaceId, newBalance);

    const transaction = await txnRepo.create(client, {
      workspaceId,
      amount,
      transactionType: 'purchase',
      description,
    });

    await client.query('COMMIT');
    return transaction;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Debits credits from a workspace balance within a single PostgreSQL transaction.
 * Uses SELECT FOR UPDATE to prevent concurrent modification.
 * Throws InsufficientCreditsError if balance < amount.
 * Triggers auto-recharge if enabled and new balance drops below threshold.
 * Returns the usage CreditTransaction.
 */
export async function debit(
  workspaceId: string,
  amount: number,
  description: string,
  referenceId?: string,
): Promise<CreditTransaction> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the billing row and read current state
    const lockResult = await client.query<{
      credit_balance: number;
      auto_recharge: boolean;
      auto_recharge_threshold: number;
      auto_recharge_amount: number;
    }>(
      `SELECT credit_balance, auto_recharge, auto_recharge_threshold, auto_recharge_amount
       FROM billing WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );

    if (lockResult.rows.length === 0) {
      throw new NotFoundError(`Billing record not found for workspace ${workspaceId}`);
    }

    const row = lockResult.rows[0];
    const currentBalance = Number(row.credit_balance);

    if (currentBalance < amount) {
      throw new InsufficientCreditsError(
        `Insufficient credits: balance is ${currentBalance}, requested ${amount}`,
      );
    }

    const newBalance = currentBalance - amount;

    await billingRepo.updateBalance(client, workspaceId, newBalance);

    const usageTransaction = await txnRepo.create(client, {
      workspaceId,
      amount: -amount,
      transactionType: 'usage',
      description,
      referenceId: referenceId ?? null,
    });

    // Auto-recharge: if enabled and new balance dropped below threshold
    if (row.auto_recharge && newBalance < Number(row.auto_recharge_threshold)) {
      const rechargeAmount = Number(row.auto_recharge_amount);
      const rechargedBalance = newBalance + rechargeAmount;

      await billingRepo.updateBalance(client, workspaceId, rechargedBalance);

      await txnRepo.create(client, {
        workspaceId,
        amount: rechargeAmount,
        transactionType: 'purchase',
        description: 'Auto-recharge',
      });
    }

    await client.query('COMMIT');
    return usageTransaction;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns paginated credit transactions for a workspace, newest first.
 */
export async function getTransactions(
  workspaceId: string,
  options: PaginationOptions,
): Promise<PaginatedResult<CreditTransaction>> {
  return txnRepo.findByWorkspaceId(workspaceId, options);
}
