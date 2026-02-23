import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors';
import { errorResponse } from '../shared/envelope';
import { logger } from '../shared/logger';

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/**
 * Scrub a message of internal file paths and database error details.
 * Matches patterns like /app/src/..., .ts:123, .js:45, and common DB error prefixes.
 */
function containsInternalDetails(message: string): boolean {
  const internalPatterns = [
    /\/app\/src\//i,
    /\/home\//i,
    /\/usr\//i,
    /\.(ts|js):\d+/,
    /at\s+\S+\s+\(/,
    /node_modules\//,
    /Error:\s+relation\s+"/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /password authentication failed/i,
    /syntax error at or near/i,
    /duplicate key value/i,
  ];
  return internalPatterns.some((pattern) => pattern.test(message));
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    // Always log full error details internally for debugging
    logger.error('AppError', {
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      stack: err.stack,
    });

    if (isProduction()) {
      // In production, sanitize the message if it contains internal details
      const safeMessage = containsInternalDetails(err.message)
        ? 'An error occurred'
        : err.message;
      res.status(err.statusCode).json(errorResponse(err.code, safeMessage));
    } else {
      res.status(err.statusCode).json(errorResponse(err.code, err.message));
    }
    return;
  }

  // Unknown errors — always log full details internally
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  // Never expose internal details for unknown errors
  res.status(500).json(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'));
}
