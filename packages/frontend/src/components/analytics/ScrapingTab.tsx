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
import { exportScrapingCSV } from '@/api/analytics.api';
import SummaryCards from '@/components/analytics/SummaryCards';
import type { SummaryCardItem } from '@/components/analytics/SummaryCards';
import type { TargetTypeBreakdown } from '@/types/analytics.types';
import { useState } from 'react';

type SortKey = 'targetType' | 'tasks' | 'successCount' | 'failureCount' | 'successRate';

export default function ScrapingTab() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const summary = useAnalyticsStore((s) => s.scrapingSummary);
  const byDomain = useAnalyticsStore((s) => s.scrapingByDomain);
  const byType = useAnalyticsStore((s) => s.scrapingByType);
  const overTime = useAnalyticsStore((s) => s.scrapingOverTime);
  const isLoading = useAnalyticsStore((s) => s.isLoading);
  const timeRangePreset = useAnalyticsStore((s) => s.timeRangePreset);
  const customTimeRange = useAnalyticsStore((s) => s.customTimeRange);

  const [sortKey, setSortKey] = useState<SortKey>('tasks');
  const [sortAsc, setSortAsc] = useState(false);

  const summaryLoading = isLoading.scrapingSummary;

  const cards: SummaryCardItem[] = [
    { label: 'Total Tasks', value: summary?.totalTasks ?? null, format: 'number' },
    { label: 'Success Rate', value: summary?.successRate ?? null, format: 'percentage' },
    { label: 'Completed', value: summary?.completedCount ?? null, format: 'number' },
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

  const sortedTypes = [...byType].sort((a, b) => {
    const av = a[sortKey as keyof TargetTypeBreakdown];
    const bv = b[sortKey as keyof TargetTypeBreakdown];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  // Top 10 domains for horizontal bar chart
  const top10Domains = byDomain.slice(0, 10);

  function handleExportCSV() {
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };
    window.location.href = exportScrapingCSV(workspaceId!, timeRange);
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="space-y-6">
      <SummaryCards items={cards} isLoading={summaryLoading} />

      {/* Over time chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Scraping Over Time</h3>
        {isLoading.scrapingOverTime ? (
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
              <Line type="monotone" dataKey="attempts" stroke="#6366f1" strokeWidth={2} dot={false} name="Tasks" />
              <Line type="monotone" dataKey="successes" stroke="#22c55e" strokeWidth={2} dot={false} name="Completed" />
              <Line type="monotone" dataKey="failures" stroke="#ef4444" strokeWidth={2} dot={false} name="Failed" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top domains horizontal bar chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Top 10 Domains</h3>
        {isLoading.scrapingByDomain ? (
          <div className="h-64 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading chart</span>
          </div>
        ) : top10Domains.length === 0 ? (
          <p className="text-gray-500 text-sm py-12 text-center">No data for selected period</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, top10Domains.length * 36)}>
            <BarChart data={top10Domains} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="domain" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip />
              <Bar dataKey="tasks" fill="#6366f1" name="Tasks" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Target type table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">By Target Type</h3>
          <button
            onClick={handleExportCSV}
            className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Export CSV
          </button>
        </div>
        {isLoading.scrapingByType ? (
          <div className="h-32 bg-gray-100 rounded animate-pulse" role="status">
            <span className="sr-only">Loading table</span>
          </div>
        ) : sortedTypes.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No data for selected period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase border-b">
                <tr>
                  {([
                    ['targetType', 'Type'],
                    ['tasks', 'Tasks'],
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
                {sortedTypes.map((t) => (
                  <tr key={t.targetType} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium">{t.targetType}</td>
                    <td className="py-2 px-3">{t.tasks.toLocaleString()}</td>
                    <td className="py-2 px-3">{t.successCount.toLocaleString()}</td>
                    <td className="py-2 px-3">{t.failureCount.toLocaleString()}</td>
                    <td className="py-2 px-3">{t.successRate.toFixed(1)}%</td>
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
