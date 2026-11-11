import { defineConfig } from 'vitest/config';

// Node-environment Vitest config pointing at `tests/setup.ts` before every integration suite runs
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
