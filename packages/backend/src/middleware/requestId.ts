import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import '../shared/types';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
