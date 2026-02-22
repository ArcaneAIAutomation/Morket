import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { createAnalyticsController } from '../../src/modules/analytics/analytics.controller';
import type { AnalyticsService } from '../../src/modules/analytics/analytics.service';

// Mock csv-exporter
vi.mock('../../src/modules/analytics/csv-exporter', () => ({
  streamCSVExport: vi.fn().mockResolvedValue(undefined),
}));

const NUM_RUNS = 100;

// Arbitrary for generating analytics-like summary data
const enrichmentSummaryArb = fc.record({
  totalAttempts: fc.nat({ max: 1_000_000 }),
  successCount: fc.nat({ max: 1_000_000 }),
  failureCount: fc.nat({ max: 1_000_000 }),
  skippedCount: fc.nat({ max: 1_000_000 }),
  successRate: fc.float({ min: 0, max: 100, noNaN: true }),
  totalCredits: fc.nat({ max: 10_000_000 }),
  avgDurationMs: fc.float({ min: 0, max: 60_000, noNaN: true }),
});

const scrapingSummaryArb = fc.record({
  totalTasks: fc.nat({ max: 1_000_000 }),
  completedCount: fc.nat({ max: 1_000_000 }),
  failedCount: fc.nat({ max: 1_000_000 }),
  successRate: fc.float({ min: 0, max: 100, noNaN: true }),
  avgDurationMs: fc.float({ min: 0, max: 60_000, noNaN: true }),
});

const creditSummaryArb = fc.record({
  totalDebited: fc.nat({ max: 10_000_000 }),
  totalRefunded: fc.nat({ max: 10_000_000 }),
  totalToppedUp: fc.nat({ max: 10_000_000 }),
  netConsumption: fc.integer({ min: -10_000_000, max: 10_000_000 }),
});

// Error message arbitraries for ClickHouse-like errors
const clickHouseErrorArb = fc.constantFrom(
  'connect ECONNREFUSED 127.0.0.1:8123',
  'ClickHouse request timeout',
  'socket hang up',
  'connect timeout',
);

const nonClickHouseErrorArb = fc.constantFrom(
  'Something went wrong',
  'Unexpected token',
  'Cannot read property of undefined',
  'Database connection lost',
);

function mockReq(): Request {
  return {
    params: { id: '00000000-0000-0000-0000-000000000001' },
    query: { preset: '30d' },
  } as unknown as Request;
}

function mockRes(): Response & { _json: unknown; _status: number } {
  const res = {
    _json: null as unknown,
    _status: 200,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._json = body; return res; },
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as Response & { _json: unknown; _status: number };
  return res;
}

// Handler names that return JSON envelopes (excluding CSV export handlers)
const summaryHandlers = [
  'getEnrichmentSummary',
  'getScrapingSummary',
  'getCreditSummary',
] as const;

const breakdownHandlers = [
  'getEnrichmentByProvider',
  'getEnrichmentByField',
  'getScrapingByDomain',
  'getScrapingByType',
  'getCreditByProvider',
  'getCreditBySource',
] as const;

const overTimeHandlers = [
  'getEnrichmentOverTime',
  'getScrapingOverTime',
  'getCreditOverTime',
] as const;

