import { defineConfig } from 'vitest/config';

/**
 * Local vitest config for `@borjie/pms-bench-1`.
 *
 * The bench lives outside the monorepo workspace (intentional — its
 * dependencies are intentionally narrow) so it cannot inherit the root
 * `vitest.config.ts`. This file scopes test discovery to the package's
 * own `__tests__` directory.
 */
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
