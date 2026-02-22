import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAnalyticsStore } from './analytics.store';

vi.mock('@/api/analytics.api', () => ({
  getEnrichmentSummary: vi.fn(),
  getEnrichmentByProvider: vi.fn(),
  getEnrichmentByField: vi.fn(),
  getEnrichmentOverTime: vi.fn(),
  getScrapingSummary: vi.fn(),
  getScrapingByDomain: vi.fn(),
  getScrapingByType: vi.fn(),
  getScrapingOverTime: vi.fn(),
  getCreditSummary: vi.fn(),
  getCreditByProvider: vi.fn(),
  getCreditBySource: vi.fn(),
  getCreditOverTime: vi.fn(),
}));

import * as analyticsApi from '@/api/analytics.api';

const mockEnrichmentSummary = {
  totalAttempts: 100,
  successCount: 80,
  failureCount: 15,
  skippedCount: 5,
  successRate: 80,
  totalCredits: 200,
  avgDurationMs: 350,
};

const mockProviderBreakdown = [
  { providerSlug: 'apollo', attempts: 50, successCount: 40, failureCount: 10, successRate: 80, avgDurationMs: 300, totalCredits: 100 },
];

const mockFieldBreakdown = [
  { fieldName: 'email', attempts: 60, successCount: 50, failureCount: 10, successRate: 83.3 },
];

const mockTimeSeries = [
  { timestamp: '2024-01-01T00:00:00Z', attempts: 10, successes: 8, failures: 2 },
];

