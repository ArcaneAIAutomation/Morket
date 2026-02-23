import { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../shared/errors';
import { logRateLimitHit } from '../observability/logger';

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

// Each limiter instance owns its own Map so they don't share timestamp counts.
const allMaps: Map<string, number[]>[] = [];

export function createRateLimiter({ windowMs, maxRequests }: RateLimiterOptions) {
  const ipTimestamps = new Map<string, number[]>();
  allMaps.push(ipTimestamps);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing timestamps or initialize
    const timestamps = ipTimestamps.get(ip) ?? [];

    // Remove expired entries (outside the current window)
    const valid = timestamps.filter((t) => t > windowStart);

    if (valid.length >= maxRequests) {
      ipTimestamps.set(ip, valid);

      // Calculate seconds until the oldest request in the window expires
      const oldestTimestamp = valid[0];
      const retryAfterMs = oldestTimestamp + windowMs - now;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));

      logRateLimitHit({
        sourceIp: ip,
        endpoint: req.originalUrl,
        requestCount: valid.length,
      });

      throw new RateLimitError('Too many requests, please try again later');
    }

    valid.push(now);
    ipTimestamps.set(ip, valid);
    next();
  };
}

/** Auth routes: 5 requests per minute */
export const authRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });

/** General routes: 100 requests per minute */
export const generalRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 100 });

/** Enrichment job creation: 20 requests per minute */
export const enrichmentRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 20 });

/** Admin endpoints: 10 requests per minute */
export const adminRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 10 });

/** Exposed for testing — clears all stored IP timestamps across all limiter instances */
export function _resetRateLimiterState(): void {
  for (const map of allMaps) {
    map.clear();
  }
}
