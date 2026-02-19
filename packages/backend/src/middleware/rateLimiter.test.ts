import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  createRateLimiter,
  authRateLimiter,
  generalRateLimiter,
  _resetRateLimiterState,
} from './rateLimiter';

function createApp(limiter: ReturnType<typeof createRateLimiter>) {
  const app = express();
  app.use(limiter);
  app.get('/test', (_req, res) => {
    res.json({ success: true });
  });
  // Simple error handler to catch RateLimitError
  app.use(
    (
      err: { statusCode?: number; code?: string; message?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.statusCode ?? 500).json({
        success: false,
        data: null,
        error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message },
      });
    }
  );
  return app;
}

describe('rateLimiter', () => {
  beforeEach(() => {
    _resetRateLimiterState();
    vi.restoreAllMocks();
  });

  describe('createRateLimiter', () => {
    it('allows requests within the limit', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
      const app = createApp(limiter);

      for (let i = 0; i < 3; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }
    });

    it('returns 429 when limit is exceeded', async () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const app = createApp(limiter);

      await request(app).get('/test');
      await request(app).get('/test');
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('resets after the window expires', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(now)       // 1st request
        .mockReturnValueOnce(now)       // 2nd request
        .mockReturnValueOnce(now + 61000) // 3rd request — after window
        .mockReturnValueOnce(now + 61000); // filter call inside 3rd

      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const app = createApp(limiter);

      await request(app).get('/test');
      await request(app).get('/test');

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('cleans up expired entries on each request', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(now)           // 1st
        .mockReturnValueOnce(now + 70000)   // 2nd — old entry expires
        .mockReturnValueOnce(now + 70000);  // 3rd

      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const app = createApp(limiter);

      await request(app).get('/test');
      // After window, old entry is cleaned and new request is allowed
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('pre-configured instances', () => {
    it('authRateLimiter allows 5 requests then blocks', async () => {
      const app = createApp(authRateLimiter);

      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).get('/test');
      expect(blocked.status).toBe(429);
    });

    it('generalRateLimiter allows 100 requests then blocks', async () => {
      const app = createApp(generalRateLimiter);

      for (let i = 0; i < 100; i++) {
        const res = await request(app).get('/test');
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).get('/test');
      expect(blocked.status).toBe(429);
    });
  });
});
