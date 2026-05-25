import { defineConfig } from 'vitest/config';

// Package-scoped vitest config so `pnpm -F @borjie/analytics test`
// resolves the per-package src test folder relative to this package.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
