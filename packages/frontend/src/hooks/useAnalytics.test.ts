import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalytics } from './useAnalytics';
import { useAnalyticsStore } from '@/stores/analytics.store';

vi.mock('@/api/analytics.api', () => ({
  getEnrichmentSummary: vi.fn().mockResolvedValue({}),
  getEnrichmentByProvider: vi.fn().mockResolvedValue([]),
  getEnrichmentByField: vi.fn().mockResolvedValue([]),
  getEnrichmentOverTime: vi.fn().mockResolvedValue([]),
  getScrapingSummary: vi.fn().mockResolvedValue({}),
  getScrapingByDomain: vi.fn().mockResolvedValue([]),
  getScrapingByType: vi.fn().mockResolvedValue([]),
  getScrapingOverTime: vi.fn().mockResolvedValue([]),
  getCreditSummary: vi.fn().mockResolvedValue({}),
  getCreditByProvider: vi.fn().mockResolvedValue([]),
  getCreditBySource: vi.fn().mockResolvedValue([]),
  getCreditOverTime: vi.fn().mockResolvedValue([]),
}));

import * as analyticsApi from '@/api/analytics.api';

function resetStore() {
  useAnalyticsStore.setState({
    activeTab: 'enrichment',
    timeRangePreset: '30d',
    customTimeRange: null,
    selectedProvider: null,
    enrichmentSummary: null,
    enrichmentByProvider: [],
    enrichmentByField: [],
    enrichmentOverTime: [],
    scrapingSummary: null,
    scrapingByDomain: [],
    scrapingByType: [],
    scrapingOverTime: [],
    creditSummary: null,
    creditByProvider: [],
    creditBySource: [],
    creditOverTime: [],
    isLoading: {},
    error: null,
  });
}

describe('useAnalytics', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  it('fetches enrichment data on mount', async () => {
    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });

    expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalledWith('ws-1', { preset: '30d' });
    expect(analyticsApi.getEnrichmentByProvider).toHaveBeenCalled();
    expect(analyticsApi.getEnrichmentByField).toHaveBeenCalled();
    expect(analyticsApi.getEnrichmentOverTime).toHaveBeenCalled();
  });

  it('does not fetch when workspaceId is null', async () => {
    await act(async () => {
      renderHook(() => useAnalytics(null));
    });

    expect(analyticsApi.getEnrichmentSummary).not.toHaveBeenCalled();
  });

  it('re-fetches when time range changes', async () => {
    let hookResult: ReturnType<typeof renderHook>;
    await act(async () => {
      hookResult = renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    await act(async () => {
      useAnalyticsStore.getState().setTimeRange('7d');
    });

    expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalledWith('ws-1', { preset: '7d' });
  });

  it('fetches scraping data when tab switches to scraping', async () => {
    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    await act(async () => {
      useAnalyticsStore.getState().setActiveTab('scraping');
    });

    expect(analyticsApi.getScrapingSummary).toHaveBeenCalledWith('ws-1', { preset: '30d' });
  });

  it('fetches credit data when tab switches to credits', async () => {
    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    await act(async () => {
      useAnalyticsStore.getState().setActiveTab('credits');
    });

    expect(analyticsApi.getCreditSummary).toHaveBeenCalledWith('ws-1', { preset: '30d' });
  });

  it('auto-refreshes via setInterval', async () => {
    vi.useFakeTimers();
    resetStore();
    vi.clearAllMocks();

    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    // Advance 60s to trigger interval
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('pauses auto-refresh when tab becomes hidden', async () => {
    vi.useFakeTimers();
    resetStore();
    vi.clearAllMocks();

    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance 60s — should NOT fetch since hidden stops the interval
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(analyticsApi.getEnrichmentSummary).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('resumes auto-refresh when tab becomes visible again', async () => {
    vi.useFakeTimers();
    resetStore();
    vi.clearAllMocks();

    await act(async () => {
      renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    // Hide
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Show again — should immediately fetch
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('resets store on unmount', async () => {
    let hookResult: ReturnType<typeof renderHook>;
    await act(async () => {
      hookResult = renderHook(() => useAnalytics('ws-1'));
    });

    act(() => {
      useAnalyticsStore.getState().setActiveTab('credits');
    });

    hookResult!.unmount();

    const state = useAnalyticsStore.getState();
    expect(state.activeTab).toBe('enrichment');
  });

  it('cleans up interval on unmount', async () => {
    vi.useFakeTimers();
    resetStore();
    vi.clearAllMocks();

    let hookResult: ReturnType<typeof renderHook>;
    await act(async () => {
      hookResult = renderHook(() => useAnalytics('ws-1'));
    });
    vi.clearAllMocks();

    hookResult!.unmount();

    // Advance 60s — should NOT fetch since interval was cleared
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(analyticsApi.getEnrichmentSummary).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
