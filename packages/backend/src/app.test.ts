import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { _resetRateLimiterState } from './middleware/rateLimiter';

describe('createApp', () => {
  beforeEach(() => {
    _resetRateLimiterState();
  });

  const app = createApp({
    corsOrigin: 'http://localhost:5173',
    jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
    jwtAccessExpiry: '15m',
    jwtRefreshExpiry: '7d',
    encryptionMasterKey: 'a'.repeat(64),
  });

  it('returns health check with envelope format', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok' },
      error: null,
    });
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
});
