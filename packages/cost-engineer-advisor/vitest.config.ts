import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config — picks up `src/__tests__/*.spec.ts`
 * when CWD is the package root.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
