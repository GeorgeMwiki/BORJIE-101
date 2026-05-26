import { defineConfig } from 'vitest/config';

/**
 * SEC-4 — Mr. Mwikila agent security guard tests.
 *
 * Live-test discipline: vitest's `node` environment, NO model calls in
 * unit tests. All `__fixture__`-prefixed strings are attack fixtures
 * matched only against the in-tree detectors / validators.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
