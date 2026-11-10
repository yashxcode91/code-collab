import { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiResponse } from '@codecollab/shared';
import { AppError } from '../utils/AppError';

/**
 * Fallback middleware for unmatched API routes.
 * Forwards a structured 404 AppError to the global error handler.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(
      404,
      'ROUTE_NOT_FOUND',
      `Route ${req.method} ${req.originalUrl} not found`
    )
  );
};

/**
 * Global 4-parameter Express error middleware.
 * Formats all operational, malformed JSON, and unexpected errors into our ApiResponse envelope.
 */
export const globalErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next
) => {
  if (err instanceof AppError) {
    const response: ApiResponse<never> = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle malformed JSON request bodies thrown by express.json()
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    err.status === 400 &&
    'body' in err
  ) {
    const response: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload in request body',
      },
    };
    res.status(400).json(response);
    return;
  }

  console.error('[Unhandled Server Error]:', err);

  const response: ApiResponse<never> = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  };
  res.status(500).json(response);
};
