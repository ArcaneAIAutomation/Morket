import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeadersMiddleware } from './securityHeaders';

function createTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('securityHeadersMiddleware', () => {
  it('sets Strict-Transport-Security header', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets X-XSS-Protection to 0', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['x-xss-protection']).toBe('0');
  });

  it('sets Permissions-Policy header', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('does not include X-Powered-By header', async () => {
    const res = await request(createTestApp()).get('/test');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
