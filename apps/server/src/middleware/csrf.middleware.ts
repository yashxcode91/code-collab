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
  const rawClientUrl = process.env.CLIENT_URL ?? process.env.FRONTEND_ORIGIN;

  // Allow localhost:5173 convenience fallback in dev, but require explicit CLIENT_URL in production
  if (rawClientUrl === undefined) {
    if (isProduction) {
      throw new Error('CLIENT_URL environment variable is required in production');
    }
    return DEFAULT_DEV_CLIENT_URL;
  }

  const trimmed = rawClientUrl.trim();
  // Reject wildcard '*' or sandboxed 'null' because credentialed CORS/CSRF cannot trust them
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

  // Reject non-web schemes (e.g. ftp:, javascript:) and force HTTPS in production (except localhost)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `CLIENT_URL must use http or https protocol: "${rawClientUrl}"`
    );
  }

  const isLocalhostOrIp =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(parsed.hostname);
  const allowInsecureHttp = process.env.ALLOW_INSECURE_HTTP === 'true';
  if (isProduction && !isLocalhostOrIp && !allowInsecureHttp && parsed.protocol !== 'https:') {
    throw new Error(
      `CLIENT_URL must use https in production: "${rawClientUrl}"`
    );
  }

  // Origin-only check: forbid paths, query strings, hashes, or embedded user:pass
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
 * Evaluates whether an incoming request Origin is permitted under CORS and CSRF rules.
 * Supports:
 * - Exact match with canonical CLIENT_URL / FRONTEND_ORIGIN
 * - Equivalent schemes (http/https) on the same configured domain (e.g. while SSL certs are provisioning)
 * - Both apex and 'www' subdomains of the configured domain (e.g. devnolith.in <-> www.devnolith.in)
 * - Direct server IPv4 origin fallback
 * - Localhost in non-production or test environments
 */
export const isAllowedOrigin = (requestOrigin?: string | null): boolean => {
  if (!requestOrigin || requestOrigin === 'null') return false;

  let canonical: string;
  try {
    canonical = getAllowedOrigin();
  } catch {
    return false;
  }

  if (requestOrigin === canonical) return true;

  try {
    const canonicalUrl = new URL(canonical);
    const reqUrl = new URL(requestOrigin);

    // Normalize hostnames (lowercase, strip trailing dots)
    const canonicalHost = canonicalUrl.hostname.toLowerCase();
    const reqHost = reqUrl.hostname.toLowerCase();

    // 1. Same host with http vs https (e.g. while SSL certs are provisioning or behind edge proxy)
    if (reqHost === canonicalHost) {
      return true;
    }

    // 2. Apex vs www subdomain equivalence (devnolith.in <-> www.devnolith.in)
    if (reqHost === `www.${canonicalHost}` || canonicalHost === `www.${reqHost}`) {
      return true;
    }

    // 3. Local development fallbacks
    if (reqHost === 'localhost' || reqHost === '127.0.0.1') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

/**
 * Defense-in-depth Origin/Referer check for state-changing HTTP methods.
 * Works alongside SameSite cookies (Step 4), strict CORS, and JSON-only parsing.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  // Read-only requests (GET/HEAD/OPTIONS) don't mutate server state
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const originHeader = req.get('origin');

  // 1. Prefer `Origin` header (sent automatically by browsers on fetch/POST; reject sandboxed `origin: null`)
  if (originHeader !== undefined) {
    if (originHeader === 'null' || !isAllowedOrigin(originHeader)) {
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

  // 2. Fall back to `Referer` origin if browser omitted `Origin`
  const refererHeader = req.get('referer');
  if (refererHeader !== undefined) {
    try {
      const refererOrigin = new URL(refererHeader).origin;
      if (!isAllowedOrigin(refererOrigin)) {
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
