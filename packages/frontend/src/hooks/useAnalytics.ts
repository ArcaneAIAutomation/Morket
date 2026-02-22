import { useEffect, useRef, useCallback } from 'react';
import { useAnalyticsStore } from '@/stores/analytics.store';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Fetches analytics data for the active tab on mount and when the time range
 * or active tab changes. Sets up a 60s auto-refresh that pauses when the
 * browser tab is not visible. Resets the store on unmount.
 */
export function useAnalytics(workspaceId: string | null) {
  const activeTab = useAnalyticsStore((s) => s.activeTab);
  const timeRangePreset = useAnalyticsStore((s) => s.timeRangePreset);
  const customTimeRange = useAnalyticsStore((s) => s.customTimeRange);
  const fetchEnrichmentData = useAnalyticsStore((s) => s.fetchEnrichmentData);
  const fetchScrapingData = useAnalyticsStore((s) => s.fetchScrapingData);
  const fetchCreditData = useAnalyticsStore((s) => s.fetchCreditData);
  const reset = useAnalyticsStore((s) => s.reset);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchActiveTab = useCallback(() => {
    if (!workspaceId) return;
    switch (useAnalyticsStore.getState().activeTab) {
      case 'enrichment':
        fetchEnrichmentData(workspaceId);
        break;
      case 'scraping':
        fetchScrapingData(workspaceId);
        break;
      case 'credits':
        fetchCreditData(workspaceId);
        break;
    }
  }, [workspaceId, fetchEnrichmentData, fetchScrapingData, fetchCreditData]);

  // Fetch on mount and when tab / time range changes
  useEffect(() => {
    fetchActiveTab();
  }, [activeTab, timeRangePreset, customTimeRange, fetchActiveTab]);

  // Auto-refresh with visibility pause
  useEffect(() => {
    function startInterval() {
      stopInterval();
      intervalRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchActiveTab();
        }
      }, REFRESH_INTERVAL_MS);
    }

    function stopInterval() {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchActiveTab();
        startInterval();
      } else {
        stopInterval();
      }
    }

    startInterval();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchActiveTab]);

  // Reset store on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);
}
