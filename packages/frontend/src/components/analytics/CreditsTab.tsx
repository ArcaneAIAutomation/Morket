import { useParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useAnalyticsStore } from '@/stores/analytics.store';
import { exportCreditCSV } from '@/api/analytics.api';
import SummaryCards from '@/components/analytics/SummaryCards';
import type { SummaryCardItem } from '@/components/analytics/SummaryCards';
import type { CreditProviderBreakdown } from '@/types/analytics.types';
import { useState } from 'react';

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

type SortKey = 'providerSlug' | 'creditsConsumed' | 'percentageOfTotal';

export default function CreditsTab() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const summary = useAnalyticsStore((s) => s.creditSummary);
  const byProvider = useAnalyticsStore((s) => s.creditByProvider);
  const bySource = useAnalyticsStore((s) => s.creditBySource);
  const overTime = useAnalyticsStore((s) => s.creditOverTime);
  const isLoading = useAnalyticsStore((s) => s.isLoading);
  const timeRangePreset = useAnalyticsStore((s) => s.timeRangePreset);
  const customTimeRange = useAnalyticsStore((s) => s.customTimeRange);

  const [sortKey, setSortKey] = useState<SortKey>('creditsConsumed');
  const [sortAsc, setSortAsc] = useState(false);

  const summaryLoading = isLoading.creditSummary;

  const cards: SummaryCardItem[] = [
    { label: 'Debited', value: summary?.totalDebited ?? null, format: 'credits' },
    { label: 'Refunded', value: summary?.totalRefunded ?? null, format: 'credits' },
    { label: 'Topped Up', value: summary?.totalToppedUp ?? null, format: 'credits' },
    { label: 'Net Consumption', value: summary?.netConsumption ?? null, format: 'credits' },
  ];

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const sortedProviders = [...byProvider].sort((a, b) => {
    const av = a[sortKey as keyof CreditProviderBreakdown];
    const bv = b[sortKey as keyof CreditProviderBreakdown];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function handleExportCSV() {
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };
    window.location.href = exportCreditCSV(workspaceId!, timeRange);
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="space-y-6">
      <SummaryCards items={cards} isLoading={summaryLoading} />

      {/* Stacked area chart over time */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Credits Over Time</h3>
        {isLoading.creditOverTime ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading chart</span>
          </div>
        ) : overTime.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={overTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="debited" stackId="1" stroke="#ef4444" fill="#fecaca" name="Debited" />
              <Area type="monotone" dataKey="refunded" stackId="1" stroke="#22c55e" fill="#bbf7d0" name="Refunded" />
              <Area type="monotone" dataKey="toppedUp" stackId="1" stroke="#6366f1" fill="#c7d2fe" name="Topped Up" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pie chart by source */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">By Source</h3>
        {isLoading.creditBySource ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading chart</span>
          </div>
        ) : bySource.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={bySource}
                dataKey="creditsConsumed"
                nameKey="source"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={(props) => {
                  const entry = props as unknown as { name: string; percent: number };
                  return `${entry.name} (${(entry.percent * 100).toFixed(1)}%)`;
                }}
              >
                {bySource.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Provider consumption table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Provider Consumption</h3>
          <button
            onClick={handleExportCSV}
            className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Export CSV
          </button>
        </div>
        {isLoading.creditByProvider ? (
          <div className="h-32 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading table</span>
          </div>
        ) : sortedProviders.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No data for selected period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase border-b">
                <tr>
                  {([
                    ['providerSlug', 'Provider'],
                    ['creditsConsumed', 'Credits'],
                    ['percentageOfTotal', '% of Total'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className="py-2 px-3 cursor-pointer hover:text-gray-700 select-none"
                      onClick={() => handleSort(key)}
                    >
                      {label}{sortIndicator(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProviders.map((p) => (
                  <tr key={p.providerSlug} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium">{p.providerSlug}</td>
                    <td className="py-2 px-3">{p.creditsConsumed.toLocaleString()}</td>
                    <td className="py-2 px-3">{p.percentageOfTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
