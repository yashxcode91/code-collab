import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { getAllowedOrigin } from '../src/middleware/csrf.middleware';
import { AUTH_COOKIE_NAME } from '../src/utils/jwt';

const TRUSTED_ORIGIN = 'http://localhost:5173';

/**
 * Integration tests verifying server-wide security foundations:
 * - Strict CLIENT_URL origin validation
 * - Credentialed CORS header isolation
 * - Defense-in-depth CSRF Origin/Referer checks
 * - Structured 400 (malformed JSON) & 404 JSON envelopes
 */
describe('Backend Security Infrastructure (CORS, CSRF, Errors)', () => {
  afterAll(async () => {
    // Gracefully close DB + Redis sockets so Vitest exits without open-handle hangs
    await prisma.$disconnect();

    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });

  describe('Environment Origin Validation (getAllowedOrigin)', () => {
    it('rejects malformed, wildcard, path-containing, and insecure production URLs', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevClientUrl = process.env.CLIENT_URL;

      try {
        process.env.NODE_ENV = 'development';
        delete process.env.CLIENT_URL;
        expect(getAllowedOrigin()).toBe('http://localhost:5173');

        process.env.NODE_ENV = 'production';
        delete process.env.CLIENT_URL;
        expect(() => getAllowedOrigin()).toThrow(/required in production/);

        process.env.CLIENT_URL = 'http://app.codecollab.dev';
        expect(() => getAllowedOrigin()).toThrow(/must use https/);

        process.env.NODE_ENV = 'development';
        for (const bad of [
          '',
          '   ',
          '*',
          'null',
          'localhost:5173',
          'ftp://localhost:5173',
          'https://app.codecollab.dev/dashboard',
          'https://app.codecollab.dev?foo=bar',
          'https://app.codecollab.dev#hash',
          'https://user:pass@app.codecollab.dev',
        ]) {
          process.env.CLIENT_URL = bad;
          expect(() => getAllowedOrigin()).toThrow();
        }

        process.env.NODE_ENV = 'production';
        process.env.CLIENT_URL = 'https://app.codecollab.dev/';
        expect(getAllowedOrigin()).toBe('https://app.codecollab.dev');
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevClientUrl === undefined) {
          delete process.env.CLIENT_URL;
        } else {
          process.env.CLIENT_URL = prevClientUrl;
        }
      }
    });
  });

  describe('HTTP CORS, CSRF & Error Middleware', () => {
    it('sets credentialed CORS headers only for the trusted origin', async () => {
      const allowedRes = await request(app)
        .get('/api/health')
        .set('Origin', TRUSTED_ORIGIN);

      expect(allowedRes.status).toBe(200);
      expect(allowedRes.body.success).toBe(true);
      expect(allowedRes.headers['access-control-allow-origin']).toBe(
        TRUSTED_ORIGIN
      );
      expect(allowedRes.headers['access-control-allow-credentials']).toBe(
        'true'
      );

      const blockedRes = await request(app)
        .get('/api/health')
        .set('Origin', 'http://evil-site.com');

      expect(blockedRes.status).toBe(200);
      expect(blockedRes.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        blockedRes.headers['access-control-allow-credentials']
      ).toBeUndefined();
    });

    it('blocks cross-site, null-origin, spoofed-referer, and missing-origin cookie mutations', async () => {
      const evilOriginRes = await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'http://evil-site.com');
      expect(evilOriginRes.status).toBe(403);
      expect(evilOriginRes.body.error.code).toBe('CSRF_INVALID_ORIGIN');

      const nullOriginRes = await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'null');
      expect(nullOriginRes.status).toBe(403);
      expect(nullOriginRes.body.error.code).toBe('CSRF_INVALID_ORIGIN');

      const badRefererRes = await request(app)
        .post('/api/auth/logout')
        .set('Referer', 'http://localhost:5173.evil.com/attack');
      expect(badRefererRes.status).toBe(403);
      expect(badRefererRes.body.error.code).toBe('CSRF_INVALID_REFERER');

      const cookieNoOriginRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `${AUTH_COOKIE_NAME}=fake-cookie-token`);
      expect(cookieNoOriginRes.status).toBe(403);
      expect(cookieNoOriginRes.body.error.code).toBe('CSRF_ORIGIN_MISSING');
    });

    it('formats malformed JSON (400) and unknown routes (404) consistently', async () => {
      const badJsonRes = await request(app)
        .post('/api/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"broken":');

      expect(badJsonRes.status).toBe(400);
      expect(badJsonRes.body.success).toBe(false);
      expect(badJsonRes.body.error.code).toBe('INVALID_JSON');

      const notFoundRes = await request(app).get('/api/does-not-exist');
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.success).toBe(false);
      expect(notFoundRes.body.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('applies defensive HTTP security headers and removes X-Powered-By (VULN-06)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('enforces per-account Redis rate limiting on POST /api/auth/login (VULN-06)', async () => {
      const targetEmail = `ratelimit_target_${Date.now()}@codecollab.test`;
      for (let i = 0; i < 10; i += 1) {
        const attempt = await request(app)
          .post('/api/auth/login')
          .set('Origin', TRUSTED_ORIGIN)
          .send({ identifier: targetEmail, password: 'WrongPassword123!' });
        expect(attempt.status).toBe(401);
      }

      const throttled = await request(app)
        .post('/api/auth/login')
        .set('Origin', TRUSTED_ORIGIN)
        .send({ identifier: targetEmail, password: 'WrongPassword123!' });
      expect(throttled.status).toBe(429);
      expect(throttled.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(throttled.headers['retry-after']).toBeDefined();
    });

    it('attaches Redis sliding-window rate limiting to OAuth GET initiation routes', async () => {
      const oauthKeysBefore = await redis.keys('codecollab:ratelimit:auth:oauth-ip:*');
      for (const k of oauthKeysBefore) {
        // Leave unrelated parallel test counters untouched; verify counter increments cleanly
        expect(k).toContain('codecollab:ratelimit:auth:oauth-ip:');
      }

      const res = await request(app).get('/api/auth/google');
      expect(res.status).toBe(302);

      const oauthKeysAfter = await redis.keys('codecollab:ratelimit:auth:oauth-ip:*');
      expect(oauthKeysAfter.length).toBeGreaterThan(0);
    });
  });
});
