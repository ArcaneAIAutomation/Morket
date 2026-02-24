import { useParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { useAnalyticsStore } from '@/stores/analytics.store';
import { exportEnrichmentCSV } from '@/api/analytics.api';
import SummaryCards from '@/components/analytics/SummaryCards';
import type { SummaryCardItem } from '@/components/analytics/SummaryCards';
import type { ProviderBreakdown, FieldBreakdown } from '@/types/analytics.types';
import { useState } from 'react';

type SortKey = 'fieldName' | 'attempts' | 'successCount' | 'failureCount' | 'successRate';

export default function EnrichmentTab() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const summary = useAnalyticsStore((s) => s.enrichmentSummary);
  const byProvider = useAnalyticsStore((s) => s.enrichmentByProvider);
  const byField = useAnalyticsStore((s) => s.enrichmentByField);
  const overTime = useAnalyticsStore((s) => s.enrichmentOverTime);
  const isLoading = useAnalyticsStore((s) => s.isLoading);
  const timeRangePreset = useAnalyticsStore((s) => s.timeRangePreset);
  const customTimeRange = useAnalyticsStore((s) => s.customTimeRange);
  const setSelectedProvider = useAnalyticsStore((s) => s.setSelectedProvider);

  const [sortKey, setSortKey] = useState<SortKey>('attempts');
  const [sortAsc, setSortAsc] = useState(false);

  const summaryLoading = isLoading.enrichmentSummary;

  const cards: SummaryCardItem[] = [
    { label: 'Total Attempts', value: summary?.totalAttempts ?? null, format: 'number' },
    { label: 'Success Rate', value: summary?.successRate ?? null, format: 'percentage' },
    { label: 'Credits Used', value: summary?.totalCredits ?? null, format: 'credits' },
    { label: 'Avg Duration', value: summary?.avgDurationMs ?? null, format: 'duration' },
  ];

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const sortedFields = [...byField].sort((a, b) => {
    const av = a[sortKey as keyof FieldBreakdown];
    const bv = b[sortKey as keyof FieldBreakdown];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function handleProviderClick(provider: ProviderBreakdown) {
    setSelectedProvider(provider.providerSlug);
  }

  function handleExportCSV() {
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };
    window.location.href = exportEnrichmentCSV(workspaceId!, timeRange);
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="space-y-6">
      <SummaryCards items={cards} isLoading={summaryLoading} />

      {/* Over time chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Enrichment Over Time</h3>
        {isLoading.enrichmentOverTime ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading chart</span>
          </div>
        ) : overTime.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={overTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="attempts" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="successes" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="failures" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By provider chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">By Provider</h3>
        {isLoading.enrichmentByProvider ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading chart</span>
          </div>
        ) : byProvider.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byProvider} onClick={(e: Record<string, unknown> | null) => {
              const payload = e?.activePayload as Array<{ payload: ProviderBreakdown }> | undefined;
              if (payload) handleProviderClick(payload[0].payload);
            }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="providerSlug" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="successCount" fill="#22c55e" name="Success" stackId="a" />
              <Bar dataKey="failureCount" fill="#ef4444" name="Failure" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Field breakdown table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Field Breakdown</h3>
          <button
            onClick={handleExportCSV}
            className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Export CSV
          </button>
        </div>
        {isLoading.enrichmentByField ? (
          <div className="h-32 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading table</span>
          </div>
        ) : sortedFields.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No data for selected period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase border-b">
                <tr>
                  {([
                    ['fieldName', 'Field'],
                    ['attempts', 'Attempts'],
                    ['successCount', 'Success'],
                    ['failureCount', 'Failures'],
                    ['successRate', 'Rate'],
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
                {sortedFields.map((f) => (
                  <tr key={f.fieldName} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium">{f.fieldName}</td>
                    <td className="py-2 px-3">{f.attempts.toLocaleString()}</td>
                    <td className="py-2 px-3">{f.successCount.toLocaleString()}</td>
                    <td className="py-2 px-3">{f.failureCount.toLocaleString()}</td>
                    <td className="py-2 px-3">{f.successRate.toFixed(1)}%</td>
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
