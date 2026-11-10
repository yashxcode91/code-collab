import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { getAllowedOrigin } from '../src/middleware/csrf.middleware';
import { AUTH_COOKIE_NAME } from '../src/utils/jwt';

const TRUSTED_ORIGIN = 'http://localhost:5173';

describe('Backend Security Infrastructure (CORS, CSRF, Errors)', () => {
  afterAll(async () => {
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
  });
});
