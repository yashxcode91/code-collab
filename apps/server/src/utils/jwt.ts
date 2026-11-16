import crypto from 'node:crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import type { UserRole as DbUserRole } from '@codecollab/database';

// Cookie names & security floors shared between auth routes and auth middleware
export const AUTH_COOKIE_NAME = 'codecollab_token';
export const REFRESH_COOKIE_NAME = 'codecollab_refresh_token';
export const OAUTH_STATE_COOKIE_NAME = 'codecollab_oauth_state';
const DEFAULT_JWT_EXPIRES_IN = '15m';
export const DEFAULT_REFRESH_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60; // 30 days
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const MIN_JWT_SECRET_LENGTH = 32;

/** Claims embedded inside our main session JWT (`codecollab_token`). */
export interface AccessTokenPayload {
  sub: string; // Authenticated User UUID
  role: DbUserRole;
}

/** Claims embedded inside our long-lived refresh token (`codecollab_refresh_token`). */
export interface RefreshTokenPayload {
  sub: string; // Authenticated User UUID
  purpose: 'refresh_token';
  jti: string; // Unique token ID for replay prevention / rotation
}

export type OAuthProviderKey = 'google' | 'github';

/** Short-lived signed claims stored in `codecollab_oauth_state` to block OAuth CSRF/replay attacks. */
export interface OAuthStatePayload {
  purpose: 'oauth_state';
  provider: OAuthProviderKey;
  state: string;
  codeVerifier?: string; // PKCE secret used only during Google code exchange
}

const UNIT_TO_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/** Parses duration strings like "15m", "1h", or "7d" into seconds for JWT expiry & cookie `maxAge`. */
const parseExpiresInSeconds = (rawValue: string | undefined): number => {
  const raw = rawValue === undefined ? DEFAULT_JWT_EXPIRES_IN : rawValue.trim();
  const match = /^(\d+)([smhd])$/.exec(raw);

  if (!match) {
    throw new Error(
      `Invalid JWT_EXPIRES_IN format: "${rawValue}". Expected e.g. "15m", "1h", or "7d".`
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`JWT_EXPIRES_IN must be positive: "${rawValue}"`);
  }

  return amount * UNIT_TO_SECONDS[unit];
};

