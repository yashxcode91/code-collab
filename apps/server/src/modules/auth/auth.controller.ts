import { createHash } from 'node:crypto';
import { RequestHandler } from 'express';
import {
  ApiResponse,
  AuthResponse,
  LoginInput,
  RegisterInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { getAllowedOrigin } from '../../middleware/csrf.middleware';
import { disconnectSocketsByTokenHash } from '../../realtime/socketServer';
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

/**
 * Registers a user and stores the JWT inside an HttpOnly cookie (never in JSON body,
 * so frontend JS/XSS cannot steal session tokens).
 */
export const registerController: RequestHandler = async (req, res) => {
  // req.body is already validated & normalized (trim/lowercase) by validateBody(RegisterSchema)
  const input = req.body as RegisterInput;
  const { user, token } = await registerUser(input);

  // Store JWT only in an HttpOnly cookie so JavaScript/XSS cannot read the token
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

/** Authenticates credentials and sets the HttpOnly JWT session cookie. */
export const loginController: RequestHandler = async (req, res) => {
  const input = req.body as LoginInput;
  const { user, token } = await loginUser(input);

  // Refresh the browser's session cookie with matching expiration maxAge
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

/** Clears the HttpOnly auth cookie and evicts active WebSocket sessions bound to that token. */
export const logoutController: RequestHandler = async (req, res) => {
  const token =
    typeof req.cookies?.[AUTH_COOKIE_NAME] === 'string'
      ? req.cookies[AUTH_COOKIE_NAME]
      : null;
  if (token) {
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    await disconnectSocketsByTokenHash(tokenHash);
  }

  // Passing exact same { httpOnly, sameSite, path, secure } ensures browsers delete the cookie
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());

  const response: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Logged out successfully' },
  };
  res.status(200).json(response);
};

/** Returns the currently authenticated user attached to `req.user` by `requireAuth`. */
export const meController: RequestHandler = async (req, res, next) => {
  // Defensive fallback in case route is ever mounted without `requireAuth`
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

// Reject array/object query tampering like `?code[]=a&code[]=b` — only accept non-empty strings
const asSingleQueryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Initiates OAuth login for `google` or `github`: mints a single-use CSRF `stateToken` cookie
 * and redirects the browser to the provider's consent screen.
 */
export const oauthStartController =
  (provider: OAuthProviderKey): RequestHandler =>
  (_req, res) => {
    const clientOrigin = getAllowedOrigin();
    try {
      // 1. Build provider auth URL + signed JWT containing random `state` (and PKCE verifier for Google)
      const { authorizationUrl, stateToken } =
        createOAuthAuthorizationRequest(provider);

      // 2. Bind `stateToken` to the browser via a 10-min HttpOnly cookie scoped to `/api/auth`
      res.cookie(OAUTH_STATE_COOKIE_NAME, stateToken, {
        ...getOAuthStateCookieOptions(),
        maxAge: getOAuthStateCookieMaxAgeMs(),
      });

      // 3. Send browser to Google / GitHub consent page
      res.redirect(302, authorizationUrl);
    } catch (err) {
      // Redirect errors back to frontend `/login?error=...` instead of showing raw JSON on full-page OAuth load
      const code =
        err instanceof OAuthFlowError ? err.errorCode : 'oauth_failed';
      res.redirect(
        302,
        `${clientOrigin}/login?error=${encodeURIComponent(code)}`
      );
    }
  };

/**
 * Handles the OAuth provider callback redirect: clears the one-time state cookie,
 * verifies CSRF state + authorization code, logs user in via HttpOnly cookie, and redirects home.
 */
export const oauthCallbackController =
  (provider: OAuthProviderKey): RequestHandler =>
  async (req, res) => {
    const clientOrigin = getAllowedOrigin();

    // 1. Read the temporary CSRF state cookie created during `/api/auth/:provider`
    const stateToken =
      typeof req.cookies?.[OAUTH_STATE_COOKIE_NAME] === 'string'
        ? req.cookies[OAUTH_STATE_COOKIE_NAME]
        : undefined;

    // 2. Single-use cookie: clear immediately on arrival so callbacks cannot be replayed twice
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, getOAuthStateCookieOptions());

    try {
      // 3. Verify `state`, exchange authorization `code` for verified profile, and upsert/link User
      const { token } = await completeOAuthCallback({
        provider,
        code: asSingleQueryString(req.query.code),
        queryState: asSingleQueryString(req.query.state),
        errorParam: asSingleQueryString(req.query.error),
        stateToken,
      });

      // 4. Issue normal session HttpOnly JWT cookie and return user to Workspace Dashboard
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
