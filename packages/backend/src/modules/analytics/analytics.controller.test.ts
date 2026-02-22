import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { createAnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

// Mock csv-exporter to avoid ClickHouse dependency
vi.mock('./csv-exporter', () => ({
  streamCSVExport: vi.fn().mockResolvedValue(undefined),
}));

function mockService(): AnalyticsService {
  return {
    getEnrichmentSummary: vi.fn().mockResolvedValue({
      totalAttempts: 100, successCount: 80, failureCount: 15, skippedCount: 5,
      successRate: 80, totalCredits: 200, avgDurationMs: 150,
    }),
    getEnrichmentByProvider: vi.fn().mockResolvedValue([]),
    getEnrichmentByField: vi.fn().mockResolvedValue([]),
    getEnrichmentOverTime: vi.fn().mockResolvedValue([]),
    getScrapingSummary: vi.fn().mockResolvedValue({
      totalTasks: 50, completedCount: 40, failedCount: 10, successRate: 80, avgDurationMs: 300,
    }),
    getScrapingByDomain: vi.fn().mockResolvedValue([]),
    getScrapingByType: vi.fn().mockResolvedValue([]),
    getScrapingOverTime: vi.fn().mockResolvedValue([]),
    getCreditSummary: vi.fn().mockResolvedValue({
      totalDebited: 500, totalRefunded: 50, totalToppedUp: 1000, netConsumption: 450,
    }),
    getCreditByProvider: vi.fn().mockResolvedValue([]),
    getCreditBySource: vi.fn().mockResolvedValue([]),
    getCreditOverTime: vi.fn().mockResolvedValue([]),
  } as unknown as AnalyticsService;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: '00000000-0000-0000-0000-000000000001' },
    query: { preset: '30d' },
    ...overrides,
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

describe('Analytics Controller', () => {
  let service: AnalyticsService;
  let controller: ReturnType<typeof createAnalyticsController>;
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    service = mockService();
    controller = createAnalyticsController(service);
  });

  describe('envelope format', () => {
    it('returns success envelope with meta for enrichment summary', async () => {
      const req = mockReq();
      const res = mockRes();
      await controller.getEnrichmentSummary(req, res, next);

      expect(res._status).toBe(200);
      expect(res._json).toHaveProperty('success', true);
      expect(res._json).toHaveProperty('data');
      expect(res._json).toHaveProperty('error', null);
      expect(res._json).toHaveProperty('meta');
      const meta = (res._json as Record<string, unknown>).meta as Record<string, unknown>;
      expect(typeof meta.queryTimeMs).toBe('number');
      expect(typeof meta.cached).toBe('boolean');
    });

    it('returns success envelope for scraping summary', async () => {
      const req = mockReq();
      const res = mockRes();
      await controller.getScrapingSummary(req, res, next);

      expect(res._status).toBe(200);
      const body = res._json as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.error).toBeNull();
      expect(body.meta).toBeDefined();
    });

    it('returns success envelope for credit summary', async () => {
      const req = mockReq();
      const res = mockRes();
      await controller.getCreditSummary(req, res, next);

      expect(res._status).toBe(200);
      const body = res._json as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        totalDebited: 500, totalRefunded: 50, totalToppedUp: 1000, netConsumption: 450,
      });
    });
  });

  describe('service delegation', () => {
    it('calls getEnrichmentByProvider with workspace id and time range', async () => {
      const req = mockReq();
      const res = mockRes();
      await controller.getEnrichmentByProvider(req, res, next);

      expect(service.getEnrichmentByProvider).toHaveBeenCalledTimes(1);
      const [wsId, tr] = (service.getEnrichmentByProvider as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(wsId).toBe('00000000-0000-0000-0000-000000000001');
      expect(tr).toHaveProperty('start');
      expect(tr).toHaveProperty('end');
    });

    it('passes granularity for over-time endpoints', async () => {
      const req = mockReq({ query: { preset: '7d', granularity: 'day' } as unknown as Request['query'] });
      const res = mockRes();
      await controller.getEnrichmentOverTime(req, res, next);

      expect(service.getEnrichmentOverTime).toHaveBeenCalledTimes(1);
      const [, , granularity] = (service.getEnrichmentOverTime as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(granularity).toBe('day');
    });
  });

  describe('ClickHouse error handling', () => {
    it('returns 503 ANALYTICS_UNAVAILABLE when ClickHouse is unreachable', async () => {
      (service.getEnrichmentSummary as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:8123'),
      );
      const req = mockReq();
      const res = mockRes();
      await controller.getEnrichmentSummary(req, res, next);

      expect(res._status).toBe(503);
      const body = res._json as Record<string, unknown>;
      expect(body.success).toBe(false);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe('ANALYTICS_UNAVAILABLE');
    });

    it('passes non-ClickHouse errors to next()', async () => {
      const err = new Error('Something else broke');
      (service.getScrapingSummary as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      const req = mockReq();
      const res = mockRes();
      await controller.getScrapingSummary(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('zero results', () => {
    it('returns 200 with empty array for breakdown endpoints', async () => {
      const req = mockReq();
      const res = mockRes();
      await controller.getEnrichmentByProvider(req, res, next);

      expect(res._status).toBe(200);
      const body = res._json as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('all 15 handlers exist', () => {
    const handlerNames = [
      'getEnrichmentSummary', 'getEnrichmentByProvider', 'getEnrichmentByField',
      'getEnrichmentOverTime', 'exportEnrichmentCSV',
      'getScrapingSummary', 'getScrapingByDomain', 'getScrapingByType',
      'getScrapingOverTime', 'exportScrapingCSV',
      'getCreditSummary', 'getCreditByProvider', 'getCreditBySource',
      'getCreditOverTime', 'exportCreditCSV',
    ];

    it.each(handlerNames)('has handler: %s', (name) => {
      expect(typeof (controller as Record<string, unknown>)[name]).toBe('function');
    });
  });
});
