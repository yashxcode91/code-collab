import { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_DEV_CLIENT_URL = 'http://localhost:5173';

/**
 * Validates and normalizes CLIENT_URL into a strict canonical origin
 * (scheme://host[:port]), failing fast on malformed or unsafe configuration.
 */
export const getAllowedOrigin = (): string => {
  const isProduction = process.env.NODE_ENV === 'production';
  const rawClientUrl = process.env.CLIENT_URL;

  if (rawClientUrl === undefined) {
    if (isProduction) {
      throw new Error('CLIENT_URL environment variable is required in production');
    }
    return DEFAULT_DEV_CLIENT_URL;
  }

  const trimmed = rawClientUrl.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'null') {
    throw new Error(`Invalid CLIENT_URL configuration: "${rawClientUrl}"`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `CLIENT_URL must be a valid URL with protocol: "${rawClientUrl}"`
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `CLIENT_URL must use http or https protocol: "${rawClientUrl}"`
    );
  }

  if (isProduction && parsed.protocol !== 'https:') {
    throw new Error(
      `CLIENT_URL must use https in production: "${rawClientUrl}"`
    );
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error(
      `CLIENT_URL must be an origin only (no path, query, hash, or credentials): "${rawClientUrl}"`
    );
  }

  return parsed.origin;
};

/**
 * Defense-in-depth Origin/Referer check for state-changing HTTP methods.
 * Works alongside SameSite cookies (Step 4), strict CORS, and JSON-only parsing.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const allowedOrigin = getAllowedOrigin();
  const originHeader = req.get('origin');

  if (originHeader !== undefined) {
    if (originHeader === 'null' || originHeader !== allowedOrigin) {
      next(
        new AppError(
          403,
          'CSRF_INVALID_ORIGIN',
          'Request origin is not allowed'
        )
      );
      return;
    }
    next();
    return;
  }

  const refererHeader = req.get('referer');
  if (refererHeader !== undefined) {
    try {
      const refererOrigin = new URL(refererHeader).origin;
      if (refererOrigin !== allowedOrigin) {
        next(
          new AppError(
            403,
            'CSRF_INVALID_REFERER',
            'Request referer is not allowed'
          )
        );
        return;
      }
      next();
      return;
    } catch {
      next(
        new AppError(
          403,
          'CSRF_INVALID_REFERER',
          'Invalid request referer header'
        )
      );
      return;
    }
  }

  // Cookie-bearing browser mutations without Origin/Referer fail closed.
  // Cookie-less non-browser clients (e.g., curl) are allowed under JSON-only parsing.
  if (Boolean(req.headers.cookie)) {
    next(
      new AppError(
        403,
        'CSRF_ORIGIN_MISSING',
        'Missing Origin or Referer header on cookie-authenticated request'
      )
    );
    return;
  }

  next();
};
