import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthRoutes } from './auth.routes';
import { AuthConfig } from './auth.service';
import { errorHandler } from '../../middleware/errorHandler';
import { _resetRateLimiterState } from '../../middleware/rateLimiter';

// Mock the auth service
vi.mock('./auth.service', async () => {
  const actual = await vi.importActual<typeof import('./auth.service')>('./auth.service');
  return {
    ...actual,
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  };
});

import * as authService from './auth.service';

const config: AuthConfig = {
  jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRoutes(config));
  app.use(errorHandler);
  return app;
}

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimiterState();
  });

  describe('POST /api/v1/auth/register', () => {
    it('returns 201 with user data excluding passwordHash', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'test@example.com',
        passwordHash: '$2b$12$hashedvalue',
        name: 'Test User',
        avatarUrl: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      vi.mocked(authService.register).mockResolvedValue(mockUser);

      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'password123', name: 'Test User' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('test@example.com');
      expect(res.body.data.name).toBe('Test User');
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('returns 400 for invalid email', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'password123', name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for short password', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'short', name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with tokens', async () => {
      vi.mocked(authService.login).mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    it('returns 400 for missing fields', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns 200 with new tokens', async () => {
      vi.mocked(authService.refresh).mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'old-refresh-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBe('new-access');
      expect(res.body.data.refreshToken).toBe('new-refresh');
    });

    it('returns 400 for missing refreshToken', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 204 on logout', async () => {
      vi.mocked(authService.logout).mockResolvedValue(undefined);

      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'some-token' });

      expect(res.status).toBe(204);
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 after 5 requests within 1 minute', async () => {
      vi.mocked(authService.login).mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
      });

      const app = buildApp();
      const payload = { email: 'test@example.com', password: 'password123' };

      // First 5 requests should succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/v1/auth/login').send(payload);
        expect(res.status).toBe(200);
      }

      // 6th request should be rate limited
      const res = await request(app).post('/api/v1/auth/login').send(payload);
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
    });
  });
});
