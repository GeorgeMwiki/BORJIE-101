import { defineConfig } from 'vitest/config';

/**
 * Local vitest config for `forecasting-bench`.
 *
 * The bench lives outside the monorepo workspace so it cannot inherit
 * the root `vitest.config.ts`. Scope discovery to this directory's own
 * `__tests__` folder.
 */
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
