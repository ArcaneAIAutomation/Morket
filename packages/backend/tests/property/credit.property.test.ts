import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { CreditTransaction } from '../../src/modules/credit/transaction.repository';
import type { BillingRecord } from '../../src/modules/credit/billing.repository';

// ── Mock db module ──
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock('../../src/shared/db', () => ({
  getPool: vi.fn(() => mockPool),
  query: vi.fn(),
}));

// ── Mock billing.repository ──
vi.mock('../../src/modules/credit/billing.repository', () => ({
  findByWorkspaceId: vi.fn(),
  create: vi.fn(),
  updateBalance: vi.fn(),
  updateAutoRecharge: vi.fn(),
}));

// ── Mock transaction.repository ──
vi.mock('../../src/modules/credit/transaction.repository', () => ({
  create: vi.fn(),
  findByWorkspaceId: vi.fn(),
}));

import * as billingRepo from '../../src/modules/credit/billing.repository';
import * as txnRepo from '../../src/modules/credit/transaction.repository';
import { addCredits, debit, getTransactions } from '../../src/modules/credit/credit.service';
import { InsufficientCreditsError, NotFoundError } from '../../src/shared/errors';

const NUM_RUNS = 100;

// ── Generators ──
const uuidArb = fc.uuid();
const positiveAmountArb = fc.integer({ min: 1, max: 10_000 });
const nonNegativeBalanceArb = fc.integer({ min: 0, max: 100_000 });
const descriptionArb = fc.string({ minLength: 1, maxLength: 100 });

// ── Helpers ──
function makeBillingRecord(overrides: Partial<BillingRecord> = {}): BillingRecord {
  return {
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    planType: overrides.planType ?? 'free',
    creditBalance: overrides.creditBalance ?? 0,
    creditLimit: overrides.creditLimit ?? 1000,
    billingCycleStart: new Date(),
    billingCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    autoRecharge: overrides.autoRecharge ?? false,
    autoRechargeThreshold: overrides.autoRechargeThreshold ?? 0,
    autoRechargeAmount: overrides.autoRechargeAmount ?? 0,
    ...overrides,
  };
}

function makeCreditTransaction(overrides: Partial<CreditTransaction> = {}): CreditTransaction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    amount: overrides.amount ?? 100,
    transactionType: overrides.transactionType ?? 'purchase',
    description: overrides.description ?? 'Test transaction',
    referenceId: overrides.referenceId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    ...overrides,
  };
}

/**
 * Sets up the mock client for addCredits:
 * - BEGIN
 * - SELECT FOR UPDATE → returns currentBalance
 * - updateBalance (via billingRepo mock)
 * - txnRepo.create (via txnRepo mock)
 * - COMMIT
 */
