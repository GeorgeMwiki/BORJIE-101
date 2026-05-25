import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config — keeps `src/__tests__/*.test.ts`
 * discoverable when the package is run via `pnpm -F` from its own
 * CWD (the root vitest config's `include` is repo-relative).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
