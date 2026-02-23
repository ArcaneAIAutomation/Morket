import { describe, it, expect, vi, afterEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { errorHandler } from './errorHandler';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  InsufficientCreditsError,
  RateLimitError,
} from '../shared/errors';
import { logger } from '../shared/logger';

function createApp(errorToThrow: Error) {
  const app = express();

  app.get('/test', (_req: Request, _res: Response) => {
    throw errorToThrow;
  });

  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  describe('AppError instances', () => {
    it('returns correct status and envelope for ValidationError', async () => {
      const app = createApp(new ValidationError('Invalid email'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        data: null,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid email' },
      });
    });

    it('returns 401 for AuthenticationError', async () => {
      const app = createApp(new AuthenticationError('Invalid credentials'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns 403 for AuthorizationError', async () => {
      const app = createApp(new AuthorizationError('Insufficient permissions'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 404 for NotFoundError', async () => {
      const app = createApp(new NotFoundError('Resource not found'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 for ConflictError', async () => {
      const app = createApp(new ConflictError('Email already exists'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('returns 402 for InsufficientCreditsError', async () => {
      const app = createApp(new InsufficientCreditsError('Not enough credits'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    });

    it('returns 429 for RateLimitError', async () => {
      const app = createApp(new RateLimitError('Too many requests'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('returns custom status for generic AppError', async () => {
      const app = createApp(new AppError(418, 'TEAPOT', 'I am a teapot'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(418);
      expect(res.body).toEqual({
        success: false,
        data: null,
        error: { code: 'TEAPOT', message: 'I am a teapot' },
      });
    });
  });

  describe('unknown errors', () => {
    it('returns 500 with generic message for non-AppError', async () => {
      const app = createApp(new Error('database connection failed'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    });

    it('does not leak internal error details to the client', async () => {
      const app = createApp(new Error('secret DB password in stack trace'));
      const res = await request(app).get('/test');

      expect(res.body.error.message).toBe('An unexpected error occurred');
      expect(JSON.stringify(res.body)).not.toContain('secret');
      expect(JSON.stringify(res.body)).not.toContain('stack');
    });

    it('logs the full error internally', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const err = new Error('something broke');
      const app = createApp(err);

      await request(app).get('/test');

      expect(spy).toHaveBeenCalledWith('Unhandled error', {
        error: 'something broke',
        stack: err.stack,
      });

      spy.mockRestore();
    });

    it('handles TypeError as unknown error', async () => {
      const app = createApp(new TypeError('Cannot read property of undefined'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('production mode hardening', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('strips internal file paths from AppError messages in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const app = createApp(new AppError(500, 'DB_ERROR', 'Failed at /app/src/modules/auth/auth.service.ts:42'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('An error occurred');
      expect(res.body.error.code).toBe('DB_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('/app/src/');
      expect(JSON.stringify(res.body)).not.toContain('.ts:42');
      spy.mockRestore();
    });

    it('strips DB error details from AppError messages in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const app = createApp(new AppError(500, 'DB_ERROR', 'password authentication failed for user "morket"'));
      const res = await request(app).get('/test');

      expect(res.body.error.message).toBe('An error occurred');
      expect(JSON.stringify(res.body)).not.toContain('password authentication');
      spy.mockRestore();
    });

    it('preserves safe AppError messages in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const app = createApp(new ValidationError('Invalid email format'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid email format');
      spy.mockRestore();
    });

    it('returns generic message for unknown errors in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const app = createApp(new Error('ECONNREFUSED 127.0.0.1:5432'));
      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('An unexpected error occurred');
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
      spy.mockRestore();
    });

    it('logs full AppError details internally even in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const err = new AppError(500, 'DB_ERROR', 'password authentication failed for user "morket"');
      const app = createApp(err);

      await request(app).get('/test');

      expect(spy).toHaveBeenCalledWith('AppError', expect.objectContaining({
        code: 'DB_ERROR',
        message: 'password authentication failed for user "morket"',
        stack: err.stack,
      }));
      spy.mockRestore();
    });

    it('does not include stack traces in response body in production', async () => {
      process.env.NODE_ENV = 'production';
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const app = createApp(new AppError(400, 'TEST', 'safe message'));
      const res = await request(app).get('/test');

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('at ');
      expect(body).not.toContain('node_modules');
      spy.mockRestore();
    });
  });

  describe('response envelope format', () => {
    it('always returns success: false', async () => {
      const app = createApp(new ValidationError('bad'));
      const res = await request(app).get('/test');
      expect(res.body.success).toBe(false);
    });

    it('always returns data: null', async () => {
      const app = createApp(new NotFoundError('gone'));
      const res = await request(app).get('/test');
      expect(res.body.data).toBeNull();
    });

    it('always returns error object with code and message', async () => {
      const app = createApp(new Error('oops'));
      const res = await request(app).get('/test');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('message');
    });
  });
});
