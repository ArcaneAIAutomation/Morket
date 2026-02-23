import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../shared/errors';
import { getRedis } from '../cache/redis';
import { logAuthFailure } from '../observability/logger';
import '../shared/types';

const PUBLIC_ROUTES: Array<{ method: string; path: string | RegExp }> = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'GET', path: '/api/v1/health' },
  { method: 'POST', path: /^\/api\/v1\/invitations\/[^/]+\/accept$/ },
  { method: 'POST', path: /^\/api\/v1\/invitations\/[^/]+\/decline$/ },
];

function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((route) => {
    if (route.method !== method.toUpperCase()) return false;
    if (typeof route.path === 'string') return route.path === path;
    return route.path.test(path);
  });
}

async function isTokenRevoked(jti: string): Promise<boolean> {
  try {
    const redis = getRedis();
    if (!redis) return false; // Graceful degradation: skip revocation check if Redis unavailable
    const result = await redis.get(`jti:${jti}`);
    return result !== null;
  } catch {
    // Graceful degradation: if Redis errors, allow the request through
    return false;
  }
}

export function createAuthMiddleware(jwtSecret: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (isPublicRoute(req.method, req.path)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logAuthFailure({
        sourceIp: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'],
        reason: 'Missing or invalid authorization header',
      });
      return next(new AuthenticationError('Missing or invalid authorization header'));
    }

    const token = authHeader.slice(7);

    try {
      const decoded = jwt.verify(token, jwtSecret, {
        issuer: 'morket',
        audience: 'morket-api',
      }) as { userId: string; role?: string; workspaceId?: string; jti?: string };

      // Check jti revocation if present
      if (decoded.jti) {
        const revoked = await isTokenRevoked(decoded.jti);
        if (revoked) {
          logAuthFailure({
            sourceIp: req.ip || req.socket.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'],
            reason: 'Token has been revoked',
          });
          return next(new AuthenticationError('Token has been revoked'));
        }
      }

      req.user = {
        userId: decoded.userId,
        role: decoded.role as any,
        workspaceId: decoded.workspaceId,
      };
      next();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        return next(err);
      }
      const reason = err instanceof jwt.TokenExpiredError ? 'Token has expired' : 'Invalid token';
      logAuthFailure({
        sourceIp: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'],
        reason,
      });
      if (err instanceof jwt.TokenExpiredError) {
        return next(new AuthenticationError('Token has expired'));
      }
      return next(new AuthenticationError('Invalid token'));
    }
  };
}
