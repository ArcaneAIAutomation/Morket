import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { _resetRateLimiterState } from './middleware/rateLimiter';

// Mock the ClickHouse health check so it doesn't need a real connection
vi.mock('./clickhouse/client', () => ({
  healthCheck: vi.fn().mockResolvedValue(false),
  getClickHouse: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue([]) }),
  }),
  initClickHouse: vi.fn(),
  closeClickHouse: vi.fn(),
  setClickHouse: vi.fn(),
}));

describe('createApp', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    _resetRateLimiterState();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const app = createApp({
    corsOrigins: ['http://localhost:5173'],
    jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
    jwtAccessExpiry: '15m',
    jwtRefreshExpiry: '7d',
    encryptionMasterKey: 'a'.repeat(64),
  });

  it('returns health check with envelope format', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.clickhouse).toBe('unavailable');
  });

  it('includes X-Request-Id header as UUID', async () => {
    const res = await request(app).get('/api/v1/health');

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('includes security headers from helmet', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('includes CORS headers for configured origin', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('returns 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
  });

  describe('monitoring endpoint restriction in production', () => {
    it('allows /api/v1/health without monitoring key in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      const res = await request(prodApp).get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('rejects /api/v1/readiness without monitoring key in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      const res = await request(prodApp).get('/api/v1/readiness');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects /api/v1/metrics without monitoring key in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      const res = await request(prodApp).get('/api/v1/metrics');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows /api/v1/readiness with valid monitoring key in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      const res = await request(prodApp)
        .get('/api/v1/readiness')
        .set('X-Monitoring-Key', 'test-monitoring-secret');
      // Readiness may return 503 if deps are unhealthy, but must NOT be 403
      expect(res.status).not.toBe(403);
    });

    it('allows /api/v1/metrics with valid monitoring key in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      const res = await request(prodApp)
        .get('/api/v1/metrics')
        .set('X-Monitoring-Key', 'test-monitoring-secret');
      expect(res.status).toBe(200);
    });

    it('allows readiness/metrics without key when MONITORING_API_KEY is not set in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONITORING_API_KEY;
      _resetRateLimiterState();
      const prodApp = createApp({
        corsOrigins: ['http://localhost:5173'],
        jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
        jwtAccessExpiry: '15m',
        jwtRefreshExpiry: '7d',
        encryptionMasterKey: 'a'.repeat(64),
      });

      // Readiness may return 503 if deps are unhealthy, but must NOT be 403
      const readinessRes = await request(prodApp).get('/api/v1/readiness');
      expect(readinessRes.status).not.toBe(403);

      const metricsRes = await request(prodApp).get('/api/v1/metrics');
      expect(metricsRes.status).toBe(200);
    });

    it('allows readiness/metrics without key in non-production mode', async () => {
      process.env.NODE_ENV = 'test';
      process.env.MONITORING_API_KEY = 'test-monitoring-secret';

      const res = await request(app).get('/api/v1/readiness');
      expect(res.status).not.toBe(403);

      const metricsRes = await request(app).get('/api/v1/metrics');
      expect(metricsRes.status).not.toBe(403);
    });
  });
});
