/**
 * Local vitest config for @borjie/connector-slack so
 * `pnpm -C packages/connectors/slack test` discovers the in-package
 * tests independently of the root config.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    testTimeout: 10000,
  },
});
