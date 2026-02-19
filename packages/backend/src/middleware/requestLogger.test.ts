import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestLoggerMiddleware } from './requestLogger';

// Mock the logger module
vi.mock('../shared/logger', () => ({
  log: vi.fn(),
}));

import { log } from '../shared/logger';

const mockedLog = vi.mocked(log);

function createApp() {
  const app = express();
  app.use(requestLoggerMiddleware);
  app.get('/test', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/slow', (_req, res) => {
    setTimeout(() => res.json({ ok: true }), 50);
  });
  app.post('/data', express.json(), (_req, res) => {
    res.status(201).json({ created: true });
  });
  app.get('/error', (_req, res) => {
    res.status(500).json({ error: 'fail' });
  });
  return app;
}

describe('requestLoggerMiddleware', () => {
  beforeEach(() => {
    mockedLog.mockClear();
  });

  it('calls log with method, path, statusCode, and responseTime', async () => {
    const app = createApp();
    await request(app).get('/test');

    expect(mockedLog).toHaveBeenCalledOnce();
    const entry = mockedLog.mock.calls[0][0];
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/test');
    expect(entry.statusCode).toBe(200);
    expect(typeof entry.responseTime).toBe('number');
    expect(entry.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('captures the correct HTTP method for POST requests', async () => {
    const app = createApp();
    await request(app).post('/data').send({ foo: 'bar' });

    expect(mockedLog).toHaveBeenCalledOnce();
    const entry = mockedLog.mock.calls[0][0];
    expect(entry.method).toBe('POST');
    expect(entry.statusCode).toBe(201);
  });

  it('captures non-200 status codes', async () => {
    const app = createApp();
    await request(app).get('/error');

    expect(mockedLog).toHaveBeenCalledOnce();
    const entry = mockedLog.mock.calls[0][0];
    expect(entry.statusCode).toBe(500);
  });

  it('records a positive responseTime', async () => {
    const app = createApp();
    await request(app).get('/slow');

    expect(mockedLog).toHaveBeenCalledOnce();
    const entry = mockedLog.mock.calls[0][0];
    expect(entry.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('uses originalUrl for the path (includes query strings)', async () => {
    const app = createApp();
    await request(app).get('/test?foo=bar');

    expect(mockedLog).toHaveBeenCalledOnce();
    const entry = mockedLog.mock.calls[0][0];
    expect(entry.path).toBe('/test?foo=bar');
  });

  it('calls next() so the request proceeds', async () => {
    const app = createApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
