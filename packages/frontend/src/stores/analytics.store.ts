import { create } from 'zustand';
import type {
  ActiveTab,
  TimeRangePreset,
  EnrichmentSummary,
  ProviderBreakdown,
  FieldBreakdown,
  TimeSeriesPoint,
  ScrapingSummary,
  DomainBreakdown,
  TargetTypeBreakdown,
  CreditSummary,
  CreditProviderBreakdown,
  CreditSourceBreakdown,
  CreditTimeSeriesPoint,
} from '@/types/analytics.types';
import * as analyticsApi from '@/api/analytics.api';

export interface AnalyticsState {
  // Filters
  activeTab: ActiveTab;
  timeRangePreset: TimeRangePreset | null;
  customTimeRange: { start: string; end: string } | null;
  selectedProvider: string | null;

  // Enrichment data
  enrichmentSummary: EnrichmentSummary | null;
  enrichmentByProvider: ProviderBreakdown[];
  enrichmentByField: FieldBreakdown[];
  enrichmentOverTime: TimeSeriesPoint[];

  // Scraping data
  scrapingSummary: ScrapingSummary | null;
  scrapingByDomain: DomainBreakdown[];
  scrapingByType: TargetTypeBreakdown[];
  scrapingOverTime: TimeSeriesPoint[];

  // Credits data
  creditSummary: CreditSummary | null;
  creditByProvider: CreditProviderBreakdown[];
  creditBySource: CreditSourceBreakdown[];
  creditOverTime: CreditTimeSeriesPoint[];

  // UI state
  isLoading: Record<string, boolean>;
  error: string | null;

  // Actions
  setActiveTab: (tab: ActiveTab) => void;
  setTimeRange: (preset: TimeRangePreset) => void;
  setCustomTimeRange: (start: string, end: string) => void;
  setSelectedProvider: (slug: string | null) => void;
  fetchEnrichmentData: (workspaceId: string) => Promise<void>;
  fetchScrapingData: (workspaceId: string) => Promise<void>;
  fetchCreditData: (workspaceId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  activeTab: 'enrichment' as ActiveTab,
  timeRangePreset: '30d' as TimeRangePreset,
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

  isLoading: {} as Record<string, boolean>,
  error: null,
};

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  ...initialState,

  setActiveTab: (tab) => set({ activeTab: tab }),

  setTimeRange: (preset) =>
    set({ timeRangePreset: preset, customTimeRange: null }),

  setCustomTimeRange: (start, end) =>
    set({ timeRangePreset: null, customTimeRange: { start, end } }),

  setSelectedProvider: (slug) => set({ selectedProvider: slug }),

  fetchEnrichmentData: async (workspaceId) => {
    const { timeRangePreset, customTimeRange } = get();
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };

    set((s) => ({
      isLoading: { ...s.isLoading, enrichmentSummary: true, enrichmentByProvider: true, enrichmentByField: true, enrichmentOverTime: true },
      error: null,
    }));

    try {
      const [summary, byProvider, byField, overTime] = await Promise.all([
        analyticsApi.getEnrichmentSummary(workspaceId, timeRange),
        analyticsApi.getEnrichmentByProvider(workspaceId, timeRange),
        analyticsApi.getEnrichmentByField(workspaceId, timeRange),
        analyticsApi.getEnrichmentOverTime(workspaceId, timeRange),
      ]);

      set((s) => ({
        enrichmentSummary: summary,
        enrichmentByProvider: byProvider,
        enrichmentByField: byField,
        enrichmentOverTime: overTime,
        isLoading: {
          ...s.isLoading,
          enrichmentSummary: false,
          enrichmentByProvider: false,
          enrichmentByField: false,
          enrichmentOverTime: false,
        },
      }));
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : String(err),
        isLoading: {
          ...s.isLoading,
          enrichmentSummary: false,
          enrichmentByProvider: false,
          enrichmentByField: false,
          enrichmentOverTime: false,
        },
      }));
    }
  },

  fetchScrapingData: async (workspaceId) => {
    const { timeRangePreset, customTimeRange } = get();
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };

    set((s) => ({
      isLoading: { ...s.isLoading, scrapingSummary: true, scrapingByDomain: true, scrapingByType: true, scrapingOverTime: true },
      error: null,
    }));

    try {
      const [summary, byDomain, byType, overTime] = await Promise.all([
        analyticsApi.getScrapingSummary(workspaceId, timeRange),
        analyticsApi.getScrapingByDomain(workspaceId, timeRange),
        analyticsApi.getScrapingByType(workspaceId, timeRange),
        analyticsApi.getScrapingOverTime(workspaceId, timeRange),
      ]);

      set((s) => ({
        scrapingSummary: summary,
        scrapingByDomain: byDomain,
        scrapingByType: byType,
        scrapingOverTime: overTime,
        isLoading: {
          ...s.isLoading,
          scrapingSummary: false,
          scrapingByDomain: false,
          scrapingByType: false,
          scrapingOverTime: false,
        },
      }));
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : String(err),
        isLoading: {
          ...s.isLoading,
          scrapingSummary: false,
          scrapingByDomain: false,
          scrapingByType: false,
          scrapingOverTime: false,
        },
      }));
    }
  },

  fetchCreditData: async (workspaceId) => {
    const { timeRangePreset, customTimeRange } = get();
    const timeRange = customTimeRange
      ? { start: customTimeRange.start, end: customTimeRange.end }
      : { preset: timeRangePreset };

    set((s) => ({
      isLoading: { ...s.isLoading, creditSummary: true, creditByProvider: true, creditBySource: true, creditOverTime: true },
      error: null,
    }));

    try {
      const [summary, byProvider, bySource, overTime] = await Promise.all([
        analyticsApi.getCreditSummary(workspaceId, timeRange),
        analyticsApi.getCreditByProvider(workspaceId, timeRange),
        analyticsApi.getCreditBySource(workspaceId, timeRange),
        analyticsApi.getCreditOverTime(workspaceId, timeRange),
      ]);

      set((s) => ({
        creditSummary: summary,
        creditByProvider: byProvider,
        creditBySource: bySource,
        creditOverTime: overTime,
        isLoading: {
          ...s.isLoading,
          creditSummary: false,
          creditByProvider: false,
          creditBySource: false,
          creditOverTime: false,
        },
      }));
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : String(err),
        isLoading: {
          ...s.isLoading,
          creditSummary: false,
          creditByProvider: false,
          creditBySource: false,
          creditOverTime: false,
        },
      }));
    }
  },

  reset: () => set(initialState),
}));
