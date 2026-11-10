import { RequestHandler } from 'express';
import { ZodType } from 'zod';
import { AppError } from '../utils/AppError';

/**
 * Validates and sanitizes req.body against a shared Zod schema.
 * Forwards structured field errors into our global error middleware on failure.
 */
export const validateBody = (schema: ZodType): RequestHandler => {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'body',
        message: issue.message,
      }));

      next(new AppError(400, 'VALIDATION_ERROR', 'Validation failed', details));
      return;
    }

    // Reassign parsed/normalized data and strip unknown properties
    req.body = result.data;
    next();
  };
};
