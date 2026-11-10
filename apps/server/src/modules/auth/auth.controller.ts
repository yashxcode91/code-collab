import { RequestHandler } from 'express';
import {
  ApiResponse,
  AuthResponse,
  LoginInput,
  RegisterInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import {
  AUTH_COOKIE_NAME,
  getAuthCookieMaxAgeMs,
  getAuthCookieOptions,
} from '../../utils/jwt';
import { loginUser, registerUser } from './auth.service';

export const registerController: RequestHandler = async (req, res) => {
  const input = req.body as RegisterInput;
  const { user, token } = await registerUser(input);

  res.cookie(AUTH_COOKIE_NAME, token, {
    ...getAuthCookieOptions(),
    maxAge: getAuthCookieMaxAgeMs(),
  });

  const response: ApiResponse<AuthResponse> = {
    success: true,
    data: { user },
  };
  res.status(201).json(response);
};

export const loginController: RequestHandler = async (req, res) => {
  const input = req.body as LoginInput;
  const { user, token } = await loginUser(input);

  res.cookie(AUTH_COOKIE_NAME, token, {
    ...getAuthCookieOptions(),
    maxAge: getAuthCookieMaxAgeMs(),
  });

  const response: ApiResponse<AuthResponse> = {
    success: true,
    data: { user },
  };
  res.status(200).json(response);
};

export const logoutController: RequestHandler = async (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Logged out successfully' },
  };
  res.status(200).json(response);
};

export const meController: RequestHandler = async (req, res, next) => {
  if (!req.user) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }

  const response: ApiResponse<AuthResponse> = {
    success: true,
    data: { user: req.user },
  };
  res.status(200).json(response);
};
