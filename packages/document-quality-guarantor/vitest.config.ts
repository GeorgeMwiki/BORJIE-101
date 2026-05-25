import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config.
 *
 * Mirrors the @borjie/forecasting-engine pattern so per-package runs
 * don't inherit root globs. Total runtime is capped at 90 s by the spec
 * (anti-stall discipline); per-test timeout 10 s keeps individual tests
 * from blocking the suite.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
