import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestIdMiddleware } from './requestId';

function createApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/test', (req, res) => {
    res.json({ requestId: req.id });
  });
  return app;
}

describe('requestIdMiddleware', () => {
  it('sets X-Request-Id response header with a valid UUID', async () => {
    const app = createApp();
    const res = await request(app).get('/test');

    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('attaches the id to req.id', async () => {
    const app = createApp();
    const res = await request(app).get('/test');

    const headerValue = res.headers['x-request-id'];
    expect(res.body.requestId).toBe(headerValue);
  });

  it('generates unique IDs for different requests', async () => {
    const app = createApp();
    const [res1, res2] = await Promise.all([
      request(app).get('/test'),
      request(app).get('/test'),
    ]);

    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });
});
