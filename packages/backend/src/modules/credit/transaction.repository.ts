import { type PoolClient } from 'pg';
import { query } from '../../shared/db';

export type CreditTransactionType = 'purchase' | 'usage' | 'refund' | 'bonus';

export interface CreditTransaction {
  id: string;
  workspaceId: string;
  amount: number;
  transactionType: CreditTransactionType;
  description: string;
  referenceId: string | null;
  createdAt: Date;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface CreditTransactionRow {
  id: string;
  workspace_id: string;
  amount: number;
  transaction_type: CreditTransactionType;
  description: string;
  reference_id: string | null;
  created_at: Date;
}

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    amount: Number(row.amount),
    transactionType: row.transaction_type,
    description: row.description,
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
}

const TRANSACTION_COLUMNS =
  'id, workspace_id, amount, transaction_type, description, reference_id, created_at';

/**
 * Creates a credit transaction record within an existing database transaction.
 * Accepts a PoolClient so it participates in the caller's transaction (e.g. alongside a balance update).
 */
export async function create(
  client: PoolClient,
  data: {
    workspaceId: string;
    amount: number;
    transactionType: CreditTransactionType;
    description: string;
    referenceId?: string | null;
  },
): Promise<CreditTransaction> {
  const result = await client.query<CreditTransactionRow>(
    `INSERT INTO credit_transactions (id, workspace_id, amount, transaction_type, description, reference_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
     RETURNING ${TRANSACTION_COLUMNS}`,
    [
      data.workspaceId,
      data.amount,
      data.transactionType,
      data.description,
      data.referenceId ?? null,
    ],
  );
  return toCreditTransaction(result.rows[0]);
}

/**
 * Returns paginated credit transactions for a workspace, ordered by created_at DESC (newest first).
 */
export async function findByWorkspaceId(
  workspaceId: string,
  options: PaginationOptions,
): Promise<PaginatedResult<CreditTransaction>> {
  const { page, limit } = options;
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    query<CreditTransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM credit_transactions
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM credit_transactions WHERE workspace_id = $1`,
      [workspaceId],
    ),
  ]);

  return {
    items: dataResult.rows.map(toCreditTransaction),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}
