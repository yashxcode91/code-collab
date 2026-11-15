import { defineConfig, devices } from '@playwright/test';

/**
 * CodeCollab — Playwright End-to-End Test Configuration
 *
 * Configured to run against local development/preview servers or CI environments:
 * - Base URL defaults to http://localhost:5173 (Vite dev or preview proxying /api and /socket.io)
 * - Parallel execution for isolated test specs
 * - Auto-captures screenshots and traces on test failure
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45 * 1000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? [
        {
          command: 'pnpm --filter server start',
          port: 4000,
          timeout: 60 * 1000,
          reuseExistingServer: true,
        },
        {
          command: 'pnpm --filter web preview --port 5173',
          port: 5173,
          timeout: 60 * 1000,
          reuseExistingServer: true,
        },
      ]
    : undefined,
});
