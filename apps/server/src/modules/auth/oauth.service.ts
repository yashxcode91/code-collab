import crypto from 'node:crypto';
import { AuthProvider, Prisma, prisma } from '@codecollab/database';
import type { User } from '@codecollab/shared';
import { getAllowedOrigin } from '../../middleware/csrf.middleware';
import {
  OAuthProviderKey,
  signAccessToken,
  signOAuthStateToken,
  verifyOAuthStateToken,
} from '../../utils/jwt';
import { toPublicUser } from './auth.service';

export type OAuthErrorCode =
  | 'oauth_not_configured'
  | 'oauth_denied'
  | 'oauth_invalid_state'
  | 'oauth_unverified_email'
  | 'oauth_failed';

export class OAuthFlowError extends Error {
  constructor(
    public readonly errorCode: OAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface NormalizedOAuthProfile {
  provider: AuthProvider;
  providerAccountId: string;
  email: string;
  usernameHint: string;
  avatarUrl?: string;
}

const OAUTH_HTTP_TIMEOUT_MS = 10_000;

const getProviderConfig = (
  provider: OAuthProviderKey
): ProviderConfig | null => {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI?.trim() ||
      `${getAllowedOrigin()}/api/auth/google/callback`;
    return { clientId, clientSecret, redirectUri };
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const redirectUri =
    process.env.GITHUB_REDIRECT_URI?.trim() ||
    `${getAllowedOrigin()}/api/auth/github/callback`;
  return { clientId, clientSecret, redirectUri };
};

const timingSafeEqualString = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export const sanitizeOAuthUsernameBase = (hint: string): string => {
  const cleaned = hint
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (cleaned.length >= 3) {
    return cleaned.slice(0, 14);
  }
  if (cleaned.length > 0) {
    return `${cleaned}_dev`.slice(0, 14);
  }
  return 'dev_user';
};

const generateUniqueUsername = async (
  tx: Prisma.TransactionClient,
  hint: string
): Promise<string> => {
  const base = sanitizeOAuthUsernameBase(hint);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate =
      attempt === 0
        ? base
        : `${base}_${crypto.randomBytes(2).toString('hex')}`.slice(0, 20);

    const existing = await tx.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  return `user_${crypto.randomBytes(6).toString('hex')}`.slice(0, 20);
};

export const createOAuthAuthorizationRequest = (
  provider: OAuthProviderKey
): { authorizationUrl: string; stateToken: string } => {
  const config = getProviderConfig(provider);
  if (!config) {
    throw new OAuthFlowError(
      'oauth_not_configured',
      `${provider} OAuth credentials are not configured`
    );
  }

  const state = crypto.randomBytes(24).toString('base64url');

  if (provider === 'google') {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    const stateToken = signOAuthStateToken({
      provider: 'google',
      state,
      codeVerifier,
    });

    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      stateToken,
    };
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'read:user user:email',
    state,
  });

  const stateToken = signOAuthStateToken({
    provider: 'github',
    state,
  });

  return {
    authorizationUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
    stateToken,
  };
};

const fetchGoogleProfile = async (
  code: string,
  codeVerifier: string,
  config: ProviderConfig
): Promise<NormalizedOAuthProfile> => {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    throw new OAuthFlowError(
      'oauth_failed',
      `Google token exchange failed (${tokenRes.status})`
    );
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new OAuthFlowError(
      'oauth_failed',
      'Google token response missing access_token'
    );
  }

  const profileRes = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    }
  );

  if (!profileRes.ok) {
    throw new OAuthFlowError(
      'oauth_failed',
      `Google userinfo request failed (${profileRes.status})`
    );
  }

  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new OAuthFlowError(
      'oauth_failed',
      'Google profile missing required identifiers'
    );
  }

  if (profile.email_verified !== true) {
    throw new OAuthFlowError(
      'oauth_unverified_email',
      'Google account email must be verified'
    );
  }

  const normalizedEmail = profile.email.trim().toLowerCase();
  const hint =
    normalizedEmail.split('@')[0] || profile.name || 'google_user';

  return {
    provider: AuthProvider.GOOGLE,
    providerAccountId: profile.sub,
    email: normalizedEmail,
    usernameHint: hint,
    ...(typeof profile.picture === 'string' && profile.picture.length > 0
      ? { avatarUrl: profile.picture }
      : {}),
  };
};

interface GitHubEmailRecord {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

const fetchGitHubProfile = async (
  code: string,
  config: ProviderConfig
): Promise<NormalizedOAuthProfile> => {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    throw new OAuthFlowError(
      'oauth_failed',
      `GitHub token exchange failed (${tokenRes.status})`
    );
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token || tokenData.error) {
    throw new OAuthFlowError(
      'oauth_failed',
      tokenData.error || 'GitHub token response missing access_token'
    );
  }

