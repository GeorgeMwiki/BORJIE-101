import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Required so `pnpm -F test` picks up
 * `src/__tests__` when CWD is the package and not the repo root.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
