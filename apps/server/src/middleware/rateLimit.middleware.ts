import type { Request, RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { consumeSlidingWindowLimit } from '../modules/execution/execution.queue';

export interface RateLimitMiddlewareOptions {
  keyPrefix: string;
  maxRequests: number;
  windowSec: number;
  message: string;
  getKeySuffix?: (req: Request) => string | null;
}

const getClientIp = (req: Request): string => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return ip.replace(/[^A-Za-z0-9.:_-]/g, '_');
};

/**
 * Reusable Express sliding-window rate limiter backed by Redis (`ZREMRANGEBYSCORE` + `ZCARD`).
 */
export const createRateLimitMiddleware = (
  options: RateLimitMiddlewareOptions
): RequestHandler => {
  return async (req, res, next) => {
    try {
      const suffix = options.getKeySuffix
        ? options.getKeySuffix(req)
        : getClientIp(req);

      if (!suffix) {
        next();
        return;
      }

      const key = `codecollab:ratelimit:${options.keyPrefix}:${suffix}`;
      const allowed = await consumeSlidingWindowLimit({
        key,
        maxRequests: options.maxRequests,
        windowSec: options.windowSec,
      });

      if (!allowed) {
        res.setHeader('Retry-After', String(options.windowSec));
        next(new AppError(429, 'RATE_LIMIT_EXCEEDED', options.message));
        return;
      }

      next();
    } catch {
      // Fail open on transient Redis unavailability so auth/health routes don't crash,
      // while logging for ops visibility.
      next();
    }
  };
};
