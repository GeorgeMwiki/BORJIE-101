import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config for `@borjie/memory-v2`.
 * Mirrors `sustainability-advisor` — keeps tests under `src/__tests__/`
 * and avoids inheriting the root config's repo-relative include patterns.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
