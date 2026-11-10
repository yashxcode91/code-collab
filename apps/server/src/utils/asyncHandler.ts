import { RequestHandler } from 'express';

/**
 * Wraps async Express 4 route handlers so rejected Promises are automatically
 * forwarded to next(err) and handled by globalErrorHandler.
 */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
