import { describe, it, expect } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from './auth';
import { errorHandler } from './errorHandler';
import '../shared/types';

const JWT_SECRET = 'test-secret-key';

function createApp() {
  const app = express();
  app.use(createAuthMiddleware(JWT_SECRET));

  // Public routes
  app.post('/api/v1/auth/register', (_req: Request, res: Response) => {
    res.json({ success: true, data: { message: 'register' } });
  });
  app.post('/api/v1/auth/login', (_req: Request, res: Response) => {
    res.json({ success: true, data: { message: 'login' } });
  });
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

  // Protected route
  app.get('/api/v1/protected', (req: Request, res: Response) => {
    res.json({ success: true, data: { userId: req.user?.userId } });
  });

  app.use(errorHandler);
  return app;
}

function signToken(payload: object, secret = JWT_SECRET, options?: jwt.SignOptions) {
  return jwt.sign(payload, secret, options);
}

describe('auth middleware', () => {
  const app = createApp();

  describe('public routes', () => {
    it('allows POST /api/v1/auth/register without token', async () => {
      const res = await request(app).post('/api/v1/auth/register');
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('register');
    });

    it('allows POST /api/v1/auth/login without token', async () => {
      const res = await request(app).post('/api/v1/auth/login');
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('login');
    });

    it('allows GET /api/v1/health without token', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('protected routes', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const res = await request(app).get('/api/v1/protected');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('returns 401 when Authorization header is not Bearer', async () => {
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', 'Basic abc123');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
      expect(res.body.error.message).toBe('Invalid token');
    });

    it('returns 401 for an expired token', async () => {
      const token = signToken({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '0s' });
      // Small delay to ensure expiry
      await new Promise((r) => setTimeout(r, 10));
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Token has expired');
    });

    it('returns 401 for a token signed with wrong secret', async () => {
      const token = signToken({ userId: 'user-1' }, 'wrong-secret');
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid token');
    });

    it('sets req.user with userId from valid token', async () => {
      const token = signToken({ userId: 'user-123' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe('user-123');
    });
  });
});
