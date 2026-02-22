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
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [isAddingCredits, setIsAddingCredits] = useState(false);

  const scrollSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    getBilling(activeWorkspaceId)
      .then(setBilling)
      .catch(() => addToast('error', 'Failed to load billing info.'));

    getTransactions(activeWorkspaceId, { page: 1, limit: PAGE_SIZE })
      .then((res) => {
        setTransactions(res.transactions);
        setTotalTransactions(res.total);
        setPage(1);
      })
      .catch(() => addToast('error', 'Failed to load transactions.'));
  }, [activeWorkspaceId, addToast]);

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

  // Infinite scroll via IntersectionObserver on a sentinel element
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

  const isLowBalance =
    billing != null && billing.creditLimit > 0 && billing.creditBalance < billing.creditLimit * 0.1;

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

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold">Billing &amp; Credits</h2>

      {isLowBalance && (
        <div
          className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-4 py-3 text-sm"
          role="alert"
        >
          ⚠️ Low credit balance — your balance is below 10% of your credit limit.
        </div>
      )}

      {billing ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Credit Balance</p>
            <p className="text-2xl font-semibold">{formatCredits(billing.creditBalance)}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Plan</p>
            <p className="text-2xl font-semibold capitalize">{billing.planType}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Auto-Recharge</p>
            <p className="text-2xl font-semibold">{billing.autoRecharge ? 'On' : 'Off'}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Credit Limit</p>
            <p className="text-2xl font-semibold">{formatNumber(billing.creditLimit)}</p>
          </div>
        </div>
      ) : (
        <p className="text-gray-400 text-sm">Loading billing info…</p>
      )}

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
                  <td className="py-2 pr-4 capitalize">{tx.type}</td>
                  <td className={`py-2 pr-4 font-mono ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.amount >= 0 ? '+' : ''}{formatNumber(tx.amount)}
                  </td>
                  <td className="py-2 pr-4 text-gray-500">{tx.description}</td>
                  <td className="py-2 text-gray-500">{formatDateTime(tx.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transactions.length === 0 && (
            <p className="text-gray-400 text-sm py-4 text-center">No transactions yet.</p>
          )}
        </div>

        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={scrollSentinelRef} className="py-4 text-center text-gray-400 text-sm">
            {isLoadingMore ? 'Loading more…' : ''}
          </div>
        )}
      </section>
    </div>
  );
}
