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

export const authRouter = Router();

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

authRouter.get('/me', requireAuth, asyncHandler(meController));

authRouter.get('/google', oauthStartController('google'));
authRouter.get('/google/callback', asyncHandler(oauthCallbackController('google')));

authRouter.get('/github', oauthStartController('github'));
authRouter.get('/github/callback', asyncHandler(oauthCallbackController('github')));
