import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Load local .env if present (monorepo root or apps/server), then apply safe test defaults
const envPath = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps/server/.env'),
].find((candidate) => fs.existsSync(candidate));

if (envPath) {
  dotenv.config({ path: envPath });
}

// Pin test environment defaults so CI/local Vitest runs never accidentally use production config or empty secrets
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'vitest-fallback-secret-must-be-at-least-32-chars';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
