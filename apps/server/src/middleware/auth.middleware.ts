import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { AUTH_COOKIE_NAME, verifyAccessToken } from '../utils/jwt';
import { getUserById } from '../modules/auth/auth.service';

/**
 * Guards private routes by reading the HttpOnly JWT cookie, verifying its
 * signature/expiry, and attaching the fresh public user record to req.user.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token || typeof token !== 'string') {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }

  let userId: string;
  try {
    const payload = verifyAccessToken(token);
    userId = payload.sub;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(
        new AppError(
          401,
          'TOKEN_EXPIRED',
          'Session expired. Please log in again'
        )
      );
      return;
    }

    next(new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token'));
    return;
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      next(new AppError(401, 'UNAUTHORIZED', 'User account no longer exists'));
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
