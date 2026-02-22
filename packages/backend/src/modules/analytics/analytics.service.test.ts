import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAnalyticsService,
  type AnalyticsService,
  type ScrapingSummary,
  type DomainBreakdown,
  type TargetTypeBreakdown,
  type CreditSummary,
  type CreditProviderBreakdown,
  type CreditSourceBreakdown,
  type CreditTimeSeriesPoint,
} from './analytics.service';
import { createAnalyticsCache, type AnalyticsCache } from './analytics.cache';
import type { TimeRange, Granularity } from './analytics.schemas';

// --- Mock ClickHouse client ---

const mockJson = vi.fn();
const mockQuery = vi.fn().mockResolvedValue({ json: mockJson });

vi.mock('../../clickhouse/client', () => ({
  getClickHouse: () => ({
    query: mockQuery,
  }),
}));

// --- Test helpers ---

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const TIME_RANGE: TimeRange = {
  start: new Date('2024-01-01T00:00:00.000Z'),
  end: new Date('2024-01-31T23:59:59.999Z'),
};

describe('analytics.service — enrichment queries', () => {
  let service: AnalyticsService;
  let cache: AnalyticsCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = createAnalyticsCache({ defaultTtlMs: 60_000, maxEntries: 100 });
    service = createAnalyticsService(cache);
  });

  // --- getEnrichmentSummary ---

  describe('getEnrichmentSummary', () => {
    it('executes parameterized query with workspace_id and time range', async () => {
      mockJson.mockResolvedValueOnce([
        {
          totalAttempts: '150',
          successCount: '120',
          failureCount: '20',
          skippedCount: '10',
          successRate: '80',
          totalCredits: '300',
          avgDurationMs: '450.5',
        },
      ]);

      const result = await service.getEnrichmentSummary(WORKSPACE_ID, TIME_RANGE);

      // Verify query was called
      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0][0];

      // Verify parameterized bindings
      expect(callArgs.query_params).toEqual({
        workspaceId: WORKSPACE_ID,
        start: TIME_RANGE.start.toISOString(),
        end: TIME_RANGE.end.toISOString(),
      });

      // Verify query contains workspace_id filter with parameterized binding
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('enrichment_events');
      expect(callArgs.format).toBe('JSONEachRow');

      // Verify result mapping
      expect(result).toEqual({
        totalAttempts: 150,
        successCount: 120,
        failureCount: 20,
        skippedCount: 10,
        successRate: 80,
        totalCredits: 300,
        avgDurationMs: 450.5,
      });
    });

    it('returns zero-value summary when no rows returned', async () => {
      mockJson.mockResolvedValueOnce([]);

      const result = await service.getEnrichmentSummary(WORKSPACE_ID, TIME_RANGE);

      expect(result).toEqual({
        totalAttempts: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        successRate: 0,
        totalCredits: 0,
        avgDurationMs: 0,
      });
    });

    it('returns cached result on second call without querying ClickHouse', async () => {
      mockJson.mockResolvedValueOnce([
        {
          totalAttempts: '10',
          successCount: '8',
          failureCount: '1',
          skippedCount: '1',
          successRate: '80',
          totalCredits: '20',
          avgDurationMs: '100',
        },
      ]);

      const first = await service.getEnrichmentSummary(WORKSPACE_ID, TIME_RANGE);
      const second = await service.getEnrichmentSummary(WORKSPACE_ID, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });
  });

  // --- getEnrichmentByProvider ---

  describe('getEnrichmentByProvider', () => {
    it('executes GROUP BY provider_slug query with workspace scoping', async () => {
      mockJson.mockResolvedValueOnce([
        {
          providerSlug: 'apollo',
          attempts: '100',
          successCount: '90',
          failureCount: '10',
          successRate: '90',
          avgDurationMs: '300',
          totalCredits: '200',
        },
        {
          providerSlug: 'clearbit',
          attempts: '50',
          successCount: '40',
          failureCount: '10',
          successRate: '80',
          avgDurationMs: '500',
          totalCredits: '100',
        },
      ]);

      const result = await service.getEnrichmentByProvider(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('GROUP BY provider_slug');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        providerSlug: 'apollo',
        attempts: 100,
        successCount: 90,
        failureCount: 10,
        successRate: 90,
        avgDurationMs: 300,
        totalCredits: 200,
      });
      expect(result[1].providerSlug).toBe('clearbit');
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getEnrichmentByProvider(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches provider breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getEnrichmentByProvider(WORKSPACE_ID, TIME_RANGE);
      await service.getEnrichmentByProvider(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getEnrichmentByField ---

  describe('getEnrichmentByField', () => {
    it('executes GROUP BY enrichment_field query with workspace scoping', async () => {
      mockJson.mockResolvedValueOnce([
        {
          fieldName: 'email',
          attempts: '200',
          successCount: '180',
          failureCount: '20',
          successRate: '90',
        },
        {
          fieldName: 'phone',
          attempts: '100',
          successCount: '60',
          failureCount: '40',
          successRate: '60',
        },
      ]);

      const result = await service.getEnrichmentByField(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('GROUP BY enrichment_field');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        fieldName: 'email',
        attempts: 200,
        successCount: 180,
        failureCount: 20,
        successRate: 90,
      });
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getEnrichmentByField(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches field breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getEnrichmentByField(WORKSPACE_ID, TIME_RANGE);
      await service.getEnrichmentByField(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getEnrichmentOverTime ---

  describe('getEnrichmentOverTime', () => {
    it('uses toStartOfHour for hour granularity', async () => {
      mockJson.mockResolvedValueOnce([
        { timestamp: '2024-01-15 10:00:00.000', attempts: '50', successes: '40', failures: '10' },
        { timestamp: '2024-01-15 11:00:00.000', attempts: '30', successes: '25', failures: '5' },
      ]);

      const result = await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('toStartOfHour(created_at)');
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0].attempts).toBe(50);
      expect(result[0].successes).toBe(40);
      expect(result[0].failures).toBe(10);
      // Timestamp should be ISO 8601
      expect(result[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses toStartOfDay for day granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'day');

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('toStartOfDay(created_at)');
    });

    it('uses toStartOfWeek for week granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'week');

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('toStartOfWeek(created_at)');
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(result).toEqual([]);
    });

    it('caches time-series results with granularity in key', async () => {
      mockJson.mockResolvedValueOnce([]);
      mockJson.mockResolvedValueOnce([]);

      await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      // Same granularity → cache hit
      expect(mockQuery).toHaveBeenCalledOnce();

      // Different granularity → cache miss
      await service.getEnrichmentOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  // --- Cross-cutting: workspace isolation ---

  describe('workspace isolation', () => {
    it('different workspace IDs produce separate cache entries', async () => {
      const ws2 = '22222222-2222-2222-2222-222222222222';
      mockJson.mockResolvedValue([
        {
          totalAttempts: '1',
          successCount: '1',
          failureCount: '0',
          skippedCount: '0',
          successRate: '100',
          totalCredits: '1',
          avgDurationMs: '10',
        },
      ]);

      await service.getEnrichmentSummary(WORKSPACE_ID, TIME_RANGE);
      await service.getEnrichmentSummary(ws2, TIME_RANGE);

      // Both should query CH (different workspace = different cache key)
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0].query_params.workspaceId).toBe(WORKSPACE_ID);
      expect(mockQuery.mock.calls[1][0].query_params.workspaceId).toBe(ws2);
    });
  });
});

// ============================================================
// Scraping Queries
// ============================================================

describe('analytics.service — scraping queries', () => {
  let service: AnalyticsService;
  let cache: AnalyticsCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = createAnalyticsCache({ defaultTtlMs: 60_000, maxEntries: 100 });
    service = createAnalyticsService(cache);
  });

  // --- getScrapingSummary ---

  describe('getScrapingSummary', () => {
    it('executes parameterized query with workspace_id and time range against scrape_events', async () => {
      mockJson.mockResolvedValueOnce([
        {
          totalTasks: '200',
          completedCount: '170',
          failedCount: '30',
          successRate: '85',
          avgDurationMs: '1200.5',
        },
      ]);

      const result = await service.getScrapingSummary(WORKSPACE_ID, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0][0];

      expect(callArgs.query_params).toEqual({
        workspaceId: WORKSPACE_ID,
        start: TIME_RANGE.start.toISOString(),
        end: TIME_RANGE.end.toISOString(),
      });
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('scrape_events');
      expect(callArgs.format).toBe('JSONEachRow');

      expect(result).toEqual({
        totalTasks: 200,
        completedCount: 170,
        failedCount: 30,
        successRate: 85,
        avgDurationMs: 1200.5,
      });
    });

    it('returns zero-value summary when no rows returned', async () => {
      mockJson.mockResolvedValueOnce([]);

      const result = await service.getScrapingSummary(WORKSPACE_ID, TIME_RANGE);

      expect(result).toEqual({
        totalTasks: 0,
        completedCount: 0,
        failedCount: 0,
        successRate: 0,
        avgDurationMs: 0,
      });
    });

    it('returns cached result on second call without querying ClickHouse', async () => {
      mockJson.mockResolvedValueOnce([
        {
          totalTasks: '10',
          completedCount: '8',
          failedCount: '2',
          successRate: '80',
          avgDurationMs: '500',
        },
      ]);

      const first = await service.getScrapingSummary(WORKSPACE_ID, TIME_RANGE);
      const second = await service.getScrapingSummary(WORKSPACE_ID, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });
  });

  // --- getScrapingByDomain ---

  describe('getScrapingByDomain', () => {
    it('executes GROUP BY target_domain query ordered by tasks DESC', async () => {
      mockJson.mockResolvedValueOnce([
        {
          domain: 'linkedin.com',
          tasks: '100',
          successCount: '90',
          failureCount: '10',
          successRate: '90',
          avgDurationMs: '800',
        },
        {
          domain: 'example.com',
          tasks: '50',
          successCount: '40',
          failureCount: '10',
          successRate: '80',
          avgDurationMs: '1200',
        },
      ]);

      const result = await service.getScrapingByDomain(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('GROUP BY target_domain');
      expect(callArgs.query).toContain('ORDER BY tasks DESC');
      expect(callArgs.query).toContain('scrape_events');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        domain: 'linkedin.com',
        tasks: 100,
        successCount: 90,
        failureCount: 10,
        successRate: 90,
        avgDurationMs: 800,
      });
      expect(result[1].domain).toBe('example.com');
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getScrapingByDomain(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches domain breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getScrapingByDomain(WORKSPACE_ID, TIME_RANGE);
      await service.getScrapingByDomain(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getScrapingByType ---

  describe('getScrapingByType', () => {
    it('executes GROUP BY target_type query with workspace scoping', async () => {
      mockJson.mockResolvedValueOnce([
        {
          targetType: 'linkedin_profile',
          tasks: '80',
          successCount: '70',
          failureCount: '10',
          successRate: '87.5',
        },
        {
          targetType: 'company_website',
          tasks: '60',
          successCount: '50',
          failureCount: '10',
          successRate: '83.33',
        },
      ]);

      const result = await service.getScrapingByType(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('GROUP BY target_type');
      expect(callArgs.query).toContain('scrape_events');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        targetType: 'linkedin_profile',
        tasks: 80,
        successCount: 70,
        failureCount: 10,
        successRate: 87.5,
      });
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getScrapingByType(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches type breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getScrapingByType(WORKSPACE_ID, TIME_RANGE);
      await service.getScrapingByType(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getScrapingOverTime ---

  describe('getScrapingOverTime', () => {
    it('uses toStartOfHour for hour granularity against scrape_events', async () => {
      mockJson.mockResolvedValueOnce([
        { timestamp: '2024-01-15 10:00:00.000', attempts: '50', successes: '40', failures: '10' },
      ]);

      const result = await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('toStartOfHour(created_at)');
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('scrape_events');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(1);
      expect(result[0].attempts).toBe(50);
      expect(result[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses toStartOfDay for day granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(mockQuery.mock.calls[0][0].query).toContain('toStartOfDay(created_at)');
    });

    it('uses toStartOfWeek for week granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'week');
      expect(mockQuery.mock.calls[0][0].query).toContain('toStartOfWeek(created_at)');
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(result).toEqual([]);
    });

    it('caches time-series results with granularity in key', async () => {
      mockJson.mockResolvedValueOnce([]);
      mockJson.mockResolvedValueOnce([]);

      await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      expect(mockQuery).toHaveBeenCalledOnce();

      await service.getScrapingOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  // --- Workspace isolation for scraping ---

  describe('workspace isolation', () => {
    it('different workspace IDs produce separate cache entries for scraping', async () => {
      const ws2 = '22222222-2222-2222-2222-222222222222';
      mockJson.mockResolvedValue([
        {
          totalTasks: '1',
          completedCount: '1',
          failedCount: '0',
          successRate: '100',
          avgDurationMs: '10',
        },
      ]);

      await service.getScrapingSummary(WORKSPACE_ID, TIME_RANGE);
      await service.getScrapingSummary(ws2, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0].query_params.workspaceId).toBe(WORKSPACE_ID);
      expect(mockQuery.mock.calls[1][0].query_params.workspaceId).toBe(ws2);
    });
  });
});

// ============================================================
// Credit Queries
// ============================================================

describe('analytics.service — credit queries', () => {
  let service: AnalyticsService;
  let cache: AnalyticsCache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = createAnalyticsCache({ defaultTtlMs: 60_000, maxEntries: 100 });
    service = createAnalyticsService(cache);
  });

  // --- getCreditSummary ---

  describe('getCreditSummary', () => {
    it('executes sumIf query by transaction_type against credit_events', async () => {
      mockJson.mockResolvedValueOnce([
        {
          totalDebited: '500',
          totalRefunded: '50',
          totalToppedUp: '1000',
        },
      ]);

      const result = await service.getCreditSummary(WORKSPACE_ID, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0][0];

      expect(callArgs.query_params).toEqual({
        workspaceId: WORKSPACE_ID,
        start: TIME_RANGE.start.toISOString(),
        end: TIME_RANGE.end.toISOString(),
      });
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('credit_events');
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'debit')");
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'refund')");
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'topup')");
      expect(callArgs.format).toBe('JSONEachRow');

      expect(result).toEqual({
        totalDebited: 500,
        totalRefunded: 50,
        totalToppedUp: 1000,
        netConsumption: 450, // 500 - 50
      });
    });

    it('returns zero-value summary when no rows returned', async () => {
      mockJson.mockResolvedValueOnce([]);

      const result = await service.getCreditSummary(WORKSPACE_ID, TIME_RANGE);

      expect(result).toEqual({
        totalDebited: 0,
        totalRefunded: 0,
        totalToppedUp: 0,
        netConsumption: 0,
      });
    });

    it('returns cached result on second call without querying ClickHouse', async () => {
      mockJson.mockResolvedValueOnce([
        { totalDebited: '100', totalRefunded: '10', totalToppedUp: '200' },
      ]);

      const first = await service.getCreditSummary(WORKSPACE_ID, TIME_RANGE);
      const second = await service.getCreditSummary(WORKSPACE_ID, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });
  });

  // --- getCreditByProvider ---

  describe('getCreditByProvider', () => {
    it('executes GROUP BY provider_slug query filtered to debit transactions', async () => {
      mockJson.mockResolvedValueOnce([
        { providerSlug: 'apollo', creditsConsumed: '300' },
        { providerSlug: 'clearbit', creditsConsumed: '200' },
      ]);

      const result = await service.getCreditByProvider(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain("transaction_type = 'debit'");
      expect(callArgs.query).toContain('GROUP BY provider_slug');
      expect(callArgs.query).toContain('credit_events');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        providerSlug: 'apollo',
        creditsConsumed: 300,
        percentageOfTotal: 60, // 300/500 * 100
      });
      expect(result[1]).toEqual({
        providerSlug: 'clearbit',
        creditsConsumed: 200,
        percentageOfTotal: 40, // 200/500 * 100
      });
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getCreditByProvider(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches provider credit breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getCreditByProvider(WORKSPACE_ID, TIME_RANGE);
      await service.getCreditByProvider(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getCreditBySource ---

  describe('getCreditBySource', () => {
    it('executes GROUP BY source query with workspace scoping', async () => {
      mockJson.mockResolvedValueOnce([
        { source: 'enrichment', creditsConsumed: '400' },
        { source: 'scraping', creditsConsumed: '80' },
        { source: 'manual', creditsConsumed: '20' },
      ]);

      const result = await service.getCreditBySource(WORKSPACE_ID, TIME_RANGE);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('created_at BETWEEN {start:DateTime64} AND {end:DateTime64}');
      expect(callArgs.query).toContain('GROUP BY source');
      expect(callArgs.query).toContain('credit_events');
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        source: 'enrichment',
        creditsConsumed: 400,
        percentageOfTotal: 80, // 400/500 * 100
      });
      expect(result[1]).toEqual({
        source: 'scraping',
        creditsConsumed: 80,
        percentageOfTotal: 16, // 80/500 * 100
      });
      expect(result[2]).toEqual({
        source: 'manual',
        creditsConsumed: 20,
        percentageOfTotal: 4, // 20/500 * 100
      });
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getCreditBySource(WORKSPACE_ID, TIME_RANGE);
      expect(result).toEqual([]);
    });

    it('caches source breakdown results', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getCreditBySource(WORKSPACE_ID, TIME_RANGE);
      await service.getCreditBySource(WORKSPACE_ID, TIME_RANGE);
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });

  // --- getCreditOverTime ---

  describe('getCreditOverTime', () => {
    it('uses toStartOfHour for hour granularity with sumIf per transaction_type', async () => {
      mockJson.mockResolvedValueOnce([
        { timestamp: '2024-01-15 10:00:00.000', debited: '100', refunded: '10', toppedUp: '0' },
        { timestamp: '2024-01-15 11:00:00.000', debited: '50', refunded: '5', toppedUp: '200' },
      ]);

      const result = await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.query).toContain('toStartOfHour(created_at)');
      expect(callArgs.query).toContain('workspace_id = {workspaceId:UUID}');
      expect(callArgs.query).toContain('credit_events');
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'debit')");
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'refund')");
      expect(callArgs.query).toContain("sumIf(amount, transaction_type = 'topup')");
      expect(callArgs.query_params.workspaceId).toBe(WORKSPACE_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        debited: 100,
        refunded: 10,
        toppedUp: 0,
      });
      expect(result[1].debited).toBe(50);
    });

    it('uses toStartOfDay for day granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(mockQuery.mock.calls[0][0].query).toContain('toStartOfDay(created_at)');
    });

    it('uses toStartOfWeek for week granularity', async () => {
      mockJson.mockResolvedValueOnce([]);
      await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'week');
      expect(mockQuery.mock.calls[0][0].query).toContain('toStartOfWeek(created_at)');
    });

    it('returns empty array when no data', async () => {
      mockJson.mockResolvedValueOnce([]);
      const result = await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(result).toEqual([]);
    });

    it('caches time-series results with granularity in key', async () => {
      mockJson.mockResolvedValueOnce([]);
      mockJson.mockResolvedValueOnce([]);

      await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'hour');
      expect(mockQuery).toHaveBeenCalledOnce();

      await service.getCreditOverTime(WORKSPACE_ID, TIME_RANGE, 'day');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  // --- Workspace isolation for credits ---

  describe('workspace isolation', () => {
    it('different workspace IDs produce separate cache entries for credits', async () => {
      const ws2 = '22222222-2222-2222-2222-222222222222';
      mockJson.mockResolvedValue([
        { totalDebited: '10', totalRefunded: '1', totalToppedUp: '100' },
      ]);

      await service.getCreditSummary(WORKSPACE_ID, TIME_RANGE);
      await service.getCreditSummary(ws2, TIME_RANGE);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0].query_params.workspaceId).toBe(WORKSPACE_ID);
      expect(mockQuery.mock.calls[1][0].query_params.workspaceId).toBe(ws2);
    });
  });
});
