import { defineConfig } from 'vitest/config';

/**
 * Package-scoped vitest config. Tests run in `node` because every
 * scaffold module here is pure functions over injected stores —
 * no DOM, no DB. The 70% coverage gate is enforced in CI; locally
 * `pnpm test:coverage` produces the report.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
