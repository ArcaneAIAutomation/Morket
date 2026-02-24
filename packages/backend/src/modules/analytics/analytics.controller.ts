import { Request, Response, NextFunction } from 'express';
import { resolveTimeRange } from './analytics.schemas';
import type { TimeRangeQuery, Granularity } from './analytics.schemas';
import type { AnalyticsService } from './analytics.service';
import type { CSVExportOptions } from './csv-exporter';
import { streamCSVExport } from './csv-exporter';
// AppError available if needed for future error handling

interface AnalyticsMeta {
  cached: boolean;
  queryTimeMs: number;
}

function analyticsResponse<T>(data: T, meta: AnalyticsMeta) {
  return {
    success: true as const,
    data,
    error: null,
    meta,
  };
}

function isClickHouseError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('clickhouse') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('connect timeout') ||
      msg.includes('request timeout') ||
      (err.constructor?.name ?? '').includes('ClickHouse')
    );
  }
  return false;
}

/**
 * Wraps a service call with timing and ClickHouse error handling.
 * Returns 503 ANALYTICS_UNAVAILABLE if ClickHouse is unreachable.
 */
async function timedServiceCall<T>(
  res: Response,
  next: NextFunction,
  fn: () => Promise<T>,
): Promise<void> {
  const start = Date.now();
  try {
    const data = await fn();
    const queryTimeMs = Date.now() - start;
    res.status(200).json(analyticsResponse(data, { cached: queryTimeMs < 2, queryTimeMs }));
  } catch (err) {
    if (isClickHouseError(err)) {
      res.status(503).json({
        success: false,
        data: null,
        error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics service is temporarily unavailable' },
      });
      return;
    }
    next(err);
  }
}

export function createAnalyticsController(service: AnalyticsService) {
  // --- Enrichment handlers ---

  async function getEnrichmentSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getEnrichmentSummary(workspaceId, timeRange));
  }

  async function getEnrichmentByProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getEnrichmentByProvider(workspaceId, timeRange));
  }

  async function getEnrichmentByField(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getEnrichmentByField(workspaceId, timeRange));
  }

  async function getEnrichmentOverTime(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const granularity = req.query.granularity as Granularity;
    await timedServiceCall(res, next, () => service.getEnrichmentOverTime(workspaceId, timeRange, granularity));
  }

  async function exportEnrichmentCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const options: CSVExportOptions = { workspaceId, table: 'enrichment', timeRange };
    try {
      await streamCSVExport(res, options);
    } catch (err) {
      if (isClickHouseError(err)) {
        res.status(503).json({
          success: false,
          data: null,
          error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics service is temporarily unavailable' },
        });
        return;
      }
      next(err);
    }
  }

  // --- Scraping handlers ---

  async function getScrapingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getScrapingSummary(workspaceId, timeRange));
  }

  async function getScrapingByDomain(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getScrapingByDomain(workspaceId, timeRange));
  }

  async function getScrapingByType(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getScrapingByType(workspaceId, timeRange));
  }

  async function getScrapingOverTime(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const granularity = req.query.granularity as Granularity;
    await timedServiceCall(res, next, () => service.getScrapingOverTime(workspaceId, timeRange, granularity));
  }

  async function exportScrapingCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const options: CSVExportOptions = { workspaceId, table: 'scraping', timeRange };
    try {
      await streamCSVExport(res, options);
    } catch (err) {
      if (isClickHouseError(err)) {
        res.status(503).json({
          success: false,
          data: null,
          error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics service is temporarily unavailable' },
        });
        return;
      }
      next(err);
    }
  }

  // --- Credit handlers ---

  async function getCreditSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getCreditSummary(workspaceId, timeRange));
  }

  async function getCreditByProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getCreditByProvider(workspaceId, timeRange));
  }

  async function getCreditBySource(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    await timedServiceCall(res, next, () => service.getCreditBySource(workspaceId, timeRange));
  }

  async function getCreditOverTime(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const granularity = req.query.granularity as Granularity;
    await timedServiceCall(res, next, () => service.getCreditOverTime(workspaceId, timeRange, granularity));
  }

  async function exportCreditCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
    const workspaceId = req.params.id;
    const timeRange = resolveTimeRange(req.query as unknown as TimeRangeQuery);
    const options: CSVExportOptions = { workspaceId, table: 'credits', timeRange };
    try {
      await streamCSVExport(res, options);
    } catch (err) {
      if (isClickHouseError(err)) {
        res.status(503).json({
          success: false,
          data: null,
          error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics service is temporarily unavailable' },
        });
        return;
      }
      next(err);
    }
  }

  return {
    getEnrichmentSummary,
    getEnrichmentByProvider,
    getEnrichmentByField,
    getEnrichmentOverTime,
    exportEnrichmentCSV,
    getScrapingSummary,
    getScrapingByDomain,
    getScrapingByType,
    getScrapingOverTime,
    exportScrapingCSV,
    getCreditSummary,
    getCreditByProvider,
    getCreditBySource,
    getCreditOverTime,
    exportCreditCSV,
  };
}
