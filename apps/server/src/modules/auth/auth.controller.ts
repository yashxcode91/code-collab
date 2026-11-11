import { RequestHandler } from 'express';
import {
  ApiResponse,
  AuthResponse,
  LoginInput,
  RegisterInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { getAllowedOrigin } from '../../middleware/csrf.middleware';
import {
  AUTH_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAuthProviderKey,
  getAuthCookieMaxAgeMs,
  getAuthCookieOptions,
  getOAuthStateCookieMaxAgeMs,
  getOAuthStateCookieOptions,
} from '../../utils/jwt';
import { loginUser, registerUser } from './auth.service';
import {
  OAuthFlowError,
  completeOAuthCallback,
  createOAuthAuthorizationRequest,
} from './oauth.service';

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

const asSingleQueryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const oauthStartController =
  (provider: OAuthProviderKey): RequestHandler =>
  (_req, res) => {
    const clientOrigin = getAllowedOrigin();
    try {
      const { authorizationUrl, stateToken } =
        createOAuthAuthorizationRequest(provider);

      res.cookie(OAUTH_STATE_COOKIE_NAME, stateToken, {
        ...getOAuthStateCookieOptions(),
        maxAge: getOAuthStateCookieMaxAgeMs(),
      });

      res.redirect(302, authorizationUrl);
    } catch (err) {
      const code =
        err instanceof OAuthFlowError ? err.errorCode : 'oauth_failed';
      res.redirect(
        302,
        `${clientOrigin}/login?error=${encodeURIComponent(code)}`
      );
    }
  };

export const oauthCallbackController =
  (provider: OAuthProviderKey): RequestHandler =>
  async (req, res) => {
    const clientOrigin = getAllowedOrigin();
    const stateToken =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_NAME] === 'string'
        ? req.cookies[OAUTH_STATE_COOKIE_NAME]
        : undefined;

    // Single-use state cookie: always clear on callback arrival
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getOAuthStateCookieOptions());

    try {
      const { token } = await completeOAuthCallback({
        provider,
        code: asSingleQueryString(req.query.code),
        queryState: asSingleQueryString(req.query.state),
        errorParam: asSingleQueryString(req.query.error),
        stateToken,
      });

      res.cookie(AUTH_COOKIE_NAME, token, {
        ...getAuthCookieOptions(),
        maxAge: getAuthCookieMaxAgeMs(),
      });

      res.redirect(302, `${clientOrigin}/`);
    } catch (err) {
      if (!(err instanceof OAuthFlowError)) {
        console.error(`[OAuth ${provider} callback error]:`, err);
      }
      const code =
        err instanceof OAuthFlowError ? err.errorCode : 'oauth_failed';
      res.redirect(
        302,
        `${clientOrigin}/login?error=${encodeURIComponent(code)}`
      );
    }
  };
