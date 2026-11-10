import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { AUTH_COOKIE_NAME } from '../src/utils/jwt';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest.codecollab.test';
const runId = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

describe('Auth Endpoints & HttpOnly Cookie Lifecycle', () => {
  const email = makeTestEmail('primary');
  const username = `vt_${runId}_1`;
  const password = 'Password123!';

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });
  });

  afterAll(async () => {
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

  it('rejects invalid registration input with field validation details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        email: 'not-an-email',
        username: 'bad@user',
        password: '123',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('registers user, normalizes inputs, strips role injection, sets HttpOnly cookie, and guards duplicates', async () => {
    const agent = request.agent(app);

    const regRes = await agent
      .post('/api/auth/register')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        email: `  ${email.toUpperCase()}  `,
        username: `  ${username.toUpperCase()}  `,
        password,
        role: 'ADMIN',
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);
    expect(regRes.body.data.user.email).toBe(email);
    expect(regRes.body.data.user.username).toBe(username);
    expect(regRes.body.data.user.role).toBe('user');
    expect(regRes.body.data.user.passwordHash).toBeUndefined();
    expect(regRes.body.data.token).toBeUndefined();

    const setCookies = Array.isArray(regRes.headers['set-cookie'])
      ? regRes.headers['set-cookie']
      : [];
    expect(setCookies.length).toBeGreaterThan(0);
    expect(setCookies[0]).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(setCookies[0]).toContain('HttpOnly');
    expect(setCookies[0]).toContain('SameSite=Lax');

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(email);
    expect(meRes.body.data.user.passwordHash).toBeUndefined();

    const dupEmailRes = await request(app)
      .post('/api/auth/register')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        email,
        username: `vt_${runId}_2`,
        password,
      });
    expect(dupEmailRes.status).toBe(409);
    expect(dupEmailRes.body.error.code).toBe('EMAIL_EXISTS');

    const dupUserRes = await request(app)
      .post('/api/auth/register')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        email: makeTestEmail('secondary'),
        username,
        password,
      });
    expect(dupUserRes.status).toBe(409);
    expect(dupUserRes.body.error.code).toBe('USERNAME_EXISTS');
  });

  it('rejects missing, tampered, expired, and deleted-user cookies on GET /api/auth/me', async () => {
    const noCookie = await request(app).get('/api/auth/me');
    expect(noCookie.status).toBe(401);
    expect(noCookie.body.error.code).toBe('UNAUTHORIZED');

    const badCookie = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=tampered.jwt.token`);
    expect(badCookie.status).toBe(401);
    expect(badCookie.body.error.code).toBe('INVALID_TOKEN');

    const secret = process.env.JWT_SECRET?.trim() ?? '';
    const expiredToken = jwt.sign({ sub: 'some-user-id', role: 'USER' }, secret, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    const expiredCookie = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${expiredToken}`);
    expect(expiredCookie.status).toBe(401);
    expect(expiredCookie.body.error.code).toBe('TOKEN_EXPIRED');

    const disposableEmail = makeTestEmail('disposable');
    const disposableAgent = request.agent(app);
    const regRes = await disposableAgent
      .post('/api/auth/register')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        email: disposableEmail,
        username: `vt_${runId}_del`,
        password,
      });
    expect(regRes.status).toBe(201);

    await prisma.user.delete({ where: { email: disposableEmail } });

    const afterDeleteMe = await disposableAgent.get('/api/auth/me');
    expect(afterDeleteMe.status).toBe(401);
    expect(afterDeleteMe.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs in via email OR username, rejects bad/OAuth passwords uniformly, and clears cookie on logout', async () => {
    const emailAgent = request.agent(app);
    const emailLoginRes = await emailAgent
      .post('/api/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        identifier: ` ${email.toUpperCase()} `,
        password,
      });
    expect(emailLoginRes.status).toBe(200);
    expect(emailLoginRes.body.data.user.username).toBe(username);

    const usernameAgent = request.agent(app);
    const usernameLoginRes = await usernameAgent
      .post('/api/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        identifier: ` ${username.toUpperCase()} `,
        password,
      });
    expect(usernameLoginRes.status).toBe(200);
    expect(usernameLoginRes.body.data.user.email).toBe(email);

    const logoutRes = await usernameAgent
      .post('/api/auth/logout')
      .set('Origin', TRUSTED_ORIGIN);
    expect(logoutRes.status).toBe(200);
    const clearedCookies = Array.isArray(logoutRes.headers['set-cookie'])
      ? logoutRes.headers['set-cookie']
      : [];
    expect(clearedCookies.length).toBeGreaterThan(0);
    expect(clearedCookies[0]).toContain(`${AUTH_COOKIE_NAME}=;`);

    const postLogoutMe = await usernameAgent.get('/api/auth/me');
    expect(postLogoutMe.status).toBe(401);

    const wrongPwRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: username, password: 'WrongPassword123!' });

    const unknownRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: 'unknown_user_999', password: 'WrongPassword123!' });

    const oauthEmail = makeTestEmail('oauth');
    await prisma.user.create({
      data: {
        email: oauthEmail,
        username: `vto_${runId}`,
        passwordHash: null,
      },
    });

    const oauthRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: oauthEmail, password: 'AnyPassword123!' });

    expect(wrongPwRes.status).toBe(401);
    expect(unknownRes.status).toBe(401);
    expect(oauthRes.status).toBe(401);
    expect(wrongPwRes.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownRes.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(oauthRes.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownRes.body.error.message).toBe(wrongPwRes.body.error.message);
    expect(oauthRes.body.error.message).toBe(wrongPwRes.body.error.message);
  });
});
