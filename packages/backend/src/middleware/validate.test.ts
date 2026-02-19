import { describe, it, expect } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from './validate';
import { AppError } from '../shared/errors';

function createApp(schemas: Parameters<typeof validate>[0], method: 'post' | 'get' = 'post') {
  const app = express();
  app.use(express.json());

  const handler = (req: Request, res: Response) => {
    res.json({ body: req.body, params: req.params, query: req.query });
  };

  if (method === 'post') {
    app.post('/test/:id?', validate(schemas), handler);
  } else {
    app.get('/test/:id?', validate(schemas), handler);
  }

  // Error handler that mirrors the real one
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        success: false,
        data: null,
        error: { code: err.code, message: err.message },
      });
      return;
    }
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });

  return app;
}

describe('validate middleware', () => {
  describe('body validation', () => {
    const bodySchema = z.object({
      email: z.string().email(),
      name: z.string().min(1),
    });

    it('passes valid body through and replaces with parsed data', async () => {
      const app = createApp({ body: bodySchema });
      const res = await request(app)
        .post('/test')
        .send({ email: 'test@example.com', name: 'Alice', extra: 'ignored' });

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ email: 'test@example.com', name: 'Alice' });
    });

    it('returns 400 for invalid body', async () => {
      const app = createApp({ body: bodySchema });
      const res = await request(app)
        .post('/test')
        .send({ email: 'not-an-email', name: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('body.email');
      expect(res.body.error.message).toContain('body.name');
    });
  });

  describe('params validation', () => {
    const paramsSchema = z.object({
      id: z.string().uuid(),
    });

    it('passes valid params through', async () => {
      const app = createApp({ params: paramsSchema }, 'get');
      const res = await request(app).get('/test/550e8400-e29b-41d4-a716-446655440000');

      expect(res.status).toBe(200);
      expect(res.body.params.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('returns 400 for invalid params', async () => {
      const app = createApp({ params: paramsSchema }, 'get');
      const res = await request(app).get('/test/not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('params.id');
    });
  });

  describe('query validation', () => {
    const querySchema = z.object({
      page: z.coerce.number().int().positive(),
      limit: z.coerce.number().int().positive().max(100),
    });

    it('passes valid query and coerces types', async () => {
      const app = createApp({ query: querySchema }, 'get');
      const res = await request(app).get('/test?page=2&limit=25');

      expect(res.status).toBe(200);
      expect(res.body.query).toEqual({ page: 2, limit: 25 });
    });

    it('returns 400 for invalid query', async () => {
      const app = createApp({ query: querySchema }, 'get');
      const res = await request(app).get('/test?page=-1&limit=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('query');
    });
  });

  describe('combined validation', () => {
    it('validates body, params, and query together', async () => {
      const app = createApp({
        body: z.object({ name: z.string().min(1) }),
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ verbose: z.coerce.boolean().optional() }),
      });

      const res = await request(app)
        .post('/test/550e8400-e29b-41d4-a716-446655440000?verbose=true')
        .send({ name: 'Test' });

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ name: 'Test' });
      expect(res.body.params.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(res.body.query.verbose).toBe(true);
    });

    it('collects errors from all sources', async () => {
      const app = createApp({
        body: z.object({ name: z.string().min(1) }),
        params: z.object({ id: z.string().uuid() }),
      });

      const res = await request(app)
        .post('/test/bad-id')
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('body.name');
      expect(res.body.error.message).toContain('params.id');
    });
  });

  describe('no schemas provided', () => {
    it('passes through when no schemas are given', async () => {
      const app = createApp({});
      const res = await request(app)
        .post('/test')
        .send({ anything: 'goes' });

      expect(res.status).toBe(200);
    });
  });
});
