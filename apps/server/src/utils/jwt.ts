import jwt, { JwtPayload } from 'jsonwebtoken';
import type { CookieOptions } from 'express';
import type { UserRole as DbUserRole } from '@codecollab/database';

export const AUTH_COOKIE_NAME = 'codecollab_token';
const DEFAULT_JWT_EXPIRES_IN = '15m';
const MIN_JWT_SECRET_LENGTH = 32;

export interface AccessTokenPayload {
  sub: string;
  role: DbUserRole;
}

const UNIT_TO_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

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

export const signAccessToken = (payload: AccessTokenPayload): string => {
  const { secret, expiresInSeconds } = getJwtConfig();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
};

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
