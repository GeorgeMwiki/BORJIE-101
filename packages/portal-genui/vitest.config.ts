import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Mirrors the
 * `@borjie/sustainability-advisor` config so package-level
 * `pnpm -F test` runs without inheriting the repo-root include
 * patterns that miss this folder.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
