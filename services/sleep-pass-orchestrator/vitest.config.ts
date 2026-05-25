import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config for `@borjie/sleep-pass-orchestrator`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
