import { defineConfig } from 'vitest/config';

/*
 * Package-scoped vitest config. Mirrors packages/sustainability-advisor
 * so `pnpm -F @borjie/user-context-store test` picks up the per-package
 * `src/{any}/*.test.ts` files when CWD is the package.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
