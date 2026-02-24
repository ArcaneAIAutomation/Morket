import type { Request, Response, NextFunction } from 'express';
import { recordRequest } from '../observability/metrics';

/**
 * Middleware that records request duration and error status in the in-memory metrics.
 * OpenTelemetry auto-instrumentation handles span creation for HTTP + Express;
 * this middleware supplements it with our custom metrics tracking.
 */
export function tracingMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const isError = res.statusCode >= 500;
    recordRequest(durationMs, isError);
  });

  next();
}