describe('analytics.store', () => {
  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  describe('setActiveTab', () => {
    it('switches to scraping tab', () => {
      useAnalyticsStore.getState().setActiveTab('scraping');
      expect(useAnalyticsStore.getState().activeTab).toBe('scraping');
    });

    it('switches to credits tab', () => {
      useAnalyticsStore.getState().setActiveTab('credits');
      expect(useAnalyticsStore.getState().activeTab).toBe('credits');
    });

    it('switches back to enrichment tab', () => {
      useAnalyticsStore.getState().setActiveTab('credits');
      useAnalyticsStore.getState().setActiveTab('enrichment');
      expect(useAnalyticsStore.getState().activeTab).toBe('enrichment');
    });
  });

  describe('setTimeRange', () => {
    it('sets preset and clears custom range', () => {
      useAnalyticsStore.getState().setCustomTimeRange('2024-01-01', '2024-01-31');
      useAnalyticsStore.getState().setTimeRange('7d');

      const state = useAnalyticsStore.getState();
      expect(state.timeRangePreset).toBe('7d');
      expect(state.customTimeRange).toBeNull();
    });
  });

  describe('setCustomTimeRange', () => {
    it('sets custom range and clears preset', () => {
      useAnalyticsStore.getState().setCustomTimeRange('2024-01-01', '2024-03-01');

      const state = useAnalyticsStore.getState();
      expect(state.customTimeRange).toEqual({ start: '2024-01-01', end: '2024-03-01' });
      expect(state.timeRangePreset).toBeNull();
    });
  });

  describe('setSelectedProvider', () => {
    it('sets provider slug for drill-down', () => {
      useAnalyticsStore.getState().setSelectedProvider('apollo');
      expect(useAnalyticsStore.getState().selectedProvider).toBe('apollo');
    });

    it('clears provider selection', () => {
      useAnalyticsStore.getState().setSelectedProvider('apollo');
      useAnalyticsStore.getState().setSelectedProvider(null);
      expect(useAnalyticsStore.getState().selectedProvider).toBeNull();
    });
  });

  describe('fetchEnrichmentData', () => {
    it('sets loading flags, fetches data, and clears loading', async () => {
      vi.mocked(analyticsApi.getEnrichmentSummary).mockResolvedValue(mockEnrichmentSummary);
      vi.mocked(analyticsApi.getEnrichmentByProvider).mockResolvedValue(mockProviderBreakdown);
      vi.mocked(analyticsApi.getEnrichmentByField).mockResolvedValue(mockFieldBreakdown);
      vi.mocked(analyticsApi.getEnrichmentOverTime).mockResolvedValue(mockTimeSeries);

      const promise = useAnalyticsStore.getState().fetchEnrichmentData('ws-1');

      // Loading flags should be set
      expect(useAnalyticsStore.getState().isLoading.enrichmentSummary).toBe(true);
      expect(useAnalyticsStore.getState().isLoading.enrichmentByProvider).toBe(true);

      await promise;

      const state = useAnalyticsStore.getState();
      expect(state.enrichmentSummary).toEqual(mockEnrichmentSummary);
      expect(state.enrichmentByProvider).toEqual(mockProviderBreakdown);
      expect(state.enrichmentByField).toEqual(mockFieldBreakdown);
      expect(state.enrichmentOverTime).toEqual(mockTimeSeries);
      expect(state.isLoading.enrichmentSummary).toBe(false);
      expect(state.error).toBeNull();
    });

    it('passes preset time range to API', async () => {
      vi.mocked(analyticsApi.getEnrichmentSummary).mockResolvedValue(mockEnrichmentSummary);
      vi.mocked(analyticsApi.getEnrichmentByProvider).mockResolvedValue([]);
      vi.mocked(analyticsApi.getEnrichmentByField).mockResolvedValue([]);
      vi.mocked(analyticsApi.getEnrichmentOverTime).mockResolvedValue([]);

      useAnalyticsStore.getState().setTimeRange('7d');
      await useAnalyticsStore.getState().fetchEnrichmentData('ws-1');

      expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalledWith('ws-1', { preset: '7d' });
    });

    it('passes custom time range to API', async () => {
      vi.mocked(analyticsApi.getEnrichmentSummary).mockResolvedValue(mockEnrichmentSummary);
      vi.mocked(analyticsApi.getEnrichmentByProvider).mockResolvedValue([]);
      vi.mocked(analyticsApi.getEnrichmentByField).mockResolvedValue([]);
      vi.mocked(analyticsApi.getEnrichmentOverTime).mockResolvedValue([]);

      useAnalyticsStore.getState().setCustomTimeRange('2024-01-01', '2024-03-01');
      await useAnalyticsStore.getState().fetchEnrichmentData('ws-1');

      expect(analyticsApi.getEnrichmentSummary).toHaveBeenCalledWith('ws-1', {
        start: '2024-01-01',
        end: '2024-03-01',
      });
    });

    it('sets error on failure and clears loading', async () => {
      vi.mocked(analyticsApi.getEnrichmentSummary).mockRejectedValue(new Error('Network error'));
      vi.mocked(analyticsApi.getEnrichmentByProvider).mockRejectedValue(new Error('Network error'));
      vi.mocked(analyticsApi.getEnrichmentByField).mockRejectedValue(new Error('Network error'));
      vi.mocked(analyticsApi.getEnrichmentOverTime).mockRejectedValue(new Error('Network error'));

      await useAnalyticsStore.getState().fetchEnrichmentData('ws-1');

      const state = useAnalyticsStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading.enrichmentSummary).toBe(false);
    });
  });

  describe('fetchScrapingData', () => {
    it('fetches scraping data and stores it', async () => {
      const summary = { totalTasks: 50, completedCount: 40, failedCount: 10, successRate: 80, avgDurationMs: 500 };
      const byDomain = [{ domain: 'example.com', tasks: 20, successCount: 18, failureCount: 2, successRate: 90, avgDurationMs: 400 }];
      const byType = [{ targetType: 'linkedin_profile', tasks: 30, successCount: 25, failureCount: 5, successRate: 83.3 }];
      const overTime = [{ timestamp: '2024-01-01T00:00:00Z', attempts: 10, successes: 8, failures: 2 }];

      vi.mocked(analyticsApi.getScrapingSummary).mockResolvedValue(summary);
      vi.mocked(analyticsApi.getScrapingByDomain).mockResolvedValue(byDomain);
      vi.mocked(analyticsApi.getScrapingByType).mockResolvedValue(byType);
      vi.mocked(analyticsApi.getScrapingOverTime).mockResolvedValue(overTime);

      await useAnalyticsStore.getState().fetchScrapingData('ws-1');

      const state = useAnalyticsStore.getState();
      expect(state.scrapingSummary).toEqual(summary);
      expect(state.scrapingByDomain).toEqual(byDomain);
      expect(state.scrapingByType).toEqual(byType);
      expect(state.scrapingOverTime).toEqual(overTime);
      expect(state.isLoading.scrapingSummary).toBe(false);
    });
  });

  describe('fetchCreditData', () => {
    it('fetches credit data and stores it', async () => {
      const summary = { totalDebited: 500, totalRefunded: 50, totalToppedUp: 1000, netConsumption: 450 };
      const byProvider = [{ providerSlug: 'apollo', creditsConsumed: 300, percentageOfTotal: 60 }];
      const bySource = [{ source: 'enrichment', creditsConsumed: 400, percentageOfTotal: 80 }];
      const overTime = [{ timestamp: '2024-01-01T00:00:00Z', debited: 20, refunded: 2, toppedUp: 0 }];

      vi.mocked(analyticsApi.getCreditSummary).mockResolvedValue(summary);
      vi.mocked(analyticsApi.getCreditByProvider).mockResolvedValue(byProvider);
      vi.mocked(analyticsApi.getCreditBySource).mockResolvedValue(bySource);
      vi.mocked(analyticsApi.getCreditOverTime).mockResolvedValue(overTime);

      await useAnalyticsStore.getState().fetchCreditData('ws-1');

      const state = useAnalyticsStore.getState();
      expect(state.creditSummary).toEqual(summary);
      expect(state.creditByProvider).toEqual(byProvider);
      expect(state.creditBySource).toEqual(bySource);
      expect(state.creditOverTime).toEqual(overTime);
      expect(state.isLoading.creditSummary).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      vi.mocked(analyticsApi.getEnrichmentSummary).mockResolvedValue(mockEnrichmentSummary);
      vi.mocked(analyticsApi.getEnrichmentByProvider).mockResolvedValue(mockProviderBreakdown);
      vi.mocked(analyticsApi.getEnrichmentByField).mockResolvedValue(mockFieldBreakdown);
      vi.mocked(analyticsApi.getEnrichmentOverTime).mockResolvedValue(mockTimeSeries);

      await useAnalyticsStore.getState().fetchEnrichmentData('ws-1');
      useAnalyticsStore.getState().setActiveTab('credits');
      useAnalyticsStore.getState().setSelectedProvider('apollo');

      useAnalyticsStore.getState().reset();

      const state = useAnalyticsStore.getState();
      expect(state.activeTab).toBe('enrichment');
      expect(state.timeRangePreset).toBe('30d');
      expect(state.selectedProvider).toBeNull();
      expect(state.enrichmentSummary).toBeNull();
      expect(state.enrichmentByProvider).toEqual([]);
      expect(state.error).toBeNull();
    });
  });
});
