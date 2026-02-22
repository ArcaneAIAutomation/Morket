import { apiClient } from '@/api/client';
import type {
  TimeRangePreset,
  Granularity,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TimeRangeParams {
  preset?: TimeRangePreset | null;
  start?: string;
  end?: string;
}

function buildTimeRangeQuery(params: TimeRangeParams): Record<string, string> {
  if (params.preset) return { preset: params.preset };
  if (params.start && params.end) return { start: params.start, end: params.end };
  return { preset: '30d' };
}

function basePath(workspaceId: string) {
  return `/workspaces/${workspaceId}/analytics`;
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

export function getEnrichmentSummary(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<EnrichmentSummary> {
  return apiClient.get(`${basePath(workspaceId)}/enrichment/summary`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getEnrichmentByProvider(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<ProviderBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/enrichment/by-provider`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getEnrichmentByField(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<FieldBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/enrichment/by-field`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getEnrichmentOverTime(
  workspaceId: string,
  timeRange: TimeRangeParams,
  granularity: Granularity = 'day',
): Promise<TimeSeriesPoint[]> {
  return apiClient.get(`${basePath(workspaceId)}/enrichment/over-time`, {
    params: { ...buildTimeRangeQuery(timeRange), granularity },
  });
}

export function exportEnrichmentCSV(
  workspaceId: string,
  timeRange: TimeRangeParams,
): string {
  const params = new URLSearchParams({ format: 'csv', ...buildTimeRangeQuery(timeRange) });
  return `/api/v1${basePath(workspaceId)}/enrichment/export?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

export function getScrapingSummary(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<ScrapingSummary> {
  return apiClient.get(`${basePath(workspaceId)}/scraping/summary`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getScrapingByDomain(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<DomainBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/scraping/by-domain`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getScrapingByType(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<TargetTypeBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/scraping/by-type`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getScrapingOverTime(
  workspaceId: string,
  timeRange: TimeRangeParams,
  granularity: Granularity = 'day',
): Promise<TimeSeriesPoint[]> {
  return apiClient.get(`${basePath(workspaceId)}/scraping/over-time`, {
    params: { ...buildTimeRangeQuery(timeRange), granularity },
  });
}

export function exportScrapingCSV(
  workspaceId: string,
  timeRange: TimeRangeParams,
): string {
  const params = new URLSearchParams({ format: 'csv', ...buildTimeRangeQuery(timeRange) });
  return `/api/v1${basePath(workspaceId)}/scraping/export?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export function getCreditSummary(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<CreditSummary> {
  return apiClient.get(`${basePath(workspaceId)}/credits/summary`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getCreditByProvider(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<CreditProviderBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/credits/by-provider`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getCreditBySource(
  workspaceId: string,
  timeRange: TimeRangeParams,
): Promise<CreditSourceBreakdown[]> {
  return apiClient.get(`${basePath(workspaceId)}/credits/by-source`, {
    params: buildTimeRangeQuery(timeRange),
  });
}

export function getCreditOverTime(
  workspaceId: string,
  timeRange: TimeRangeParams,
  granularity: Granularity = 'day',
): Promise<CreditTimeSeriesPoint[]> {
  return apiClient.get(`${basePath(workspaceId)}/credits/over-time`, {
    params: { ...buildTimeRangeQuery(timeRange), granularity },
  });
}

export function exportCreditCSV(
  workspaceId: string,
  timeRange: TimeRangeParams,
): string {
  const params = new URLSearchParams({ format: 'csv', ...buildTimeRangeQuery(timeRange) });
  return `/api/v1${basePath(workspaceId)}/credits/export?${params.toString()}`;
}
