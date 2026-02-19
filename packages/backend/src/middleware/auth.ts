import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../shared/errors';
import '../shared/types';

const PUBLIC_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'GET', path: '/api/v1/health' },
];

function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.path === path,
  );
}

export function createAuthMiddleware(jwtSecret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (isPublicRoute(req.method, req.path)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or invalid authorization header');
    }

    const token = authHeader.slice(7);

    try {
      const decoded = jwt.verify(token, jwtSecret) as { userId: string };
      req.user = { userId: decoded.userId };
      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token has expired');
      }
      throw new AuthenticationError('Invalid token');
    }
  };
}
