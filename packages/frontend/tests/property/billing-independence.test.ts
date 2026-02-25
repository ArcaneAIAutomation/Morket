import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { render, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';

// Feature: menu-fixes-options-config, Property 4: Billing sections render independently

/**
 * Property 4: Billing sections render independently
 * **Validates: Requirements 5.2, 6.1**
 *
 * For any combination of billing info API success/failure and transactions
 * API success/failure (4 combinations), the BillingSettings component should
 * render the successful section's data and show an error+retry UI for the
 * failed section, never blocking one section on the other.
 */

// Polyfill IntersectionObserver for jsdom
beforeAll(() => {
  global.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as unknown as typeof IntersectionObserver;
});

afterAll(() => {
  delete (global as Record<string, unknown>).IntersectionObserver;
});

// Mock billing API
vi.mock('@/api/billing.api', () => ({
  getBilling: vi.fn(),
  getTransactions: vi.fn(),
  addCredits: vi.fn(),
}));

// Mock workspace store
vi.mock('@/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeWorkspaceId: 'test-workspace-id', currentRole: 'admin' }),
  ),
}));

// Mock UI store
vi.mock('@/stores/ui.store', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
  ),
}));

// Mock useRole hook
vi.mock('@/hooks/useRole', () => ({
  useRole: () => ({ role: 'admin', can: () => true }),
}));

import { getBilling, getTransactions } from '@/api/billing.api';

const mockedGetBilling = vi.mocked(getBilling);
const mockedGetTransactions = vi.mocked(getTransactions);

// Generator for valid BillingInfo data
const validBillingArb = fc.record({
  creditBalance: fc.integer({ min: 0, max: 1_000_000 }),
  planType: fc.constantFrom('free', 'starter', 'pro', 'enterprise'),
  autoRecharge: fc.boolean(),
  creditLimit: fc.integer({ min: 0, max: 1_000_000 }),
  billingCycleStart: fc.date().map((d) => d.toISOString()),
  billingCycleEnd: fc.date().map((d) => d.toISOString()),
  autoRechargeThreshold: fc.integer({ min: 0, max: 10_000 }),
  autoRechargeAmount: fc.integer({ min: 0, max: 10_000 }),
});

// Generator for valid transactions response
const validTransactionsArb = fc.record({
  transactions: fc.array(
    fc.record({
      id: fc.uuid(),
      type: fc.constantFrom('purchase', 'usage', 'refund', 'bonus'),
      amount: fc.integer({ min: -10_000, max: 10_000 }),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      createdAt: fc.date().map((d) => d.toISOString()),
    }),
    { minLength: 0, maxLength: 5 },
  ),
  total: fc.integer({ min: 0, max: 100 }),
});

// Generator for API errors
const apiErrorArb = fc.oneof(
  fc.string({ minLength: 1 }).map((msg) => new Error(msg)),
  fc.record({ status: fc.constantFrom(400, 403, 500), message: fc.string({ minLength: 1 }) }),
  fc.constant(new Error('Network Error')),
);

describe('Property 4: Billing sections render independently', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render billing and transaction sections independently for all 4 success/failure combinations', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    // Explicitly test all 4 combinations with generated data
    const combinations: Array<{ billingOutcome: 'success' | 'failure'; txOutcome: 'success' | 'failure' }> = [
      { billingOutcome: 'success', txOutcome: 'success' },
      { billingOutcome: 'success', txOutcome: 'failure' },
      { billingOutcome: 'failure', txOutcome: 'success' },
      { billingOutcome: 'failure', txOutcome: 'failure' },
    ];

    await fc.assert(
      fc.asyncProperty(
        validBillingArb,
        validTransactionsArb,
        apiErrorArb,
        apiErrorArb,
        fc.constantFrom(...combinations),
        async (billingData, txData, billingErr, txErr, combo) => {
          vi.clearAllMocks();
          cleanup();

          if (combo.billingOutcome === 'success') {
            mockedGetBilling.mockResolvedValue(billingData as never);
          } else {
            mockedGetBilling.mockRejectedValue(billingErr);
          }

          if (combo.txOutcome === 'success') {
            mockedGetTransactions.mockResolvedValue(txData);
          } else {
            mockedGetTransactions.mockRejectedValue(txErr);
          }

          const { unmount, container } = render(createElement(BillingSettings));

          // Wait for both API calls to complete
          await waitFor(() => {
            expect(mockedGetBilling).toHaveBeenCalledTimes(1);
            expect(mockedGetTransactions).toHaveBeenCalledTimes(1);
          });

          // Allow state updates to flush
          await waitFor(() => {
            const html = container.innerHTML;

            if (combo.billingOutcome === 'failure') {
              expect(html).toContain('Unable to load billing information');
            } else {
              expect(html).not.toContain('Unable to load billing information');
            }

            if (combo.txOutcome === 'failure') {
              expect(html).toContain('Unable to load transaction history');
            } else {
              expect(html).not.toContain('Unable to load transaction history');
            }
          });

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should show billing data when billing succeeds regardless of transaction outcome', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    await fc.assert(
      fc.asyncProperty(
        validBillingArb,
        fc.constantFrom<'success' | 'failure'>('success', 'failure'),
        async (billingData, txOutcome) => {
          vi.clearAllMocks();
          cleanup();

          mockedGetBilling.mockResolvedValue(billingData as never);

          if (txOutcome === 'success') {
            mockedGetTransactions.mockResolvedValue({ transactions: [], total: 0 });
          } else {
            mockedGetTransactions.mockRejectedValue(new Error('tx fail'));
          }

          const { unmount, container } = render(createElement(BillingSettings));

          await waitFor(() => {
            const html = container.innerHTML;
            // Billing section should render data, not error
            expect(html).not.toContain('Unable to load billing information');
            expect(html).toContain('Credit Balance');
          });

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should show transaction section when transactions succeed regardless of billing outcome', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    await fc.assert(
      fc.asyncProperty(
        validTransactionsArb,
        fc.constantFrom<'success' | 'failure'>('success', 'failure'),
        async (txData, billingOutcome) => {
          vi.clearAllMocks();
          cleanup();

          if (billingOutcome === 'success') {
            mockedGetBilling.mockResolvedValue({
              creditBalance: 100,
              planType: 'free',
              autoRecharge: false,
              creditLimit: 1000,
            } as never);
          } else {
            mockedGetBilling.mockRejectedValue(new Error('billing fail'));
          }

          mockedGetTransactions.mockResolvedValue(txData);

          const { unmount, container } = render(createElement(BillingSettings));

          await waitFor(() => {
            const html = container.innerHTML;
            // Transaction section should NOT show error
            expect(html).not.toContain('Unable to load transaction history');
            // Transaction History heading should be present
            expect(html).toContain('Transaction History');
          });

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
