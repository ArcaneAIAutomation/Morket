import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/rbac';
import { createAnalyticsController } from './analytics.controller';
import { createAnalyticsService } from './analytics.service';
import { createAnalyticsCache } from './analytics.cache';
import {
  workspaceParamsSchema,
  timeRangeQuerySchema,
  granularitySchema,
  exportQuerySchema,
} from './analytics.schemas';
import { z } from 'zod';

// Combined schema for over-time endpoints (time range + granularity)
const overTimeQuerySchema = z.intersection(
  timeRangeQuerySchema,
  z.object({ granularity: granularitySchema }),
);

export function createAnalyticsRoutes(): Router {
  const router = Router({ mergeParams: true });

  const cache = createAnalyticsCache();
  const service = createAnalyticsService(cache);
  const controller = createAnalyticsController(service);

  const vTimeRange = { params: workspaceParamsSchema, query: timeRangeQuerySchema };
  const vOverTime = { params: workspaceParamsSchema, query: overTimeQuerySchema };
  const vExport = { params: workspaceParamsSchema, query: exportQuerySchema };

  // --- Enrichment endpoints ---
  router.get('/enrichment/summary', validate(vTimeRange), requireRole('member'), controller.getEnrichmentSummary);
  router.get('/enrichment/by-provider', validate(vTimeRange), requireRole('member'), controller.getEnrichmentByProvider);
  router.get('/enrichment/by-field', validate(vTimeRange), requireRole('member'), controller.getEnrichmentByField);
  router.get('/enrichment/over-time', validate(vOverTime), requireRole('member'), controller.getEnrichmentOverTime);
  router.get('/enrichment/export', validate(vExport), requireRole('member'), controller.exportEnrichmentCSV);

  // --- Scraping endpoints ---
  router.get('/scraping/summary', validate(vTimeRange), requireRole('member'), controller.getScrapingSummary);
  router.get('/scraping/by-domain', validate(vTimeRange), requireRole('member'), controller.getScrapingByDomain);
  router.get('/scraping/by-type', validate(vTimeRange), requireRole('member'), controller.getScrapingByType);
  router.get('/scraping/over-time', validate(vOverTime), requireRole('member'), controller.getScrapingOverTime);
  router.get('/scraping/export', validate(vExport), requireRole('member'), controller.exportScrapingCSV);

  // --- Credit endpoints ---
  router.get('/credits/summary', validate(vTimeRange), requireRole('member'), controller.getCreditSummary);
  router.get('/credits/by-provider', validate(vTimeRange), requireRole('member'), controller.getCreditByProvider);
  router.get('/credits/by-source', validate(vTimeRange), requireRole('member'), controller.getCreditBySource);
  router.get('/credits/over-time', validate(vOverTime), requireRole('member'), controller.getCreditOverTime);
  router.get('/credits/export', validate(vExport), requireRole('member'), controller.exportCreditCSV);

  return router;
}
