import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@borjie/domain-models': path.resolve(__dirname, 'packages/domain-models/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'services/**/*.test.ts',
      'scripts/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
    testTimeout: 10000,
    // CI runs all packages' tests in parallel; some suites flake intermittently
    // under CPU contention (pass per-package, fail in the combined run). Retry in
    // CI to absorb load-induced flakiness — a real failure still fails all retries.
    retry: process.env.CI ? 2 : 0,
  },
});