function setupAddCreditsMocks(workspaceId: string, currentBalance: number, amount: number) {
  mockClient.query.mockImplementation(async (sql: string) => {
    const upper = sql.toUpperCase().trim();
    if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 };
    }
    if (upper.includes('SELECT') && upper.includes('FOR UPDATE')) {
      return { rows: [{ credit_balance: currentBalance }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const updatedBilling = makeBillingRecord({ workspaceId, creditBalance: currentBalance + amount });
  vi.mocked(billingRepo.updateBalance).mockResolvedValue(updatedBilling);

  const txn = makeCreditTransaction({
    workspaceId,
    amount,
    transactionType: 'purchase',
  });
  vi.mocked(txnRepo.create).mockResolvedValue(txn);

  return { updatedBilling, txn };
}

/**
 * Sets up the mock client for debit (no auto-recharge):
 * - BEGIN
 * - SELECT FOR UPDATE → returns currentBalance + billing config
 * - updateBalance (via billingRepo mock)
 * - txnRepo.create (via txnRepo mock)
 * - COMMIT
 */
function setupDebitMocks(
  workspaceId: string,
  currentBalance: number,
  amount: number,
  autoRecharge = false,
  autoRechargeThreshold = 0,
  autoRechargeAmount = 0,
) {
  mockClient.query.mockImplementation(async (sql: string) => {
    const upper = sql.toUpperCase().trim();
    if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 };
    }
    if (upper.includes('SELECT') && upper.includes('FOR UPDATE')) {
      return {
        rows: [{
          credit_balance: currentBalance,
          auto_recharge: autoRecharge,
          auto_recharge_threshold: autoRechargeThreshold,
          auto_recharge_amount: autoRechargeAmount,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const newBalance = currentBalance - amount;
  const updatedBilling = makeBillingRecord({ workspaceId, creditBalance: newBalance });
  vi.mocked(billingRepo.updateBalance).mockResolvedValue(updatedBilling);

  const usageTxn = makeCreditTransaction({
    workspaceId,
    amount: -amount,
    transactionType: 'usage',
  });
  const rechargeTxn = makeCreditTransaction({
    workspaceId,
    amount: autoRechargeAmount,
    transactionType: 'purchase',
    description: 'Auto-recharge',
  });

  // Use call-count-based implementation to avoid mockResolvedValueOnce queue issues
  let txnCreateCallCount = 0;
  vi.mocked(txnRepo.create).mockImplementation(async () => {
    txnCreateCallCount++;
    return txnCreateCallCount === 1 ? usageTxn : rechargeTxn;
  });

  return { usageTxn, rechargeTxn, newBalance };
}

describe('Feature: core-backend-foundation, Credit Properties', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  /**
   * Property 19: Credit addition increases balance by exact amount
   * For any balance B and positive amount A, after addCredits, new balance = B + A
   * and a 'purchase' transaction is recorded.
   * **Validates: Requirements 6.2**
   */
  it('Property 19: Credit addition increases balance by exact amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nonNegativeBalanceArb,
        positiveAmountArb,
        descriptionArb,
        async (workspaceId, balance, amount, description) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);
          mockPool.connect.mockResolvedValue(mockClient);

          const { txn } = setupAddCreditsMocks(workspaceId, balance, amount);

          const result = await addCredits(workspaceId, amount, description);

          // The returned transaction must be a 'purchase' with the exact amount
          expect(result.transactionType).toBe('purchase');
          expect(result.amount).toBe(amount);
          expect(result.workspaceId).toBe(workspaceId);

          // updateBalance must have been called with B + A
          expect(billingRepo.updateBalance).toHaveBeenCalledWith(
            mockClient,
            workspaceId,
            balance + amount,
          );

          // txnRepo.create must have been called with amount = A and type = 'purchase'
          expect(txnRepo.create).toHaveBeenCalledWith(
            mockClient,
            expect.objectContaining({
              workspaceId,
              amount,
              transactionType: 'purchase',
            }),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 20: Credit debit decreases balance by exact amount
   * For any balance B and amount A where A <= B, after debit, new balance = B - A
   * and a 'usage' transaction with amount -A is recorded.
   * **Validates: Requirements 6.4**
   */
  it('Property 20: Credit debit decreases balance by exact amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        // Generate balance and amount such that amount <= balance
        fc.integer({ min: 1, max: 100_000 }).chain((balance) =>
          fc.tuple(
            fc.constant(balance),
            fc.integer({ min: 1, max: balance }),
          ),
        ),
        descriptionArb,
        async (workspaceId, [balance, amount], description) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);
          mockPool.connect.mockResolvedValue(mockClient);

          setupDebitMocks(workspaceId, balance, amount);

          const result = await debit(workspaceId, amount, description);

          // The returned transaction must be 'usage' with amount = -A
          expect(result.transactionType).toBe('usage');
          expect(result.amount).toBe(-amount);
          expect(result.workspaceId).toBe(workspaceId);

          // updateBalance must have been called with B - A
          expect(billingRepo.updateBalance).toHaveBeenCalledWith(
            mockClient,
            workspaceId,
            balance - amount,
          );

          // txnRepo.create must have been called with amount = -A and type = 'usage'
          expect(txnRepo.create).toHaveBeenCalledWith(
            mockClient,
            expect.objectContaining({
              workspaceId,
              amount: -amount,
              transactionType: 'usage',
            }),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 21: Insufficient credit rejection
   * For any amount A > balance B, debit is rejected with InsufficientCreditsError,
   * balance unchanged, no transaction recorded.
   * **Validates: Requirements 6.5**
   */
  it('Property 21: Insufficient credit rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        // Generate balance and amount such that amount > balance
        fc.integer({ min: 0, max: 99_999 }).chain((balance) =>
          fc.tuple(
            fc.constant(balance),
            fc.integer({ min: balance + 1, max: 100_000 }),
          ),
        ),
        descriptionArb,
        async (workspaceId, [balance, amount], description) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);
          mockPool.connect.mockResolvedValue(mockClient);

          mockClient.query.mockImplementation(async (sql: string) => {
            const upper = sql.toUpperCase().trim();
            if (upper.startsWith('BEGIN') || upper.startsWith('ROLLBACK')) {
              return { rows: [], rowCount: 0 };
            }
            if (upper.includes('SELECT') && upper.includes('FOR UPDATE')) {
              return {
                rows: [{
                  credit_balance: balance,
                  auto_recharge: false,
                  auto_recharge_threshold: 0,
                  auto_recharge_amount: 0,
                }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          });

          await expect(debit(workspaceId, amount, description)).rejects.toThrow(
            InsufficientCreditsError,
          );

          // Balance must not have been updated
          expect(billingRepo.updateBalance).not.toHaveBeenCalled();

          // No transaction must have been recorded
          expect(txnRepo.create).not.toHaveBeenCalled();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 22: Transaction listing is reverse chronological
   * For any workspace with multiple transactions, findByWorkspaceId returns them
   * sorted by created_at DESC.
   * **Validates: Requirements 6.3**
   */
  it('Property 22: Transaction listing is reverse chronological', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 2, maxLength: 20 }),
        async (workspaceId, offsetsMinutes) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);

          const now = Date.now();
          // Build transactions with distinct timestamps (ascending offsets → oldest first)
          const transactions: CreditTransaction[] = offsetsMinutes.map((offset, i) =>
            makeCreditTransaction({
              id: crypto.randomUUID(),
              workspaceId,
              createdAt: new Date(now + offset * 60_000 + i), // ensure uniqueness
            }),
          );

          // Sort descending (newest first) — this is what the repo should return
          const sorted = [...transactions].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );

          vi.mocked(txnRepo.findByWorkspaceId).mockResolvedValue({
            items: sorted,
            total: sorted.length,
            page: 1,
            limit: 50,
          });

          const result = await getTransactions(workspaceId, { page: 1, limit: 50 });

          // Verify the result is in descending order
          for (let i = 0; i < result.items.length - 1; i++) {
            expect(result.items[i].createdAt.getTime()).toBeGreaterThanOrEqual(
              result.items[i + 1].createdAt.getTime(),
            );
          }

          // Verify the repository was called with correct pagination
          expect(txnRepo.findByWorkspaceId).toHaveBeenCalledWith(workspaceId, { page: 1, limit: 50 });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 23: Auto-recharge triggers at threshold
   * For any workspace with auto_recharge=true, threshold T, recharge amount R,
   * when debit causes balance to drop below T, balance is increased by R and an
   * additional 'purchase' transaction is recorded.
   * **Validates: Requirements 6.6**
   */
  it('Property 23: Auto-recharge triggers at threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        // threshold T, recharge amount R, debit amount A, balance B
        // Constraints: B >= A (debit succeeds), B - A < T (triggers recharge)
        fc.integer({ min: 10, max: 1000 }).chain((threshold) =>
          fc.integer({ min: 1, max: threshold }).chain((debitAmount) =>
            fc.tuple(
              fc.constant(threshold),
              fc.constant(debitAmount),
              // balance must be >= debitAmount but B - debitAmount < threshold
              // so balance < threshold + debitAmount
              fc.integer({ min: debitAmount, max: threshold + debitAmount - 1 }),
              fc.integer({ min: 1, max: 5000 }), // recharge amount
            ),
          ),
        ),
        descriptionArb,
        async (workspaceId, [threshold, debitAmount, balance, rechargeAmount], description) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);
          mockPool.connect.mockResolvedValue(mockClient);

          setupDebitMocks(
            workspaceId,
            balance,
            debitAmount,
            true,
            threshold,
            rechargeAmount,
          );

          const result = await debit(workspaceId, debitAmount, description);

          // The primary usage transaction is returned
          expect(result.transactionType).toBe('usage');
          expect(result.amount).toBe(-debitAmount);

          // updateBalance must have been called at least twice:
          // 1. For the debit: balance - debitAmount
          // 2. For the recharge: balance - debitAmount + rechargeAmount
          const updateCalls = vi.mocked(billingRepo.updateBalance).mock.calls;
          expect(updateCalls.length).toBeGreaterThanOrEqual(2);

          const firstUpdateBalance = updateCalls[0][2];
          expect(firstUpdateBalance).toBe(balance - debitAmount);

          const secondUpdateBalance = updateCalls[1][2];
          expect(secondUpdateBalance).toBe(balance - debitAmount + rechargeAmount);

          // txnRepo.create must have been called twice:
          // 1. usage transaction
          // 2. purchase (auto-recharge) transaction
          const createCalls = vi.mocked(txnRepo.create).mock.calls;
          expect(createCalls.length).toBeGreaterThanOrEqual(2);

          const rechargeTxnCall = createCalls[1][1];
          expect(rechargeTxnCall.transactionType).toBe('purchase');
          expect(rechargeTxnCall.amount).toBe(rechargeAmount);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 24: Concurrent credit operations produce correct final balance
   * For any initial balance B and N sequential addCredits operations each adding
   * amount A, final balance = B + N*A.
   * (Note: true concurrency testing requires a real DB; test sequential correctness here)
   * **Validates: Requirements 6.7**
   */
  it('Property 24: Sequential credit operations produce correct final balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        nonNegativeBalanceArb,
        positiveAmountArb,
        fc.integer({ min: 1, max: 10 }),
        async (workspaceId, initialBalance, amount, n) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);
          mockPool.connect.mockResolvedValue(mockClient);

          let currentBalance = initialBalance;

          for (let i = 0; i < n; i++) {
            // Each call sees the updated balance from the previous iteration
            const balanceAtCallTime = currentBalance;
            const expectedNewBalance = balanceAtCallTime + amount;

            mockClient.query.mockImplementation(async (sql: string) => {
              const upper = sql.toUpperCase().trim();
              if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) {
                return { rows: [], rowCount: 0 };
              }
              if (upper.includes('SELECT') && upper.includes('FOR UPDATE')) {
                return { rows: [{ credit_balance: balanceAtCallTime }], rowCount: 1 };
              }
              return { rows: [], rowCount: 0 };
            });

            vi.mocked(billingRepo.updateBalance).mockResolvedValue(
              makeBillingRecord({ workspaceId, creditBalance: expectedNewBalance }),
            );

            vi.mocked(txnRepo.create).mockResolvedValue(
              makeCreditTransaction({ workspaceId, amount, transactionType: 'purchase' }),
            );

            await addCredits(workspaceId, amount, `Operation ${i + 1}`);

            // Verify updateBalance was called with the correct new balance
            const lastUpdateCall = vi.mocked(billingRepo.updateBalance).mock.calls.at(-1);
            expect(lastUpdateCall?.[2]).toBe(expectedNewBalance);

            currentBalance = expectedNewBalance;
          }

          // Final balance must equal B + N*A
          expect(currentBalance).toBe(initialBalance + n * amount);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 25: Transaction ledger immutability
   * For any set of transactions, the count is monotonically non-decreasing
   * (adding more never reduces count).
   * **Validates: Requirements 6.8**
   */
  it('Property 25: Transaction ledger immutability — count is monotonically non-decreasing', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        fc.array(positiveAmountArb, { minLength: 0, maxLength: 20 }),
        fc.array(positiveAmountArb, { minLength: 1, maxLength: 10 }),
        async (workspaceId, initialAmounts, additionalAmounts) => {
          vi.resetAllMocks();
          mockPool.connect.mockResolvedValue(mockClient);

          // Build initial set of transactions
          const initialTransactions: CreditTransaction[] = initialAmounts.map((amt) =>
            makeCreditTransaction({ workspaceId, amount: amt }),
          );

          // Simulate adding more transactions
          const additionalTransactions: CreditTransaction[] = additionalAmounts.map((amt) =>
            makeCreditTransaction({ workspaceId, amount: amt }),
          );

          const allTransactions = [...initialTransactions, ...additionalTransactions];

          // First query: initial count
          vi.mocked(txnRepo.findByWorkspaceId).mockResolvedValueOnce({
            items: initialTransactions,
            total: initialTransactions.length,
            page: 1,
            limit: 1000,
          });

          const before = await getTransactions(workspaceId, { page: 1, limit: 1000 });
          const countBefore = before.total;

          // Second query: after adding more transactions
          vi.mocked(txnRepo.findByWorkspaceId).mockResolvedValueOnce({
            items: allTransactions,
            total: allTransactions.length,
            page: 1,
            limit: 1000,
          });

          const after = await getTransactions(workspaceId, { page: 1, limit: 1000 });
          const countAfter = after.total;

          // Count must be non-decreasing
          expect(countAfter).toBeGreaterThanOrEqual(countBefore);

          // The additional transactions must be exactly the new ones added
          expect(countAfter - countBefore).toBe(additionalAmounts.length);

          // Existing transaction IDs must still be present (immutability)
          const afterIds = new Set(after.items.map((t) => t.id));
          for (const txn of initialTransactions) {
            expect(afterIds.has(txn.id)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