const getJwtConfig = (): { secret: string; expiresInSeconds: number } => {
  const secret = (process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET)?.trim();
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET or JWT_ACCESS_SECRET environment variable must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`
    );
  }

  const expiresInSeconds = parseExpiresInSeconds(process.env.JWT_EXPIRES_IN);
  return { secret, expiresInSeconds };
};

/**
 * Validates JWT environment configuration eagerly on server boot.
 */
export const validateJwtConfig = (): void => {
  getJwtConfig();
};

export const getAuthCookieMaxAgeMs = (): number => {
  const { expiresInSeconds } = getJwtConfig();
  return expiresInSeconds * 1000;
};

export const isSecureCookie = (): boolean => {
  const origin = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || '';
  if (origin.startsWith('https://')) return true;
  if (origin.startsWith('http://')) return false;
  if (
    process.env.NODE_ENV === 'production' &&
    !origin.includes('localhost') &&
    !origin.includes('127.0.0.1')
  ) {
    return true;
  }
  return false;
};

/**
 * Shared cookie attributes used for both res.cookie() and res.clearCookie().
 * Keeping options identical prevents browsers from ignoring cookie deletion.
 */
export const getAuthCookieOptions = (): CookieOptions => {
  const secure = isSecureCookie();
  const origin = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || '';
  const isCrossOrigin =
    secure &&
    origin.length > 0 &&
    !origin.includes('localhost') &&
    !origin.includes('127.0.0.1');

  return {
    httpOnly: true,
    secure,
    sameSite: isCrossOrigin ? 'none' : 'lax',
    path: '/',
  };
};

/** Signs an HS256 access JWT for an authenticated user session. */
export const signAccessToken = (payload: AccessTokenPayload): string => {
  const { secret, expiresInSeconds } = getJwtConfig();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
};

/** Verifies signature/algorithm (`HS256` pinned to block `alg=none` downgrade) and validates claim shape. */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const { secret } = getJwtConfig();
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as JwtPayload;

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded.sub !== 'string' ||
    decoded.sub.length === 0 ||
    (decoded.role !== 'ADMIN' && decoded.role !== 'USER')
  ) {
    throw new jwt.JsonWebTokenError('Malformed JWT payload claims');
  }

  return {
    sub: decoded.sub,
    role: decoded.role,
  };
};

/**
 * Cookie options for the long-lived refresh token.
 * Note: Path is restricted to `/api/auth` so the browser only sends it to auth routes.
 */
export const getRefreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isSecureCookie(),
  sameSite: 'lax',
  path: '/api/auth',
});

export const getRefreshCookieMaxAgeMs = (): number =>
  DEFAULT_REFRESH_EXPIRES_IN_SECONDS * 1000;

/** Signs an HS256 long-lived refresh token (30 days) for session continuity. */
export const signRefreshToken = (
  userId: string
): { refreshToken: string; jti: string } => {
  const { secret } = getJwtConfig();
  const jti = crypto.randomUUID();
  const refreshSecret = `${secret}:refresh`;

  const refreshToken = jwt.sign(
    {
      sub: userId,
      purpose: 'refresh_token',
      jti,
    },
    refreshSecret,
    {
      algorithm: 'HS256',
      expiresIn: DEFAULT_REFRESH_EXPIRES_IN_SECONDS,
    }
  );

  return { refreshToken, jti };
};

/** Verifies signature, purpose, and structure of a refresh token. */
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const { secret } = getJwtConfig();
  const refreshSecret = `${secret}:refresh`;

  const decoded = jwt.verify(token, refreshSecret, {
    algorithms: ['HS256'],
  }) as JwtPayload;

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded.sub !== 'string' ||
    decoded.sub.length === 0 ||
    decoded.purpose !== 'refresh_token' ||
    typeof decoded.jti !== 'string'
  ) {
    throw new jwt.JsonWebTokenError('Malformed refresh token');
  }

  return {
    sub: decoded.sub,
    purpose: 'refresh_token',
    jti: decoded.jti,
  };
};

// OAuth state cookies are restricted strictly to `/api/auth` routes so they aren't sent everywhere
export const getOAuthStateCookieOptions = (): CookieOptions => {
  const secure = isSecureCookie();
  const origin = process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || '';
  const isCrossOrigin =
    secure &&
    origin.length > 0 &&
    !origin.includes('localhost') &&
    !origin.includes('127.0.0.1');

  return {
    httpOnly: true,
    secure,
    sameSite: isCrossOrigin ? 'none' : 'lax',
    path: '/api/auth',
  };
};

export const getOAuthStateCookieMaxAgeMs = (): number =>
  OAUTH_STATE_TTL_SECONDS * 1000;

/** Signs a 10-minute tamper-proof OAuth CSRF state JWT (and PKCE verifier when using Google). */
export const signOAuthStateToken = (
  payload: Omit<OAuthStatePayload, 'purpose'>
): string => {
  const { secret } = getJwtConfig();
  return jwt.sign(
    {
      purpose: 'oauth_state',
      ...payload,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: OAUTH_STATE_TTL_SECONDS,
    }
  );
};

/** Verifies signature, expiry, `purpose === 'oauth_state'`, and state token field invariants. */
export const verifyOAuthStateToken = (token: string): OAuthStatePayload => {
  const { secret } = getJwtConfig();
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as JwtPayload;

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    decoded.purpose !== 'oauth_state' ||
    (decoded.provider !== 'google' && decoded.provider !== 'github') ||
    typeof decoded.state !== 'string' ||
    decoded.state.length < 16 ||
    (decoded.codeVerifier !== undefined &&
      typeof decoded.codeVerifier !== 'string')
  ) {
    throw new jwt.JsonWebTokenError('Malformed OAuth state token');
  }

  return {
    purpose: 'oauth_state',
    provider: decoded.provider,
    state: decoded.state,
    ...(decoded.codeVerifier ? { codeVerifier: decoded.codeVerifier } : {}),
  };
};

export interface PreviewJwtPayload {
  purpose: 'sandbox_preview';
  projectId: string;
  branchId: string;
  userId: string;
}

/** Signs a 2-hour signed JWT granting temporary preview access to a specific sandbox. */
export const signPreviewToken = (payload: {
  projectId: string;
  branchId: string;
  userId: string;
}): string => {
  const { secret } = getJwtConfig();
  return jwt.sign(
    {
      purpose: 'sandbox_preview',
      ...payload,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: 7200, // 2 hours
    }
  );
};

/** Verifies preview token signature and claims. */
export const verifyPreviewToken = (
  token: string
): { projectId: string; branchId: string; userId: string } => {
  const { secret } = getJwtConfig();
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as JwtPayload;

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    decoded.purpose !== 'sandbox_preview' ||
    typeof decoded.projectId !== 'string' ||
    typeof decoded.branchId !== 'string' ||
    typeof decoded.userId !== 'string'
  ) {
    throw new jwt.JsonWebTokenError('Malformed preview sandbox token');
  }

  return {
    projectId: decoded.projectId,
    branchId: decoded.branchId,
    userId: decoded.userId,
  };
};
