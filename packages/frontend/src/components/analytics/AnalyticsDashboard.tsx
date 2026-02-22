import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useAnalyticsStore } from '@/stores/analytics.store';
import { useAnalytics } from '@/hooks/useAnalytics';
import TimeRangeFilter from '@/components/analytics/TimeRangeFilter';
import type { ActiveTab } from '@/types/analytics.types';

const EnrichmentTab = lazy(() => import('@/components/analytics/EnrichmentTab'));
const ScrapingTab = lazy(() => import('@/components/analytics/ScrapingTab'));
const CreditsTab = lazy(() => import('@/components/analytics/CreditsTab'));

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'enrichment', label: 'Enrichment' },
  { id: 'scraping', label: 'Scraping' },
  { id: 'credits', label: 'Credits' },
];

export default function AnalyticsDashboard() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const activeTab = useAnalyticsStore((s) => s.activeTab);
  const setActiveTab = useAnalyticsStore((s) => s.setActiveTab);

  useAnalytics(workspaceId ?? null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
        <TimeRangeFilter />
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200" role="tablist" aria-label="Analytics tabs">
        <nav className="flex gap-6 -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Active tab content */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" role="status">
              <span className="sr-only">Loading tab</span>
            </div>
          </div>
        }
      >
        {activeTab === 'enrichment' && <EnrichmentTab />}
        {activeTab === 'scraping' && <ScrapingTab />}
        {activeTab === 'credits' && <CreditsTab />}
      </Suspense>
    </div>
  );
}
