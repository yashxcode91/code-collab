import jwt, { JwtPayload } from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import type { UserRole as DbUserRole } from '@codecollab/database';

// Cookie names & security floors shared between auth routes and auth middleware
export const AUTH_COOKIE_NAME = 'codecollab_token';
export const OAUTH_STATE_COOKIE_NAME = 'codecollab_oauth_state';
const DEFAULT_JWT_EXPIRES_IN = '15m';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const MIN_JWT_SECRET_LENGTH = 32;

/** Claims embedded inside our main session JWT (`codecollab_token`). */
export interface AccessTokenPayload {
  sub: string; // Authenticated User UUID
  role: DbUserRole;
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
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET environment variable must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`
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

/**
 * Shared cookie attributes used for both res.cookie() and res.clearCookie().
 * Keeping options identical prevents browsers from ignoring cookie deletion.
 */
export const getAuthCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});

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

// OAuth state cookies are restricted strictly to `/api/auth` routes so they aren't sent everywhere
export const getOAuthStateCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/auth',
});

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
