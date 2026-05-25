import { defineConfig } from 'vitest/config';

/*
 * Package-scoped vitest config — mirrors packages/user-context-store.
 * Picks up `src/**\/*.test.ts`. Test timeout deliberately well under
 * the 90s ceiling so flake under load still surfaces.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
