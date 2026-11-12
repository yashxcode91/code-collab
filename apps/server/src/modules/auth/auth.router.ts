import { Router } from 'express';
import { LoginSchema, RegisterSchema } from '@codecollab/shared';
import { asyncHandler } from '../../utils/asyncHandler';
import { validateBody } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { createRateLimitMiddleware } from '../../middleware/rateLimit.middleware';
import {
  loginController,
  logoutController,
  meController,
  oauthCallbackController,
  oauthStartController,
  registerController,
} from './auth.controller';

const registerIpLimiter = createRateLimitMiddleware({
  keyPrefix: 'auth:register-ip',
  maxRequests: 60,
  windowSec: 60,
  message: 'Too many registration attempts; please try again shortly',
});

const loginIpLimiter = createRateLimitMiddleware({
  keyPrefix: 'auth:login-ip',
  maxRequests: 60,
  windowSec: 60,
  message: 'Too many login attempts; please try again shortly',
});

const oauthIpLimiter = createRateLimitMiddleware({
  keyPrefix: 'auth:oauth-ip',
  maxRequests: 60,
  windowSec: 60,
  message: 'Too many OAuth attempts; please try again shortly',
});

const loginAccountLimiter = createRateLimitMiddleware({
  keyPrefix: 'auth:login-acct',
  maxRequests: 10,
  windowSec: 60,
  message: 'Too many login attempts for this account; please wait a minute',
  getKeySuffix: (req) => {
    const body = req.body as { identifier?: unknown; email?: unknown } | undefined;
    const raw =
      typeof body?.identifier === 'string'
        ? body.identifier
        : typeof body?.email === 'string'
          ? body.email
          : null;
    if (!raw) return null;
    return `${req.ip || 'unknown'}:${raw.trim().toLowerCase().slice(0, 120)}`;
  },
});

/**
 * Authentication & OAuth 2.0 router mounted at `/api/auth`.
 * Public write routes validate inputs with shared Zod schemas; `/me` requires `requireAuth`.
 */
export const authRouter = Router();

// Local email/username + password authentication
authRouter.post(
  '/register',
  registerIpLimiter,
  validateBody(RegisterSchema),
  asyncHandler(registerController)
);

authRouter.post(
  '/login',
  loginIpLimiter,
  validateBody(LoginSchema),
  loginAccountLimiter,
  asyncHandler(loginController)
);

authRouter.post('/logout', asyncHandler(logoutController));

// Session verification endpoint called by AuthProvider on frontend load
authRouter.get('/me', requireAuth, asyncHandler(meController));

// Browser redirect flows for Google (PKCE) & GitHub OAuth 2.0
authRouter.get('/google', oauthIpLimiter, oauthStartController('google'));
authRouter.get(
  '/google/callback',
  oauthIpLimiter,
  asyncHandler(oauthCallbackController('google'))
);

authRouter.get('/github', oauthIpLimiter, oauthStartController('github'));
authRouter.get(
  '/github/callback',
  oauthIpLimiter,
  asyncHandler(oauthCallbackController('github'))
);
