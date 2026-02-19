import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../shared/errors';

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        errors.push(...formatZodErrors(result.error, 'body'));
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        req.params = result.data;
      } else {
        errors.push(...formatZodErrors(result.error, 'params'));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        req.query = result.data;
      } else {
        errors.push(...formatZodErrors(result.error, 'query'));
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(errors.join('; '));
    }

    next();
  };
}

function formatZodErrors(error: ZodError, source: string): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${source}.${issue.path.join('.')}` : source;
    return `${path}: ${issue.message}`;
  });
}
