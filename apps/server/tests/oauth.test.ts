import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { AUTH_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from '../src/utils/jwt';
import { sanitizeOAuthUsernameBase } from '../src/modules/auth/oauth.service';

// Isolated email suffix so OAuth test cleanup stays scoped to this test suite
const TEST_EMAIL_DOMAIN = '@vitest-oauth.codecollab.test';
const runId = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

/**
 * Integration tests for Google (PKCE) & GitHub OAuth 2.0 flows:
 * mocks external provider `fetch()` calls while hitting real Express routes & PostgreSQL.
 */
describe('Google & GitHub OAuth 2.0 Flows', () => {
  const savedEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI,
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI =
      'http://localhost:5173/api/auth/google/callback';
    process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';
    process.env.GITHUB_REDIRECT_URI =
      'http://localhost:5173/api/auth/github/callback';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });
    await prisma.$disconnect();

    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });

  it('sanitizes provider handles into valid RegisterSchema-compatible username bases', () => {
    expect(sanitizeOAuthUsernameBase('Yash-Dev.91!')).toBe('yash_dev_91');
    expect(sanitizeOAuthUsernameBase('ab')).toBe('ab_dev');
    expect(sanitizeOAuthUsernameBase('___')).toBe('dev_user');
    expect(sanitizeOAuthUsernameBase('very_long_github_handle_name')).toHaveLength(
      14
    );
  });

  it('redirects cleanly to /login?error=oauth_not_configured when provider credentials are unset', async () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    try {
      const res = await request(app).get('/api/auth/google');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'http://localhost:5173/login?error=oauth_not_configured'
      );
    } finally {
      process.env.GOOGLE_CLIENT_ID = prevId;
    }
  });

  it('initiates Google OAuth with PKCE + HttpOnly state cookie and rejects CSRF state tampering', async () => {
    const agent = request.agent(app);

    const startRes = await agent.get('/api/auth/google');
    expect(startRes.status).toBe(302);

    const redirectUrl = new URL(startRes.headers.location);
    expect(redirectUrl.origin).toBe('https://accounts.google.com');
    expect(redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirectUrl.searchParams.get('code_challenge')).toBeTruthy();

    const state = redirectUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const setCookies = Array.isArray(startRes.headers['set-cookie'])
      ? startRes.headers['set-cookie']
      : [];
    expect(setCookies[0]).toContain(`${OAUTH_STATE_COOKIE_NAME}=`);
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).toContain('SameSite=Lax');

    // Cross-provider replay attempt (Google state sent to GitHub callback) must fail
    const crossProviderRes = await agent
      .get('/api/auth/github/callback')
      .query({ code: 'auth-code-123', state });
    expect(crossProviderRes.status).toBe(302);
    expect(crossProviderRes.headers.location).toBe(
      'http://localhost:5173/login?error=oauth_invalid_state'
    );

    // Reusing cleared/missing state cookie must also fail
    const mismatchRes = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code-123', state: 'tampered-state-value' });
    expect(mismatchRes.status).toBe(302);
    expect(mismatchRes.headers.location).toBe(
      'http://localhost:5173/login?error=oauth_invalid_state'
    );
  });

  it('completes Google OAuth callback, creates User + Account, sets HttpOnly cookie, and reuses Account on repeat login', async () => {
    const googleEmail = makeTestEmail('google');
    const googleSub = `google-sub-${runId}`;

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ access_token: 'g-access-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
          return new Response(
            JSON.stringify({
              sub: googleSub,
              email: googleEmail,
              email_verified: true,
              name: 'Google Tester',
              picture: 'https://example.com/avatar.png',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

    const agent = request.agent(app);
    const startRes = await agent.get('/api/auth/google');
    const state = new URL(startRes.headers.location).searchParams.get('state');

    const cbRes = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'google-code-1', state });

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toBe('http://localhost:5173/');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const setCookies = Array.isArray(cbRes.headers['set-cookie'])
      ? cbRes.headers['set-cookie']
      : [];
    expect(setCookies.some((c) => c.includes(`${AUTH_COOKIE_NAME}=`))).toBe(
      true
    );

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(googleEmail);
    expect(meRes.body.data.user.avatarUrl).toBe(
      'https://example.com/avatar.png'
    );
    expect(meRes.body.data.user.username).toMatch(/^[a-z0-9_]{3,20}$/);

    // Repeat Google login should resolve the same User without duplicating rows
    const agent2 = request.agent(app);
    const startRes2 = await agent2.get('/api/auth/google');
    const state2 = new URL(startRes2.headers.location).searchParams.get('state');
    const cbRes2 = await agent2
      .get('/api/auth/google/callback')
      .query({ code: 'google-code-2', state: state2 });
    expect(cbRes2.status).toBe(302);
    expect(cbRes2.headers.location).toBe('http://localhost:5173/');

    const meRes2 = await agent2.get('/api/auth/me');
    expect(meRes2.body.data.user.id).toBe(meRes.body.data.user.id);
  });

  it('rejects unverified Google email without creating user', async () => {
    const unverifiedEmail = makeTestEmail('unverified_google');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'g-access-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(
          JSON.stringify({
            sub: `google-unverified-${runId}`,
            email: unverifiedEmail,
            email_verified: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const agent = request.agent(app);
    const startRes = await agent.get('/api/auth/google');
    const state = new URL(startRes.headers.location).searchParams.get('state');
    const cbRes = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'google-code-unverified', state });

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toBe(
      'http://localhost:5173/login?error=oauth_unverified_email'
    );

    const createdUser = await prisma.user.findUnique({
      where: { email: unverifiedEmail },
    });
    expect(createdUser).toBeNull();
  });

  it('links GitHub verified email to an existing local user while preserving password login', async () => {
    const sharedEmail = makeTestEmail('linked');
    const localPassword = 'Password123!';

    const localAgent = request.agent(app);
    const regRes = await localAgent
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        email: sharedEmail,
        username: `ghlink_${runId}`,
        password: localPassword,
      });
    expect(regRes.status).toBe(201);
    const localUserId = regRes.body.data.user.id;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'gh-access-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({
            id: 99887766,
            login: `Yash-Collab-${runId}`,
            avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (url === 'https://api.github.com/user/emails') {
        return new Response(
          JSON.stringify([
            {
              email: `secondary_${runId}@vitest-oauth.codecollab.test`,
              primary: false,
              verified: false,
            },
            {
              email: sharedEmail,
              primary: true,
              verified: true,
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const ghAgent = request.agent(app);
    const startRes = await ghAgent.get('/api/auth/github');
    const state = new URL(startRes.headers.location).searchParams.get('state');
    const cbRes = await ghAgent
      .get('/api/auth/github/callback')
      .query({ code: 'gh-code-1', state });

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toBe('http://localhost:5173/');

    const meRes = await ghAgent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.id).toBe(localUserId);
    expect(meRes.body.data.user.avatarUrl).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4'
    );

    // Password login still works after linking GitHub account
    const pwRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ identifier: sharedEmail, password: localPassword });
    expect(pwRes.status).toBe(200);
    expect(pwRes.body.data.user.id).toBe(localUserId);
  });
});
