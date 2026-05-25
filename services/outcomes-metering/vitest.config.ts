import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Mirrors the per-package convention used
 * elsewhere in the repo so `pnpm -F @borjie/outcomes-metering-service test`
 * runs against `src/__tests__/*.test.ts` regardless of CWD.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