describe('Property 7: JSON envelope consistency', () => {
  /**
   * Property 7: JSON envelope consistency
   * For any response from an analytics endpoint, the response body SHALL conform to
   * { success: boolean, data: T | null, error: { code, message } | null, meta?: { ... } }.
   * When status >= 400, success SHALL be false and error SHALL be non-null.
   * When status < 400, success SHALL be true.
   *
   * **Validates: Requirements 14.4, 14.6**
   */
  it('successful responses conform to envelope with success=true, error=null, meta present', () => {
    fc.assert(
      fc.asyncProperty(
        enrichmentSummaryArb,
        scrapingSummaryArb,
        creditSummaryArb,
        async (enrichData, scrapeData, creditData) => {
          const service = {
            getEnrichmentSummary: vi.fn().mockResolvedValue(enrichData),
            getEnrichmentByProvider: vi.fn().mockResolvedValue([]),
            getEnrichmentByField: vi.fn().mockResolvedValue([]),
            getEnrichmentOverTime: vi.fn().mockResolvedValue([]),
            getScrapingSummary: vi.fn().mockResolvedValue(scrapeData),
            getScrapingByDomain: vi.fn().mockResolvedValue([]),
            getScrapingByType: vi.fn().mockResolvedValue([]),
            getScrapingOverTime: vi.fn().mockResolvedValue([]),
            getCreditSummary: vi.fn().mockResolvedValue(creditData),
            getCreditByProvider: vi.fn().mockResolvedValue([]),
            getCreditBySource: vi.fn().mockResolvedValue([]),
            getCreditOverTime: vi.fn().mockResolvedValue([]),
          } as unknown as AnalyticsService;

          const controller = createAnalyticsController(service);
          const next: NextFunction = vi.fn();

          // Test all summary handlers
          for (const handler of summaryHandlers) {
            const req = mockReq();
            const res = mockRes();
            await controller[handler](req, res, next);

            const body = res._json as Record<string, unknown>;
            expect(res._status).toBeLessThan(400);
            expect(body.success).toBe(true);
            expect(body.data).not.toBeNull();
            expect(body.error).toBeNull();
            expect(body.meta).toBeDefined();
            const meta = body.meta as Record<string, unknown>;
            expect(typeof meta.queryTimeMs).toBe('number');
            expect(typeof meta.cached).toBe('boolean');
          }

          // Test breakdown handlers
          for (const handler of breakdownHandlers) {
            const req = mockReq();
            const res = mockRes();
            await controller[handler](req, res, next);

            const body = res._json as Record<string, unknown>;
            expect(res._status).toBeLessThan(400);
            expect(body.success).toBe(true);
            expect(body.error).toBeNull();
          }

          // Test over-time handlers
          for (const handler of overTimeHandlers) {
            const req = {
              params: { id: '00000000-0000-0000-0000-000000000001' },
              query: { preset: '7d', granularity: 'day' },
            } as unknown as Request;
            const res = mockRes();
            await controller[handler](req, res, next);

            const body = res._json as Record<string, unknown>;
            expect(res._status).toBeLessThan(400);
            expect(body.success).toBe(true);
            expect(body.error).toBeNull();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('ClickHouse errors produce envelope with success=false, status=503, error non-null', () => {
    fc.assert(
      fc.asyncProperty(clickHouseErrorArb, async (errorMsg) => {
        const service = {
          getEnrichmentSummary: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getEnrichmentByProvider: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getEnrichmentByField: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getEnrichmentOverTime: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getScrapingSummary: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getScrapingByDomain: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getScrapingByType: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getScrapingOverTime: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getCreditSummary: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getCreditByProvider: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getCreditBySource: vi.fn().mockRejectedValue(new Error(errorMsg)),
          getCreditOverTime: vi.fn().mockRejectedValue(new Error(errorMsg)),
        } as unknown as AnalyticsService;

        const controller = createAnalyticsController(service);
        const next: NextFunction = vi.fn();

        for (const handler of summaryHandlers) {
          const req = mockReq();
          const res = mockRes();
          await controller[handler](req, res, next);

          expect(res._status).toBe(503);
          const body = res._json as Record<string, unknown>;
          expect(body.success).toBe(false);
          expect(body.data).toBeNull();
          expect(body.error).not.toBeNull();
          const error = body.error as Record<string, unknown>;
          expect(error.code).toBe('ANALYTICS_UNAVAILABLE');
          expect(typeof error.message).toBe('string');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('non-ClickHouse errors are forwarded to next() without sending a response', () => {
    fc.assert(
      fc.asyncProperty(nonClickHouseErrorArb, async (errorMsg) => {
        const err = new Error(errorMsg);
        const service = {
          getEnrichmentSummary: vi.fn().mockRejectedValue(err),
          getEnrichmentByProvider: vi.fn().mockRejectedValue(err),
          getEnrichmentByField: vi.fn().mockRejectedValue(err),
          getEnrichmentOverTime: vi.fn().mockRejectedValue(err),
          getScrapingSummary: vi.fn().mockRejectedValue(err),
          getScrapingByDomain: vi.fn().mockRejectedValue(err),
          getScrapingByType: vi.fn().mockRejectedValue(err),
          getScrapingOverTime: vi.fn().mockRejectedValue(err),
          getCreditSummary: vi.fn().mockRejectedValue(err),
          getCreditByProvider: vi.fn().mockRejectedValue(err),
          getCreditBySource: vi.fn().mockRejectedValue(err),
          getCreditOverTime: vi.fn().mockRejectedValue(err),
        } as unknown as AnalyticsService;

        const controller = createAnalyticsController(service);
        const nextFn = vi.fn() as unknown as NextFunction;

        const req = mockReq();
        const res = mockRes();
        await controller.getEnrichmentSummary(req, res, nextFn);

        // Error should be forwarded to next, not sent as response
        expect(nextFn).toHaveBeenCalledWith(err);
        // Response should not have been sent (status stays at default 200, json not called)
        expect(res._json).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
