import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve the top-level `@borjie/database` barrel from SOURCE so tests
    // see the latest exports (e.g. `withTenantContext`) without a `pnpm
    // build` round-trip — mirrors `services/api-gateway/vitest.config.ts`.
    // The `$` anchor keeps subpath imports (`@borjie/database/schemas`)
    // routing through the package.json exports map.
    alias: [
      {
        find: /^@borjie\/database$/,
        replacement: path.resolve(__dirname, '../../packages/database/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
