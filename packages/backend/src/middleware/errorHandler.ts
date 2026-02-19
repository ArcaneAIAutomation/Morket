import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors';
import { errorResponse } from '../shared/envelope';
import { logger } from '../shared/logger';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(errorResponse(err.code, err.message));
    return;
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'));
}
