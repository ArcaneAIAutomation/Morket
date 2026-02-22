import { getClickHouse } from '../../clickhouse/client';
import { createCacheKey, type AnalyticsCache } from './analytics.cache';
import type { TimeRange, Granularity } from './analytics.schemas';

// --- Response Interfaces ---

export interface EnrichmentSummary {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successRate: number; // 0–100 percentage
  totalCredits: number;
  avgDurationMs: number;
}

export interface ProviderBreakdown {
  providerSlug: string;
  attempts: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  totalCredits: number;
}

export interface FieldBreakdown {
  fieldName: string;
  attempts: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface TimeSeriesPoint {
  timestamp: string; // ISO 8601
  attempts: number;
  successes: number;
  failures: number;
}

// --- Scraping Interfaces ---

export interface ScrapingSummary {
  totalTasks: number;
  completedCount: number;
  failedCount: number;
  successRate: number;
  avgDurationMs: number;
}

export interface DomainBreakdown {
  domain: string;
  tasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
}

export interface TargetTypeBreakdown {
  targetType: string;
  tasks: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

// --- Credit Interfaces ---

export interface CreditSummary {
  totalDebited: number;
  totalRefunded: number;
  totalToppedUp: number;
  netConsumption: number;
}

export interface CreditProviderBreakdown {
  providerSlug: string;
  creditsConsumed: number;
  percentageOfTotal: number;
}

export interface CreditSourceBreakdown {
  source: string; // 'enrichment' | 'scraping' | 'manual'
  creditsConsumed: number;
  percentageOfTotal: number;
}

export interface CreditTimeSeriesPoint {
  timestamp: string;
  debited: number;
  refunded: number;
  toppedUp: number;
}

// --- Granularity → ClickHouse function mapping ---

const GRANULARITY_FUNCTIONS: Record<Granularity, string> = {
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
  week: 'toStartOfWeek',
};

// --- Factory ---

/**
 * Creates an analytics service with enrichment query methods.
 * All queries use parameterized ClickHouse bindings for injection prevention
 * and are scoped to a single workspace_id. Results are cache-wrapped.
 *
 * Scraping and credit queries will be added in Task 7.
 */
export function createAnalyticsService(cache: AnalyticsCache) {
  const ch = getClickHouse();

  /**
   * Helper: check cache first, on miss execute queryFn and cache the result.
   */
  async function withCache<T>(
    workspaceId: string,
    queryType: string,
    params: Record<string, unknown>,
    queryFn: () => Promise<T>,
  ): Promise<T> {
    const key = createCacheKey(workspaceId, queryType, params);
    const cached = cache.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const result = await queryFn();
    cache.set(key, result);
    return result;
  }

  /**
   * Builds the standard time-range query params for ClickHouse parameterized bindings.
   */
  function timeRangeParams(workspaceId: string, timeRange: TimeRange) {
    return {
      workspaceId,
      start: timeRange.start.toISOString(),
      end: timeRange.end.toISOString(),
    };
  }

  // --- Enrichment Queries ---

  async function getEnrichmentSummary(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<EnrichmentSummary> {
    return withCache(
      workspaceId,
      'enrichment-summary',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              count() AS totalAttempts,
              countIf(status = 'success') AS successCount,
              countIf(status = 'failed') AS failureCount,
              countIf(status = 'skipped') AS skippedCount,
              if(count() = 0, 0, round(countIf(status = 'success') / count() * 100, 2)) AS successRate,
              sum(credits_consumed) AS totalCredits,
              avg(duration_ms) AS avgDurationMs
            FROM enrichment_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        const row = rows[0];

        if (!row) {
          return {
            totalAttempts: 0,
            successCount: 0,
            failureCount: 0,
            skippedCount: 0,
            successRate: 0,
            totalCredits: 0,
            avgDurationMs: 0,
          };
        }

        return {
          totalAttempts: Number(row.totalAttempts),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          skippedCount: Number(row.skippedCount),
          successRate: Number(row.successRate),
          totalCredits: Number(row.totalCredits),
          avgDurationMs: Number(row.avgDurationMs) || 0,
        };
      },
    );
  }

  async function getEnrichmentByProvider(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<ProviderBreakdown[]> {
    return withCache(
      workspaceId,
      'enrichment-by-provider',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              provider_slug AS providerSlug,
              count() AS attempts,
              countIf(status = 'success') AS successCount,
              countIf(status = 'failed') AS failureCount,
              if(count() = 0, 0, round(countIf(status = 'success') / count() * 100, 2)) AS successRate,
              avg(duration_ms) AS avgDurationMs,
              sum(credits_consumed) AS totalCredits
            FROM enrichment_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY provider_slug
            ORDER BY attempts DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          providerSlug: row.providerSlug,
          attempts: Number(row.attempts),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          successRate: Number(row.successRate),
          avgDurationMs: Number(row.avgDurationMs) || 0,
          totalCredits: Number(row.totalCredits),
        }));
      },
    );
  }

  async function getEnrichmentByField(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<FieldBreakdown[]> {
    return withCache(
      workspaceId,
      'enrichment-by-field',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              enrichment_field AS fieldName,
              count() AS attempts,
              countIf(status = 'success') AS successCount,
              countIf(status = 'failed') AS failureCount,
              if(count() = 0, 0, round(countIf(status = 'success') / count() * 100, 2)) AS successRate
            FROM enrichment_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY enrichment_field
            ORDER BY attempts DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          fieldName: row.fieldName,
          attempts: Number(row.attempts),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          successRate: Number(row.successRate),
        }));
      },
    );
  }

  async function getEnrichmentOverTime(
    workspaceId: string,
    timeRange: TimeRange,
    granularity: Granularity,
  ): Promise<TimeSeriesPoint[]> {
    return withCache(
      workspaceId,
      'enrichment-over-time',
      {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
        granularity,
      },
      async () => {
        const bucketFn = GRANULARITY_FUNCTIONS[granularity];

        const result = await ch.query({
          query: `
            SELECT
              ${bucketFn}(created_at) AS timestamp,
              count() AS attempts,
              countIf(status = 'success') AS successes,
              countIf(status = 'failed') AS failures
            FROM enrichment_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY timestamp
            ORDER BY timestamp ASC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          timestamp: new Date(row.timestamp).toISOString(),
          attempts: Number(row.attempts),
          successes: Number(row.successes),
          failures: Number(row.failures),
        }));
      },
    );
  }

  // --- Scraping Queries ---

  async function getScrapingSummary(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<ScrapingSummary> {
    return withCache(
      workspaceId,
      'scraping-summary',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              count() AS totalTasks,
              countIf(status = 'completed') AS completedCount,
              countIf(status = 'failed') AS failedCount,
              if(count() = 0, 0, round(countIf(status = 'completed') / count() * 100, 2)) AS successRate,
              avg(duration_ms) AS avgDurationMs
            FROM scrape_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        const row = rows[0];

        if (!row) {
          return {
            totalTasks: 0,
            completedCount: 0,
            failedCount: 0,
            successRate: 0,
            avgDurationMs: 0,
          };
        }

        return {
          totalTasks: Number(row.totalTasks),
          completedCount: Number(row.completedCount),
          failedCount: Number(row.failedCount),
          successRate: Number(row.successRate),
          avgDurationMs: Number(row.avgDurationMs) || 0,
        };
      },
    );
  }

  async function getScrapingByDomain(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<DomainBreakdown[]> {
    return withCache(
      workspaceId,
      'scraping-by-domain',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              target_domain AS domain,
              count() AS tasks,
              countIf(status = 'completed') AS successCount,
              countIf(status = 'failed') AS failureCount,
              if(count() = 0, 0, round(countIf(status = 'completed') / count() * 100, 2)) AS successRate,
              avg(duration_ms) AS avgDurationMs
            FROM scrape_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY target_domain
            ORDER BY tasks DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          domain: row.domain,
          tasks: Number(row.tasks),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          successRate: Number(row.successRate),
          avgDurationMs: Number(row.avgDurationMs) || 0,
        }));
      },
    );
  }

  async function getScrapingByType(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<TargetTypeBreakdown[]> {
    return withCache(
      workspaceId,
      'scraping-by-type',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              target_type AS targetType,
              count() AS tasks,
              countIf(status = 'completed') AS successCount,
              countIf(status = 'failed') AS failureCount,
              if(count() = 0, 0, round(countIf(status = 'completed') / count() * 100, 2)) AS successRate
            FROM scrape_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY target_type
            ORDER BY tasks DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          targetType: row.targetType,
          tasks: Number(row.tasks),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          successRate: Number(row.successRate),
        }));
      },
    );
  }

  async function getScrapingOverTime(
    workspaceId: string,
    timeRange: TimeRange,
    granularity: Granularity,
  ): Promise<TimeSeriesPoint[]> {
    return withCache(
      workspaceId,
      'scraping-over-time',
      {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
        granularity,
      },
      async () => {
        const bucketFn = GRANULARITY_FUNCTIONS[granularity];

        const result = await ch.query({
          query: `
            SELECT
              ${bucketFn}(created_at) AS timestamp,
              count() AS attempts,
              countIf(status = 'completed') AS successes,
              countIf(status = 'failed') AS failures
            FROM scrape_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY timestamp
            ORDER BY timestamp ASC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          timestamp: new Date(row.timestamp).toISOString(),
          attempts: Number(row.attempts),
          successes: Number(row.successes),
          failures: Number(row.failures),
        }));
      },
    );
  }

  // --- Credit Queries ---

  async function getCreditSummary(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<CreditSummary> {
    return withCache(
      workspaceId,
      'credit-summary',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              sumIf(amount, transaction_type = 'debit') AS totalDebited,
              sumIf(amount, transaction_type = 'refund') AS totalRefunded,
              sumIf(amount, transaction_type = 'topup') AS totalToppedUp
            FROM credit_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        const row = rows[0];

        if (!row) {
          return {
            totalDebited: 0,
            totalRefunded: 0,
            totalToppedUp: 0,
            netConsumption: 0,
          };
        }

        const totalDebited = Number(row.totalDebited);
        const totalRefunded = Number(row.totalRefunded);
        const totalToppedUp = Number(row.totalToppedUp);

        return {
          totalDebited,
          totalRefunded,
          totalToppedUp,
          netConsumption: totalDebited - totalRefunded,
        };
      },
    );
  }

  async function getCreditByProvider(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<CreditProviderBreakdown[]> {
    return withCache(
      workspaceId,
      'credit-by-provider',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              provider_slug AS providerSlug,
              sum(amount) AS creditsConsumed
            FROM credit_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
              AND transaction_type = 'debit'
            GROUP BY provider_slug
            ORDER BY creditsConsumed DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        const totalConsumed = rows.reduce((sum, r) => sum + Number(r.creditsConsumed), 0);

        return rows.map((row) => {
          const consumed = Number(row.creditsConsumed);
          return {
            providerSlug: row.providerSlug,
            creditsConsumed: consumed,
            percentageOfTotal: totalConsumed === 0 ? 0 : Math.round((consumed / totalConsumed) * 10000) / 100,
          };
        });
      },
    );
  }

  async function getCreditBySource(
    workspaceId: string,
    timeRange: TimeRange,
  ): Promise<CreditSourceBreakdown[]> {
    return withCache(
      workspaceId,
      'credit-by-source',
      { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
      async () => {
        const result = await ch.query({
          query: `
            SELECT
              source,
              sum(amount) AS creditsConsumed
            FROM credit_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY source
            ORDER BY creditsConsumed DESC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        const totalConsumed = rows.reduce((sum, r) => sum + Number(r.creditsConsumed), 0);

        return rows.map((row) => {
          const consumed = Number(row.creditsConsumed);
          return {
            source: row.source,
            creditsConsumed: consumed,
            percentageOfTotal: totalConsumed === 0 ? 0 : Math.round((consumed / totalConsumed) * 10000) / 100,
          };
        });
      },
    );
  }

  async function getCreditOverTime(
    workspaceId: string,
    timeRange: TimeRange,
    granularity: Granularity,
  ): Promise<CreditTimeSeriesPoint[]> {
    return withCache(
      workspaceId,
      'credit-over-time',
      {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
        granularity,
      },
      async () => {
        const bucketFn = GRANULARITY_FUNCTIONS[granularity];

        const result = await ch.query({
          query: `
            SELECT
              ${bucketFn}(created_at) AS timestamp,
              sumIf(amount, transaction_type = 'debit') AS debited,
              sumIf(amount, transaction_type = 'refund') AS refunded,
              sumIf(amount, transaction_type = 'topup') AS toppedUp
            FROM credit_events
            WHERE workspace_id = {workspaceId:UUID}
              AND created_at BETWEEN {start:DateTime64} AND {end:DateTime64}
            GROUP BY timestamp
            ORDER BY timestamp ASC
          `,
          query_params: timeRangeParams(workspaceId, timeRange),
          format: 'JSONEachRow',
        });

        const rows = await result.json<Record<string, string>>();
        return rows.map((row) => ({
          timestamp: new Date(row.timestamp).toISOString(),
          debited: Number(row.debited),
          refunded: Number(row.refunded),
          toppedUp: Number(row.toppedUp),
        }));
      },
    );
  }

  return {
    getEnrichmentSummary,
    getEnrichmentByProvider,
    getEnrichmentByField,
    getEnrichmentOverTime,
    getScrapingSummary,
    getScrapingByDomain,
    getScrapingByType,
    getScrapingOverTime,
    getCreditSummary,
    getCreditByProvider,
    getCreditBySource,
    getCreditOverTime,
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
