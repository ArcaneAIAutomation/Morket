import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useUIStore } from '@/stores/ui.store';
import { useRole } from '@/hooks/useRole';
import { formatCredits, formatDateTime, formatNumber } from '@/utils/formatters';
import { getBilling, addCredits, getTransactions } from '@/api/billing.api';
import type { BillingInfo, CreditTransaction } from '@/types/api.types';

const PAGE_SIZE = 20;

export default function BillingSettings() {
  const { can } = useRole();
  const canManageBilling = can('manage_billing');

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addToast = useUIStore((s) => s.addToast);

  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [isAddingCredits, setIsAddingCredits] = useState(false);

  const scrollSentinelRef = useRef<HTMLDivElement>(null);

  const fetchBilling = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setBillingLoading(true);
    setBillingError(null);
    try {
      const data = await getBilling(activeWorkspaceId);
      setBilling(data);
    } catch {
      setBillingError('Unable to load billing information');
      setBilling(null);
    } finally {
      setBillingLoading(false);
    }
  }, [activeWorkspaceId]);

  const fetchTransactions = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setTxLoading(true);
    setTxError(null);
    try {
      const res = await getTransactions(activeWorkspaceId, { page: 1, limit: PAGE_SIZE });
      setTransactions(res.transactions);
      setTotalTransactions(res.total);
      setPage(1);
    } catch {
      setTxError('Unable to load transaction history');
      setTransactions([]);
      setTotalTransactions(0);
    } finally {
      setTxLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const hasMore = transactions.length < totalTransactions;

  const loadMore = useCallback(async () => {
    if (!activeWorkspaceId || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await getTransactions(activeWorkspaceId, { page: nextPage, limit: PAGE_SIZE });
      setTransactions((prev) => [...prev, ...res.transactions]);
      setTotalTransactions(res.total);
      setPage(nextPage);
    } catch {
      addToast('error', 'Failed to load more transactions.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeWorkspaceId, isLoadingMore, hasMore, page, addToast]);

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (!activeWorkspaceId) {
    return <p className="text-gray-500 text-sm">No workspace selected.</p>;
  }

  const handleAddCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(creditAmount, 10);
    if (!amount || amount <= 0) return;
    setIsAddingCredits(true);
    try {
      const updated = await addCredits(activeWorkspaceId, amount);
      setBilling(updated);
      setCreditAmount('');
      addToast('success', `Added ${formatNumber(amount)} credits.`);
    } catch {
      addToast('error', 'Failed to add credits.');
    } finally {
      setIsAddingCredits(false);
    }
  };

  function renderBillingSection() {
    try {
      if (billingLoading) {
        return (
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="border rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
                <div className="h-8 bg-gray-200 rounded w-32" />
              </div>
            ))}
          </div>
        );
      }

      if (billingError) {
        return (
          <div className="border border-red-200 bg-red-50 rounded-lg p-4">
            <p className="text-red-700 text-sm">{billingError}</p>
            <button
              onClick={fetchBilling}
              className="mt-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Retry
            </button>
          </div>
        );
      }

      if (!billing) {
        return <p className="text-gray-400 text-sm">No billing data available.</p>;
      }

      const isLowBalance =
        billing.creditLimit > 0 && billing.creditBalance < billing.creditLimit * 0.1;

      return (
        <>
          {isLowBalance && (
            <div
              className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-4 py-3 text-sm mb-4"
              role="alert"
            >
              ⚠️ Low credit balance — your balance is below 10% of your credit limit.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <p className="text-sm text-gray-500">Credit Balance</p>
              <p className="text-2xl font-semibold">{formatCredits(billing.creditBalance ?? 0)}</p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-sm text-gray-500">Plan</p>
              <p className="text-2xl font-semibold capitalize">{billing.planType ?? 'N/A'}</p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-sm text-gray-500">Auto-Recharge</p>
              <p className="text-2xl font-semibold">{billing.autoRecharge ? 'On' : 'Off'}</p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-sm text-gray-500">Credit Limit</p>
              <p className="text-2xl font-semibold">{formatNumber(billing.creditLimit ?? 0)}</p>
            </div>
          </div>
        </>
      );
    } catch {
      return (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <p className="text-red-700 text-sm">Unable to load billing information</p>
          <button
            onClick={fetchBilling}
            className="mt-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      );
    }
  }

  function renderTransactionsSection() {
    try {
      if (txLoading) {
        return (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded" />
            ))}
          </div>
        );
      }

      if (txError) {
        return (
          <div className="border border-red-200 bg-red-50 rounded-lg p-4">
            <p className="text-red-700 text-sm">{txError}</p>
            <button
              onClick={fetchTransactions}
              className="mt-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Retry
            </button>
          </div>
        );
      }

      return (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 capitalize">{tx.type ?? ''}</td>
                    <td className={`py-2 pr-4 font-mono ${(tx.amount ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(tx.amount ?? 0) >= 0 ? '+' : ''}{formatNumber(tx.amount ?? 0)}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{tx.description ?? ''}</td>
                    <td className="py-2 text-gray-500">{tx.createdAt ? formatDateTime(tx.createdAt) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && (
              <p className="text-gray-400 text-sm py-4 text-center">No transactions yet.</p>
            )}
          </div>

          {hasMore && (
            <div ref={scrollSentinelRef} className="py-4 text-center text-gray-400 text-sm">
              {isLoadingMore ? 'Loading more…' : ''}
            </div>
          )}
        </>
      );
    } catch {
      return (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <p className="text-red-700 text-sm">Unable to load transaction history</p>
          <button
            onClick={fetchTransactions}
            className="mt-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      );
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold">Billing &amp; Credits</h2>

      {renderBillingSection()}

      {canManageBilling && (
        <form onSubmit={handleAddCredits} className="flex gap-3 items-end">
          <div>
            <label htmlFor="credit-amount" className="block text-sm font-medium text-gray-700 mb-1">
              Add Credits
            </label>
            <input
              id="credit-amount"
              type="number"
              min="1"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              placeholder="Amount"
              className="border rounded px-3 py-2 text-sm w-40"
            />
          </div>
          <button
            type="submit"
            disabled={isAddingCredits || !creditAmount || parseInt(creditAmount, 10) <= 0}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAddingCredits ? 'Adding…' : 'Add Credits'}
          </button>
        </form>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Transaction History</h3>
        {renderTransactionsSection()}
      </section>
    </div>
  );
}