  const ghHeaders = {
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CodeCollab-Auth',
  };

  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: ghHeaders,
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    }),
    fetch('https://api.github.com/user/emails', {
      headers: ghHeaders,
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    }),
  ]);

  if (!userRes.ok || !emailsRes.ok) {
    throw new OAuthFlowError(
      'oauth_failed',
      'GitHub profile or email fetch failed'
    );
  }

  const ghUser = (await userRes.json()) as {
    id?: number | string;
    login?: string;
    avatar_url?: string;
  };
  const ghEmails = (await emailsRes.json()) as GitHubEmailRecord[];

  if (ghUser.id === undefined || ghUser.id === null) {
    throw new OAuthFlowError('oauth_failed', 'GitHub profile missing id');
  }

  const verifiedEmailRecord =
    (Array.isArray(ghEmails)
      ? ghEmails.find((e) => e.primary === true && e.verified === true) ??
        ghEmails.find((e) => e.verified === true)
      : undefined);

  if (!verifiedEmailRecord?.email) {
    throw new OAuthFlowError(
      'oauth_unverified_email',
      'GitHub account must have a verified email address'
    );
  }

  const normalizedEmail = verifiedEmailRecord.email.trim().toLowerCase();
  const hint =
    ghUser.login || normalizedEmail.split('@')[0] || 'github_user';

  return {
    provider: AuthProvider.GITHUB,
    providerAccountId: String(ghUser.id),
    email: normalizedEmail,
    usernameHint: hint,
    ...(typeof ghUser.avatar_url === 'string' && ghUser.avatar_url.length > 0
      ? { avatarUrl: ghUser.avatar_url }
      : {}),
  };
};

const resolveOAuthUser = async (
  profile: NormalizedOAuthProfile
): Promise<{ user: User; token: string }> => {
  const dbUser = await prisma.$transaction(async (tx) => {
    const existingAccount = await tx.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });

    if (existingAccount) {
      if (!existingAccount.user.avatarUrl && profile.avatarUrl) {
        return tx.user.update({
          where: { id: existingAccount.user.id },
          data: { avatarUrl: profile.avatarUrl },
        });
      }
      return existingAccount.user;
    }

    const existingUserByEmail = await tx.user.findUnique({
      where: { email: profile.email },
    });

    if (existingUserByEmail) {
      await tx.account.create({
        data: {
          userId: existingUserByEmail.id,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });

      if (!existingUserByEmail.avatarUrl && profile.avatarUrl) {
        return tx.user.update({
          where: { id: existingUserByEmail.id },
          data: { avatarUrl: profile.avatarUrl },
        });
      }
      return existingUserByEmail;
    }

    const username = await generateUniqueUsername(tx, profile.usernameHint);

    return tx.user.create({
      data: {
        email: profile.email,
        username,
        passwordHash: null,
        avatarUrl: profile.avatarUrl ?? null,
        accounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        },
      },
    });
  });

  const token = signAccessToken({ sub: dbUser.id, role: dbUser.role });
  return { user: toPublicUser(dbUser), token };
};

export interface OAuthCallbackInput {
  provider: OAuthProviderKey;
  code?: string;
  queryState?: string;
  errorParam?: string;
  stateToken?: string;
}

export const completeOAuthCallback = async (
  input: OAuthCallbackInput
): Promise<{ user: User; token: string }> => {
  const config = getProviderConfig(input.provider);
  if (!config) {
    throw new OAuthFlowError(
      'oauth_not_configured',
      `${input.provider} OAuth credentials are not configured`
    );
  }

  if (input.errorParam) {
    throw new OAuthFlowError(
      'oauth_denied',
      `OAuth provider returned error: ${input.errorParam}`
    );
  }

  if (!input.stateToken || !input.queryState) {
    throw new OAuthFlowError(
      'oauth_invalid_state',
      'Missing OAuth CSRF state verification token'
    );
  }

  let verifiedState;
  try {
    verifiedState = verifyOAuthStateToken(input.stateToken);
  } catch {
    throw new OAuthFlowError(
      'oauth_invalid_state',
      'Invalid or expired OAuth state cookie'
    );
  }

  if (
    verifiedState.provider !== input.provider ||
    !timingSafeEqualString(input.queryState, verifiedState.state)
  ) {
    throw new OAuthFlowError(
      'oauth_invalid_state',
      'OAuth state mismatch or cross-provider replay detected'
    );
  }

  if (!input.code) {
    throw new OAuthFlowError(
      'oauth_failed',
      'Missing authorization code in OAuth callback'
    );
  }

  let profile: NormalizedOAuthProfile;
  if (input.provider === 'google') {
    if (!verifiedState.codeVerifier) {
      throw new OAuthFlowError(
        'oauth_invalid_state',
        'Missing PKCE code_verifier for Google callback'
      );
    }
    profile = await fetchGoogleProfile(
      input.code,
      verifiedState.codeVerifier,
      config
    );
  } else {
    profile = await fetchGitHubProfile(input.code, config);
  }

  return resolveOAuthUser(profile);
};
