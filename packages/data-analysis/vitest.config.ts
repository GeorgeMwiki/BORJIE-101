import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config — mirrors the convention in
 * `packages/forecasting/vitest.config.ts`. Required because the
 * repo-root vitest config uses repo-relative include patterns.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
