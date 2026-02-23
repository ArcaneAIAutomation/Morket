import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from './auth';
import { errorHandler } from './errorHandler';
import '../shared/types';

const JWT_SECRET = 'test-secret-key';

// Mock Redis for jti revocation tests
vi.mock('../cache/redis', () => ({
  getRedis: vi.fn(() => null),
}));

import { getRedis } from '../cache/redis';

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
  app.post('/api/v1/invitations/:token/accept', (_req: Request, res: Response) => {
    res.json({ success: true, data: { accepted: true } });
  });
  app.post('/api/v1/invitations/:token/decline', (_req: Request, res: Response) => {
    res.json({ success: true, data: { declined: true } });
  });

  // Protected route
  app.get('/api/v1/protected', (req: Request, res: Response) => {
    res.json({ success: true, data: { userId: req.user?.userId, role: req.user?.role, workspaceId: req.user?.workspaceId } });
  });

  app.use(errorHandler);
  return app;
}

function signToken(payload: object, secret = JWT_SECRET, options?: jwt.SignOptions) {
  return jwt.sign(payload, secret, { issuer: 'morket', audience: 'morket-api', ...options });
}

describe('auth middleware', () => {
  const app = createApp();

  beforeEach(() => {
    vi.mocked(getRedis).mockReturnValue(null);
  });

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

    it('allows POST /api/v1/invitations/:token/accept without token', async () => {
      const res = await request(app).post('/api/v1/invitations/some-token-123/accept');
      expect(res.status).toBe(200);
      expect(res.body.data.accepted).toBe(true);
    });

    it('allows POST /api/v1/invitations/:token/decline without token', async () => {
      const res = await request(app).post('/api/v1/invitations/some-token-456/decline');
      expect(res.status).toBe(200);
      expect(res.body.data.declined).toBe(true);
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
      await new Promise((r) => setTimeout(r, 10));
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Token has expired');
    });

    it('returns 401 for a token signed with wrong secret', async () => {
      const token = jwt.sign({ userId: 'user-1' }, 'wrong-secret', { issuer: 'morket', audience: 'morket-api' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid token');
    });

    it('sets req.user with userId, role, and workspaceId from valid token', async () => {
      const token = signToken({ userId: 'user-123', role: 'admin', workspaceId: 'ws-456' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe('user-123');
      expect(res.body.data.role).toBe('admin');
      expect(res.body.data.workspaceId).toBe('ws-456');
    });
  });

  describe('JWT claim validation (iss/aud)', () => {
    it('returns 401 for token with wrong issuer', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { issuer: 'wrong-issuer', audience: 'morket-api', expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid token');
    });

    it('returns 401 for token with wrong audience', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { issuer: 'morket', audience: 'wrong-audience', expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid token');
    });

    it('returns 401 for token with no issuer or audience', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid token');
    });
  });

  describe('jti revocation check', () => {
    it('allows token when Redis is unavailable (graceful degradation)', async () => {
      vi.mocked(getRedis).mockReturnValue(null);
      const token = signToken({ userId: 'user-1', jti: 'token-id-1' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('returns 401 for revoked token (jti found in Redis)', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue('revoked') };
      vi.mocked(getRedis).mockReturnValue(mockRedis as any);
      const token = signToken({ userId: 'user-1', jti: 'revoked-token-id' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Token has been revoked');
      expect(mockRedis.get).toHaveBeenCalledWith('jti:revoked-token-id');
    });

    it('allows token when jti is not in Redis revocation list', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue(null) };
      vi.mocked(getRedis).mockReturnValue(mockRedis as any);
      const token = signToken({ userId: 'user-1', jti: 'valid-token-id' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('allows token when Redis throws an error (graceful degradation)', async () => {
      const mockRedis = { get: vi.fn().mockRejectedValue(new Error('Redis connection error')) };
      vi.mocked(getRedis).mockReturnValue(mockRedis as any);
      const token = signToken({ userId: 'user-1', jti: 'some-token-id' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('skips revocation check when token has no jti claim', async () => {
      const mockRedis = { get: vi.fn() };
      vi.mocked(getRedis).mockReturnValue(mockRedis as any);
      const token = signToken({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '15m' });
      const res = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});
