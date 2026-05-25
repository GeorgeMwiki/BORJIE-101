import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config for @borjie/document-studio.
 * Mirrors content-studio so package-level coverage thresholds are
 * enforced without inheriting repo-wide include patterns.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
