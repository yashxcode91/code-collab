import { Router } from 'express';
import { LoginSchema, RegisterSchema } from '@codecollab/shared';
import { asyncHandler } from '../../utils/asyncHandler';
import { validateBody } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  loginController,
  logoutController,
  meController,
  oauthCallbackController,
  oauthStartController,
  registerController,
} from './auth.controller';

/**
 * Authentication & OAuth 2.0 router mounted at `/api/auth`.
 * Public write routes validate inputs with shared Zod schemas; `/me` requires `requireAuth`.
 */
export const authRouter = Router();

// Local email/username + password authentication
authRouter.post(
  '/register',
  validateBody(RegisterSchema),
  asyncHandler(registerController)
);

authRouter.post(
  '/login',
  validateBody(LoginSchema),
  asyncHandler(loginController)
);

authRouter.post('/logout', asyncHandler(logoutController));

// Session verification endpoint called by AuthProvider on frontend load
authRouter.get('/me', requireAuth, asyncHandler(meController));

// Browser redirect flows for Google (PKCE) & GitHub OAuth 2.0
authRouter.get('/google', oauthStartController('google'));
authRouter.get('/google/callback', asyncHandler(oauthCallbackController('google')));

authRouter.get('/github', oauthStartController('github'));
authRouter.get('/github/callback', asyncHandler(oauthCallbackController('github')));
