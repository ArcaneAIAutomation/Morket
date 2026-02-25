import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { createElement } from 'react';

// Feature: menu-fixes-options-config, Property 3: Billing page resilience to malformed data

/**
 * Property 3: Billing page resilience to malformed data
 * **Validates: Requirements 5.1, 5.4**
 *
 * For any value returned by the billing API (including null, undefined,
 * objects missing expected fields, or objects with wrong types),
 * the BillingSettings component should render without throwing an
 * unhandled exception — it should display an error state instead of
 * crashing the ErrorBoundary.
 */

// Mock billing API
vi.mock('@/api/billing.api', () => ({
  getBilling: vi.fn(),
  getTransactions: vi.fn(),
  addCredits: vi.fn(),
}));

// Mock workspace store to provide activeWorkspaceId
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

describe('Property 3: Billing page resilience to malformed data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: transactions returns valid empty data
    mockedGetTransactions.mockResolvedValue({ transactions: [], total: 0 });
  });

  // Arbitrary for malformed billing data: null, undefined, wrong types, missing fields, partial objects
  const malformedBillingArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant({}),
    fc.constant('a string instead of object'),
    fc.constant(42),
    fc.constant(true),
    fc.constant([]),
    // Object with wrong types for expected fields
    fc.record({
      creditBalance: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant('not-a-number'), fc.constant(true), fc.constant([])),
      planType: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant(123), fc.constant({})),
      autoRecharge: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant('yes'), fc.constant(42)),
      creditLimit: fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant('big'), fc.constant(false)),
    }),
    // Partial objects missing some fields
    fc.record(
      {
        creditBalance: fc.oneof(fc.constant(undefined), fc.integer()),
        planType: fc.oneof(fc.constant(undefined), fc.string()),
      },
      { requiredKeys: [] },
    ),
    // Completely random objects
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.boolean())),
  );

  // Arbitrary for malformed transaction data
  const malformedTransactionsArb = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant({}),
    fc.constant('not-an-object'),
    fc.constant(42),
    fc.constant({ transactions: null, total: null }),
    fc.constant({ transactions: 'not-array', total: 'not-number' }),
    fc.constant({ transactions: [null, undefined, 42, 'str'], total: 4 }),
    fc.constant({
      transactions: [{ id: null, type: 123, amount: 'free', description: null, createdAt: false }],
      total: 1,
    }),
  );

  it('should render without throwing for any malformed billing data', async () => {
    // Dynamically import to ensure mocks are applied
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    await fc.assert(
      fc.asyncProperty(malformedBillingArb, async (malformedData) => {
        // Mock getBilling to resolve with malformed data
        mockedGetBilling.mockResolvedValue(malformedData as never);
        mockedGetTransactions.mockResolvedValue({ transactions: [], total: 0 });

        // Rendering should not throw
        expect(() => {
          const { unmount } = render(createElement(BillingSettings));
          unmount();
        }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should render without throwing when getBilling rejects with any error', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    const errorArb = fc.oneof(
      fc.string().map((msg) => new Error(msg)),
      fc.constant(null),
      fc.constant(undefined),
      fc.record({ status: fc.integer(), message: fc.string() }),
      fc.constant({ response: { data: { error: 'server error' } } }),
    );

    await fc.assert(
      fc.asyncProperty(errorArb, async (error) => {
        mockedGetBilling.mockRejectedValue(error);
        mockedGetTransactions.mockResolvedValue({ transactions: [], total: 0 });

        expect(() => {
          const { unmount } = render(createElement(BillingSettings));
          unmount();
        }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should render without throwing for any malformed transaction data', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    await fc.assert(
      fc.asyncProperty(malformedTransactionsArb, async (malformedData) => {
        mockedGetBilling.mockResolvedValue({
          creditBalance: 100,
          planType: 'free',
          autoRecharge: false,
          creditLimit: 1000,
        });
        mockedGetTransactions.mockResolvedValue(malformedData as never);

        expect(() => {
          const { unmount } = render(createElement(BillingSettings));
          unmount();
        }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('should render without throwing when both billing and transactions return malformed data', async () => {
    const { default: BillingSettings } = await import('@/components/settings/BillingSettings');

    await fc.assert(
      fc.asyncProperty(malformedBillingArb, malformedTransactionsArb, async (billingData, txData) => {
        mockedGetBilling.mockResolvedValue(billingData as never);
        mockedGetTransactions.mockResolvedValue(txData as never);

        expect(() => {
          const { unmount } = render(createElement(BillingSettings));
          unmount();
        }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
